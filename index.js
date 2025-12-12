// index.js — Yakuza Esports Bot (CommonJS, slash commands, autorole, logs, anti-nuke, joinvc silent)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  Collection
} = require("discord.js");
const { joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice");

// CONFIG
const WARN_FILE = path.join(__dirname, "warnings.json");
if (!fs.existsSync(WARN_FILE)) fs.writeFileSync(WARN_FILE, JSON.stringify({}));

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.APPLICATION_ID || "";
const GUILD_ID = process.env.GUILD_ID || "";

if (!TOKEN) {
  console.error("ERROR: TOKEN not set in .env. Add TOKEN=your_bot_token");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// helper for warn file
function loadWarnings() {
  try { return JSON.parse(fs.readFileSync(WARN_FILE, "utf8")); }
  catch { return {}; }
}
function saveWarnings(data) {
  fs.writeFileSync(WARN_FILE, JSON.stringify(data, null, 2), "utf8");
}

// simple anti-nuke tracker
const moderationEvents = new Collection();
function recordModerationAction(moderatorId) {
  const now = Date.now();
  if (!moderationEvents.has(moderatorId)) moderationEvents.set(moderatorId, []);
  const arr = moderationEvents.get(moderatorId);
  arr.push(now);
  moderationEvents.set(moderatorId, arr.filter(t => now - t <= 30000));
  return moderationEvents.get(moderatorId).length;
}

// register slash commands
async function registerCommands() {
  const commandBuilders = [
    new SlashCommandBuilder().setName("ping").setDescription("Bot latency"),
    new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Send announcement (admin only)")
      .addStringOption(opt => opt.setName("message").setDescription("Announcement text").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("kick").setDescription("Kick a member")
      .addUserOption(opt => opt.setName("member").setDescription("Member to kick").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
      .setName("ban").setDescription("Ban a member")
      .addUserOption(opt => opt.setName("member").setDescription("Member to ban").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
      .setName("mute").setDescription("Timeout a member (minutes)")
      .addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .addIntegerOption(opt => opt.setName("minutes").setDescription("Minutes").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName("unmute").setDescription("Remove timeout")
      .addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName("warn").setDescription("Warn a member")
      .addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
      .setName("warnings").setDescription("Show member warnings")
      .addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true)),
    new SlashCommandBuilder()
      .setName("clear").setDescription("Bulk delete messages")
      .addIntegerOption(opt => opt.setName("amount").setDescription("1-100").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName("slowmode").setDescription("Set channel slowmode")
      .addIntegerOption(opt => opt.setName("seconds").setDescription("0–21600").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName("userinfo").setDescription("Show user info")
      .addUserOption(opt => opt.setName("member").setDescription("Member")),
    new SlashCommandBuilder()
      .setName("serverinfo").setDescription("Show server info"),
    new SlashCommandBuilder()
      .setName("setautorole").setDescription("Set autorole")
      .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("setlogchannel").setDescription("Set log channel")
      .addChannelOption(opt => opt.setName("channel").setDescription("Channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("joinvc").setDescription("Bot joins a voice channel")
      .addChannelOption(opt => opt.setName("channel").setDescription("Voice channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    new SlashCommandBuilder()
      .setName("leavevc").setDescription("Bot leaves voice channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect)
  ];

  const commands = commandBuilders.map(c => c.toJSON());
  const joinCmd = commands.find(c => c.name === "joinvc");
  if (joinCmd) joinCmd.options[0].channel_types = [2];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    if (CLIENT_ID && GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("Registered commands to guild:", GUILD_ID);
    } else if (CLIENT_ID) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("Registered global commands.");
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// STORE CONFIG
const CONFIG_FILE = path.join(__dirname, "botconfig.json");
let BOT_CONFIG = {};
try { BOT_CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { BOT_CONFIG = {}; }
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(BOT_CONFIG, null, 2), "utf8"); }

// 🔥 **WELCOME SYSTEM + AUTOROLE + LOG**
client.on("guildMemberAdd", async (member) => {
  const guildConf = BOT_CONFIG[member.guild.id] || {};

  // 1️⃣ Auto-role
  if (guildConf.autorole) {
    try { await member.roles.add(guildConf.autorole); }
    catch (e) { console.warn("Autorole error:", e.message); }
  }

  // 2️⃣ Welcome message (your custom embed)
  const welcomeChannel = member.guild.channels.cache.get("1449015370244423690");
  if (welcomeChannel) {
    const embed = {
      title: "🔥 Welcome to Yakuza Esports! 🔥",
      description: `Welcome <@${member.id}>!\n\nWe’re hyped to have you joining us and sticking with the squad! 💮⚔️  
Let’s vibe, grow, and make big moves together. 🏆🔥`,
      color: 0xff0000,
      thumbnail: { url: member.user.displayAvatarURL({ dynamic: true, size: 512 }) },
      image: { url: "https://i.ibb.co/ZLxmW7f/yakuza-banner.png" },
      footer: { text: `Yakuza Esports • Member #${member.guild.memberCount}` },
      timestamp: new Date()
    };

    welcomeChannel.send({ embeds: [embed] }).catch(() => {});
  }

  // 3️⃣ Log channel
  if (guildConf.logChannel) {
    const ch = member.guild.channels.cache.get(guildConf.logChannel);
    if (ch) {
      ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Member Joined")
            .setDescription(`${member.user.tag} joined.`)
            .setTimestamp()
        ]
      }).catch(() => {});
    }
  }
});

// LOG Errors
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  fs.appendFileSync(path.join(__dirname, "crash.log"), `${new Date().toISOString()} ${reason}\n`);
});

// Slash Command Handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  try {

    // ---------------- BASIC COMMANDS ---------------- //

    if (commandName === "ping")
      return interaction.reply({ content: `🏓 Pong! Ping: ${client.ws.ping}ms`, ephemeral: true });

    if (commandName === "announce") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const msg = interaction.options.getString("message");
      const embed = new EmbedBuilder()
        .setTitle("📣 Announcement")
        .setDescription(msg)
        .setColor(0xff9900)
        .setTimestamp();

      await interaction.reply({ content: "Announcement sent!", ephemeral: true });
      return interaction.channel.send({ embeds: [embed] });
    }

    // ----------------------------------------------- //
    // MODERATION (kick, ban, warn, mute, etc.)
    // ----------------------------------------------- //

    if (commandName === "kick" || commandName === "ban") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });

      const user = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) return interaction.reply({ content: "User not found.", ephemeral: true });

      if (commandName === "kick") {
        if (!member.kickable) return interaction.reply({ content: "I can't kick this user.", ephemeral: true });
        await member.kick(reason);
        await interaction.reply({ content: `👢 Kicked ${user.tag}.` });
      }

      if (commandName === "ban") {
        if (!member.bannable) return interaction.reply({ content: "I can't ban this user.", ephemeral: true });
        await member.ban({ reason });
        await interaction.reply({ content: `🔨 Banned ${user.tag}.` });
      }

      return;
    }

    if (commandName === "mute") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers))
        return interaction.reply({ content: "No permission.", ephemeral: true });

      const user = interaction.options.getUser("member");
      const minutes = interaction.options.getInteger("minutes") || 10;
      const member = interaction.guild.members.cache.get(user.id);

      await member.timeout(minutes * 60000);
      return interaction.reply({ content: `🔇 Muted ${user.tag} for ${minutes} minutes.` });
    }

    if (commandName === "unmute") {
      const user = interaction.options.getUser("member");
      const member = interaction.guild.members.cache.get(user.id);
      await member.timeout(null);
      return interaction.reply({ content: `🔊 Unmuted ${user.tag}.` });
    }

    if (commandName === "warn") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });

      const user = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason";

      const data = loadWarnings();
      data[user.id] = data[user.id] || [];
      data[user.id].push({ moderator: interaction.user.id, reason, timestamp: Date.now() });
      saveWarnings(data);

      return interaction.reply({ content: `⚠️ Warned ${user.tag}.` });
    }

    if (commandName === "warnings") {
      const user = interaction.options.getUser("member");
      const data = loadWarnings()[user.id] || [];

      if (!data.length)
        return interaction.reply({ content: "No warnings.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${user.tag}`)
        .setDescription(data.map((w, i) => `${i + 1}. ${w.reason}`).join("\n"))
        .setColor(0xff0000);

      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "clear") {
      const amt = interaction.options.getInteger("amount");
      const msgs = await interaction.channel.bulkDelete(amt, true);
      return interaction.reply({ content: `🧹 Deleted ${msgs.size} messages.` });
    }

    if (commandName === "slowmode") {
      const seconds = interaction.options.getInteger("seconds");
      await interaction.channel.setRateLimitPerUser(seconds);
      return interaction.reply({ content: `🐌 Slowmode set to ${seconds}s.` });
    }

    // ----------------------------------------------- //
    // Utility Commands
    // ----------------------------------------------- //

    if (commandName === "userinfo") {
      const user = interaction.options.getUser("member") || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);
      const embed = new EmbedBuilder()
        .setTitle(`User Info - ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "ID", value: user.id },
          { name: "Joined", value: new Date(member.joinedTimestamp).toLocaleString() },
          { name: "Created", value: new Date(user.createdTimestamp).toLocaleString() }
        )
        .setColor(0x00ffff);

      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "serverinfo") {
      const g = interaction.guild;
      const embed = new EmbedBuilder()
        .setTitle(`Server Info - ${g.name}`)
        .addFields(
          { name: "Members", value: `${g.memberCount}` },
          { name: "Channels", value: `${g.channels.cache.size}` },
          { name: "Owner", value: `<@${g.ownerId}>` }
        )
        .setColor(0x99ccff);

      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "setautorole") {
      const role = interaction.options.getRole("role");
      BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
      BOT_CONFIG[interaction.guild.id].autorole = role.id;
      saveConfig();
      return interaction.reply({ content: `Autorole set to ${role.name}.` });
    }

    if (commandName === "setlogchannel") {
      const ch = interaction.options.getChannel("channel");
      BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
      BOT_CONFIG[interaction.guild.id].logChannel = ch.id;
      saveConfig();
      return interaction.reply({ content: `Log channel set to ${ch.name}.` });
    }

    // VC Commands
    if (commandName === "joinvc") {
      const ch = interaction.options.getChannel("channel");
      joinVoiceChannel({
        channelId: ch.id,
        guildId: ch.guild.id,
        adapterCreator: ch.guild.voiceAdapterCreator,
        selfMute: true,
        selfDeaf: true
      });

      BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
      BOT_CONFIG[interaction.guild.id].vcChannel = ch.id;
      saveConfig();

      return interaction.reply({ content: `Joined VC: ${ch.name}` });
    }

    if (commandName === "leavevc") {
      const conn = getVoiceConnection(interaction.guild.id);
      if (conn) conn.destroy();

      BOT_CONFIG[interaction.guild.id].vcChannel = null;
      saveConfig();

      return interaction.reply({ content: "Left voice channel." });
    }

  } catch (err) {
    console.error("Command error:", err);
    return interaction.reply({ content: "Error occurred.", ephemeral: true });
  }
});

// READY EVENT
client.once("ready", async () => {
  console.log(`🔥 Yakuza Esports Bot Logged in as ${client.user.tag}`);
  await registerCommands().catch(() => {});
  client.user.setActivity("Yakuza | Moderation", { type: 3 });

  for (const guildId of Object.keys(BOT_CONFIG)) {
    const cfg = BOT_CONFIG[guildId];
    if (cfg?.vcChannel) {
      const ch = await client.channels.fetch(cfg.vcChannel).catch(() => null);
      if (ch && ch.isVoiceBased()) {
        joinVoiceChannel({
          channelId: ch.id,
          guildId: ch.guild.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
          selfMute: true,
          selfDeaf: true
        });
        console.log(`Auto rejoined VC ${ch.id}`);
      }
    }
  }
});

// LOGIN
client.login(TOKEN).catch(err => {
  console.error("Login failed:", err);
  process.exit(1);
});
