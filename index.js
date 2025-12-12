// index.js — Yakuza Esports Bot (CommonJS)
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
  const window = 30000;
  moderationEvents.set(moderatorId, arr.filter(t => now - t <= window));
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
      .addStringOption(opt => opt.setName("reason").setDescription("Reason").setRequired(false)),
    new SlashCommandBuilder()
      .setName("warnings").setDescription("Show member warnings")
      .addUserOption(opt => opt.setName("member").setDescription("Member")),
    new SlashCommandBuilder()
      .setName("clear").setDescription("Bulk delete messages")
      .addIntegerOption(opt => opt.setName("amount").setDescription("1-100").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName("slowmode").setDescription("Set channel slowmode seconds")
      .addIntegerOption(opt => opt.setName("seconds").setDescription("0-21600").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName("userinfo").setDescription("Show user info")
      .addUserOption(opt => opt.setName("member").setDescription("Member")),
    new SlashCommandBuilder()
      .setName("serverinfo").setDescription("Show server info"),
    new SlashCommandBuilder()
      .setName("setautorole").setDescription("Set role to assign on join")
      .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("setlogchannel").setDescription("Set moderation log channel")
      .addChannelOption(opt => opt.setName("channel").setDescription("Channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("joinvc").setDescription("Make bot join a voice channel (silent)")
      .addChannelOption(opt => opt.setName("channel").setDescription("Voice Channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    new SlashCommandBuilder()
      .setName("leavevc").setDescription("Bot leaves VC")
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect)
  ];

  const commands = commandBuilders.map(c => c.toJSON());
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    if (CLIENT_ID && GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("Registered commands to guild:", GUILD_ID);
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// load config
const CONFIG_FILE = path.join(__dirname, "botconfig.json");
let BOT_CONFIG = {};
try { BOT_CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { BOT_CONFIG = {}; }
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(BOT_CONFIG, null, 2)); }

// ===============================
// ✅ JOIN MESSAGE (ONLY ONCE)
// ===============================
client.on("guildMemberAdd", async (member) => {
  const channel = member.guild.channels.cache.get("1449015370244423690");
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle("🔥 Welcome to Yakuza Esports! 🔥")
    .setDescription(
      `Welcome <@${member.id}>!\n\nWe’re hyped to have you joining us and sticking with the squad! 💮⚔️\n` +
      `Let’s vibe, grow, and make big moves together. 🏆🔥`
    )
    .setColor(0xff0000)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setImage("https://i.ibb.co/ZLxmW7f/yakuza-banner.png")
    .setFooter({ text: `Yakuza Esports • Member #${member.guild.memberCount}` })
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(() => {});
});

// ===============================
// ✅ LEAVE MESSAGE
// ===============================
client.on("guildMemberRemove", async (member) => {
  const channel = member.guild.channels.cache.get("1448718756191801556");
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle("💨 Member Left Yakuza Esports")
    .setDescription(
      `**${member.user.tag}** has left Yakuza Esports.\n\n` +
      `We appreciate the time you spent with us. 🙏\n` +
      `Wishing you the best — keep grinding and stay winning. ⚔️🔥`
    )
    .setColor(0x808080)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: "Yakuza Esports • Farewell" })
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(() => {});
});

// =================================================
// ⚡ REST OF YOUR BOT BELOW (unchanged)
// =================================================

// logging crashes
process.on("unhandledRejection", (reason) => {
  fs.appendFileSync("crash.log", `${new Date().toISOString()} - ${reason}\n`);
});

// interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  try {
    if (commandName === "ping")
      return interaction.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });

    if (commandName === "announce") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const msg = interaction.options.getString("message");
      const embed = new EmbedBuilder().setTitle("📣 Announcement").setDescription(msg).setColor(0xff9900);
      await interaction.reply({ content: "Announcement sent.", ephemeral: true });
      return interaction.channel.send({ embeds: [embed] });
    }

    if (commandName === "kick") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason";
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });

      await member.kick(reason);
      return interaction.reply(`👢 Kicked ${user.tag} | ${reason}`);
    }

    if (commandName === "ban") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason";
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });

      await member.ban({ reason });
      return interaction.reply(`🔨 Banned ${user.tag} | ${reason}`);
    }

    if (commandName === "joinvc") {
      const ch = interaction.options.getChannel("channel");
      joinVoiceChannel({
        channelId: ch.id,
        guildId: ch.guild.id,
        adapterCreator: ch.guild.voiceAdapterCreator,
        selfMute: true,
        selfDeaf: true
      });
      return interaction.reply(`Joined VC: ${ch.name}`);
    }

    if (commandName === "leavevc") {
      const conn = getVoiceConnection(interaction.guild.id);
      if (conn) conn.destroy();
      return interaction.reply("Left the VC.");
    }

  } catch (e) {
    console.error(e);
    try { interaction.reply({ content: "Error occurred.", ephemeral: true }); } catch {}
  }
});

// on ready
client.once("ready", async () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
  await registerCommands().catch(() => {});
  client.user.setActivity("Yakuza | Moderation", { type: 3 });
});

// login
client.login(TOKEN);
