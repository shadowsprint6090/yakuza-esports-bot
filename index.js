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
const CLIENT_ID = process.env.CLIENT_ID || process.env.APPLICATION_ID || ""; // optional for guild registration
const GUILD_ID = process.env.GUILD_ID || ""; // optional: if set, commands register to this guild for instant availability

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
const moderationEvents = new Collection(); // key: moderatorId, value: array of timestamps
function recordModerationAction(moderatorId) {
  const now = Date.now();
  if (!moderationEvents.has(moderatorId)) moderationEvents.set(moderatorId, []);
  const arr = moderationEvents.get(moderatorId);
  arr.push(now);
  // remove older than 30s
  const window = 30_000;
  moderationEvents.set(moderatorId, arr.filter(t => now - t <= window));
  return moderationEvents.get(moderatorId).length;
}

// register slash commands
async function registerCommands() {
  // build commands with builders
  const commandBuilders = [
    new SlashCommandBuilder().setName("ping").setDescription("Bot latency"),
    new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Send announcement (admin only)")
      .addStringOption(opt => opt.setName("message").setDescription("Announcement text").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("kick").setDescription("Kick a member").addUserOption(opt => opt.setName("member").setDescription("Member to kick").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
      .setName("ban").setDescription("Ban a member").addUserOption(opt => opt.setName("member").setDescription("Member to ban").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
      .setName("mute").setDescription("Timeout a member (minutes)").addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .addIntegerOption(opt => opt.setName("minutes").setDescription("Minutes").setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName("unmute").setDescription("Remove timeout").addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName("warn").setDescription("Warn a member").addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true))
      .addStringOption(opt => opt.setName("reason").setDescription("Reason").setRequired(false)),
    new SlashCommandBuilder()
      .setName("warnings").setDescription("Show member warnings").addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(true)),
    new SlashCommandBuilder()
      .setName("clear").setDescription("Bulk delete messages").addIntegerOption(opt => opt.setName("amount").setDescription("1-100").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName("slowmode").setDescription("Set channel slowmode seconds").addIntegerOption(opt => opt.setName("seconds").setDescription("0-21600").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName("userinfo").setDescription("Show user info").addUserOption(opt => opt.setName("member").setDescription("Member").setRequired(false)),
    new SlashCommandBuilder()
      .setName("serverinfo").setDescription("Show server info"),
    new SlashCommandBuilder()
      .setName("setautorole").setDescription("Set role to assign on join").addRoleOption(opt => opt.setName("role").setDescription("Role to auto-assign").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("setlogchannel").setDescription("Set moderation log channel").addChannelOption(opt => opt.setName("channel").setDescription("Channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    // joinvc will be adjusted after .toJSON to force it to accept only voice channels
    new SlashCommandBuilder()
      .setName("joinvc").setDescription("Make bot join a voice channel (silent)").addChannelOption(opt => opt.setName("channel").setDescription("Voice channel to join").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),
    new SlashCommandBuilder()
      .setName("leavevc").setDescription("Make bot leave the configured voice channel").setDefaultMemberPermissions(PermissionFlagsBits.Connect)
  ];

  // convert to JSON
  const commands = commandBuilders.map(c => c.toJSON());

  // Fix: ensure joinvc channel option only shows voice channels (channel_types: [2])
  try {
    const joinCmd = commands.find(c => c.name === "joinvc");
    if (joinCmd && Array.isArray(joinCmd.options) && joinCmd.options.length > 0) {
      // set channel_types to Voice (2)
      joinCmd.options[0].channel_types = [2];
    }
  } catch (e) {
    console.warn("Could not modify joinvc command JSON:", e);
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    if (CLIENT_ID && GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("Registered commands to guild:", GUILD_ID);
    } else if (CLIENT_ID) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("Registered global commands (may take up to 1 hour).");
    } else {
      console.warn("CLIENT_ID not set. Skipping automatic command registration. Set CLIENT_ID (Application ID) and optionally GUILD_ID in .env to enable registration.");
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// store config in simple JSON
const CONFIG_FILE = path.join(__dirname, "botconfig.json");
let BOT_CONFIG = {};
try { BOT_CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { BOT_CONFIG = {}; }
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(BOT_CONFIG, null, 2), "utf8"); }

// autorole on join
client.on("guildMemberAdd", async member => {
  const guildConf = BOT_CONFIG[member.guild.id] || {};
  if (guildConf.autorole) {
    try { await member.roles.add(guildConf.autorole, "Auto-role"); }
    catch (e) { console.warn("Failed to add autorole:", e.message || e); }
  }
  // log join if log channel set
  if (guildConf.logChannel) {
    const ch = member.guild.channels.cache.get(guildConf.logChannel);
    if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle("Member Joined").setDescription(`${member.user.tag} joined`).setTimestamp()] }).catch(()=>{});
  }
});

// simple logging of unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
  // save to file
  fs.appendFileSync(path.join(__dirname, "crash.log"), `${new Date().toISOString()} UNHANDLED ${reason}\n`);
});

// interactions
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // helper: check admin
  const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

  try {
    if (commandName === "ping") {
      return interaction.reply({ content: `🏓 Pong! API: ${Math.round(client.ws.ping)}ms`, ephemeral: true });
    }

    if (commandName === "announce") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const text = interaction.options.getString("message", true);
      const embed = new EmbedBuilder().setTitle("📣 Announcement").setDescription(text).setColor(0xff9900).setTimestamp();
      await interaction.reply({ content: "Announcement sent.", ephemeral: true });
      return interaction.channel.send({ embeds: [embed] });
    }

    if (commandName === "kick" || commandName === "ban") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const member = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const guildMember = interaction.guild.members.cache.get(member.id);
      if (!guildMember) return interaction.reply({ content: "Member not found in guild.", ephemeral: true });

      // perform action
      if (commandName === "kick") {
        if (!guildMember.kickable) return interaction.reply({ content: "I cannot kick this member.", ephemeral: true });
        await guildMember.kick(reason);
        // anti-nuke
        const count = recordModerationAction(interaction.user.id);
        if (count > 4) {
          // punitive: remove admin perms by removing roles with ADMINISTRATOR
          const rolesToRemove = interaction.member.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator));
          try { for (const r of rolesToRemove.values()) await interaction.member.roles.remove(r); } catch {}
          (interaction.guild.channels.cache.get(BOT_CONFIG[interaction.guild.id]?.logChannel) || interaction.channel)?.send({ content: `Anti-nuke: Removed admin roles from ${interaction.user.tag} after ${count} actions.` }).catch(()=>{});
        }
        await interaction.reply({ content: `👢 Kicked ${member.tag}.`, ephemeral: false });
      } else {
        if (!guildMember.bannable) return interaction.reply({ content: "I cannot ban this member.", ephemeral: true });
        await guildMember.ban({ reason });
        const count = recordModerationAction(interaction.user.id);
        if (count > 4) {
          const rolesToRemove = interaction.member.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator));
          try { for (const r of rolesToRemove.values()) await interaction.member.roles.remove(r); } catch {}
          (interaction.guild.channels.cache.get(BOT_CONFIG[interaction.guild.id]?.logChannel) || interaction.channel)?.send({ content: `Anti-nuke: Removed admin roles from ${interaction.user.tag} after ${count} actions.` }).catch(()=>{});
        }
        await interaction.reply({ content: `🔨 Banned ${member.tag}.`, ephemeral: false });
      }

      // log
      const logCh = BOT_CONFIG[interaction.guild.id]?.logChannel;
      if (logCh) {
        const ch = interaction.guild.channels.cache.get(logCh);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle(`${commandName.toUpperCase()}`).setDescription(`${member.tag} -> by ${interaction.user.tag}\nReason: ${reason}`).setTimestamp()] }).catch(()=>{});
      }
      return;
    }

    if (commandName === "mute") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const minutes = interaction.options.getInteger("minutes") || 10;
      const gm = interaction.guild.members.cache.get(user.id);
      if (!gm) return interaction.reply({ content: "Member not found.", ephemeral: true });
      await gm.timeout(minutes * 60 * 1000, `Muted by ${interaction.user.tag}`);
      await interaction.reply({ content: `🔇 ${user.tag} muted for ${minutes} minutes.`, ephemeral: false });
      const logCh = BOT_CONFIG[interaction.guild.id]?.logChannel;
      if (logCh) { const ch = interaction.guild.channels.cache.get(logCh); if (ch) ch.send({ content: `${user.tag} muted by ${interaction.user.tag} for ${minutes} minutes.` }).catch(()=>{}); }
      return;
    }

    if (commandName === "unmute") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const gm = interaction.guild.members.cache.get(user.id);
      if (!gm) return interaction.reply({ content: "Member not found.", ephemeral: true });
      await gm.timeout(null);
      await interaction.reply({ content: `🔊 ${user.tag} unmuted.`, ephemeral: false });
      return;
    }

    if (commandName === "warn") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const data = loadWarnings();
      data[user.id] = data[user.id] || [];
      data[user.id].push({ moderator: interaction.user.id, reason, timestamp: Date.now() });
      saveWarnings(data);
      await interaction.reply({ content: `⚠️ ${user.tag} warned. Reason: ${reason}` });
      const logCh = BOT_CONFIG[interaction.guild.id]?.logChannel;
      if (logCh) { const ch = interaction.guild.channels.cache.get(logCh); if (ch) ch.send({ content: `${user.tag} warned by ${interaction.user.tag}: ${reason}` }).catch(()=>{}); }
      return;
    }

    if (commandName === "warnings") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const user = interaction.options.getUser("member");
      const data = loadWarnings();
      const list = data[user.id] || [];
      if (!list.length) return interaction.reply({ content: `${user.tag} has no warnings.` , ephemeral: true});
      const mapped = list.map((w,i)=>`${i+1}. ${new Date(w.timestamp).toLocaleString()} - ${w.reason} (by <@${w.moderator}>)`).join("\n");
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setDescription(mapped).setColor(0xff5555)] });
      return;
    }

    if (commandName === "clear") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const amt = Math.min(Math.max(interaction.options.getInteger("amount") || 0, 1), 100);
      const messages = await interaction.channel.bulkDelete(amt, true).catch(e=>null);
      return interaction.reply({ content: `🧹 Deleted ${messages ? messages.size : 0} messages.`, ephemeral: false });
    }

    if (commandName === "slowmode") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const seconds = Math.min(Math.max(interaction.options.getInteger("seconds") || 0, 0), 21600);
      await interaction.channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
      return interaction.reply({ content: `🐌 Slowmode set to ${seconds}s.`, ephemeral: false });
    }

    if (commandName === "userinfo") {
      const user = interaction.options.getUser("member") || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);
      const embed = new EmbedBuilder().setTitle(`User Info - ${user.tag}`).setThumbnail(user.displayAvatarURL({dynamic:true}))
        .addFields(
          {name:"ID", value:user.id, inline:true},
          {name:"Joined", value: member ? new Date(member.joinedTimestamp).toLocaleString() : "N/A", inline:true},
          {name:"Created", value:new Date(user.createdTimestamp).toLocaleString(), inline:true},
          {name:"Roles", value: member ? member.roles.cache.map(r=>r.name).filter(n=>n!=="@everyone").slice(0,10).join(", ") || "None" : "None", inline:false}
        ).setColor(0x00ffff);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "serverinfo") {
      const g = interaction.guild;
      const embed = new EmbedBuilder().setTitle(`Server Info - ${g.name}`).setThumbnail(g.iconURL({dynamic:true}))
        .addFields(
          {name:"ID", value:g.id, inline:true},
          {name:"Members", value:`${g.memberCount}`, inline:true},
          {name:"Channels", value:`${g.channels.cache.size}`, inline:true},
          {name:"Owner", value:`<@${g.ownerId}>`, inline:true}
        ).setColor(0x99ccff);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === "setautorole") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const role = interaction.options.getRole("role", true);
      BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
      BOT_CONFIG[interaction.guild.id].autorole = role.id;
      saveConfig();
      return interaction.reply({ content: `✅ Autorole set to ${role.name}.`, ephemeral: true });
    }

    if (commandName === "setlogchannel") {
      if (!isAdmin) return interaction.reply({ content: "Admin only.", ephemeral: true });
      const ch = interaction.options.getChannel("channel", true);
      BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
      BOT_CONFIG[interaction.guild.id].logChannel = ch.id;
      saveConfig();
      return interaction.reply({ content: `✅ Log channel set to ${ch.name}.`, ephemeral: true });
    }

    // joinvc: silent join using @discordjs/voice
    if (commandName === "joinvc") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Connect) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const ch = interaction.options.getChannel("channel", true);
      if (!ch || !ch.isVoiceBased()) return interaction.reply({ content: "Please provide a voice channel.", ephemeral: true });
      try {
        // create connection and keep it
        const connection = joinVoiceChannel({
          channelId: ch.id,
          guildId: ch.guild.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
          selfMute: true,
          selfDeaf: true
        });
        // store in config so leavevc can access
        BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
        BOT_CONFIG[interaction.guild.id].vcChannel = ch.id;
        saveConfig();
        await interaction.reply({ content: `✅ Joined voice channel: ${ch.name}`, ephemeral: false });
      } catch (e) {
        console.error("joinvc error:", e);
        return interaction.reply({ content: `❌ Could not join: ${e.message || e}`, ephemeral: true });
      }
      return;
    }

    if (commandName === "leavevc") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Connect) && !isAdmin) return interaction.reply({ content: "Insufficient perms.", ephemeral: true });
      const cfg = BOT_CONFIG[interaction.guild.id] || {};
      const vcId = cfg.vcChannel;
      if (!vcId) return interaction.reply({ content: "Not configured to a VC.", ephemeral: true });
      try {
        // destroy connection if exists
        const conn = getVoiceConnection(interaction.guild.id);
        if (conn) conn.destroy();
        BOT_CONFIG[interaction.guild.id].vcChannel = null;
        saveConfig();
        return interaction.reply({ content: "👋 Left configured voice channel.", ephemeral: false });
      } catch (e) {
        return interaction.reply({ content: `❌ Error leaving: ${e.message || e}`, ephemeral: true });
      }
    }

  } catch (err) {
    console.error("Interaction handler error:", err);
    try { interaction.reply({ content: "An error occurred.", ephemeral: true }); } catch {}
  }
});

// on ready: register commands (if env has CLIENT_ID). Also show status
client.once("ready", async () => {
  console.log(`🔥 Yakuza Esports Bot Logged in as ${client.user.tag}`);
  // register commands automatically if CLIENT_ID provided
  await registerCommands().catch(()=>{});
  client.user.setActivity("Yakuza | Moderation", { type: 3 }); // Watching

  // If bot config has vcChannel for any guilds, try to rejoin them silently
  for (const guildId of Object.keys(BOT_CONFIG)) {
    const cfg = BOT_CONFIG[guildId];
    if (cfg && cfg.vcChannel) {
      try {
        const ch = await client.channels.fetch(cfg.vcChannel).catch(()=>null);
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
      } catch (e) { console.warn("Auto join error:", e.message || e); }
    }
  }
});

// login
client.login(TOKEN).catch(err => {
  console.error("Login failed:", err);
  process.exit(1);
});
