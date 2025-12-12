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

// FILES
const WARN_FILE = path.join(__dirname, "warnings.json");
if (!fs.existsSync(WARN_FILE)) fs.writeFileSync(WARN_FILE, JSON.stringify({}));

const CONFIG_FILE = path.join(__dirname, "botconfig.json");
let BOT_CONFIG = {};
try { BOT_CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { BOT_CONFIG = {}; }
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(BOT_CONFIG, null, 2)); }

// ENV
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "";
const GUILD_ID = process.env.GUILD_ID || "";

if (!TOKEN) {
  console.error("ERROR: TOKEN missing.");
  process.exit(1);
}

// CLIENT
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

// WARN SYSTEM
function loadWarnings() {
  try { return JSON.parse(fs.readFileSync(WARN_FILE, "utf8")); }
  catch { return {}; }
}
function saveWarnings(data) {
  fs.writeFileSync(WARN_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ANTI-NUKE
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

// REGISTER SLASH COMMANDS
async function registerCommands() {
  const commandBuilders = [
    new SlashCommandBuilder().setName("ping").setDescription("Bot latency"),

    new SlashCommandBuilder()
      .setName("announce").setDescription("Send announcement")
      .addStringOption(o => o.setName("message").setDescription("Text").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("kick").setDescription("Kick user")
      .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("ban").setDescription("Ban user")
      .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("warn").setDescription("Warn member")
      .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("warnings").setDescription("View warnings")
      .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true)),

    new SlashCommandBuilder()
      .setName("userinfo").setDescription("User info")
      .addUserOption(o => o.setName("member").setDescription("Member")),

    new SlashCommandBuilder()
      .setName("setautorole").setDescription("Set auto role")
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("setlogchannel").setDescription("Set log channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("joinvc").setDescription("Join voice channel")
      .addChannelOption(o => o.setName("channel").setDescription("VC").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect),

    new SlashCommandBuilder()
      .setName("leavevc").setDescription("Leave voice channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.Connect)
  ];

  const commands = commandBuilders.map(c => c.toJSON());

  const joinCmd = commands.find(c => c.name === "joinvc");
  if (joinCmd) joinCmd.options[0].channel_types = [2];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(
      GUILD_ID
        ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
        : Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
  } catch (e) {
    console.error(e);
  }
}

//
//  🔥 FIXED JOIN EVENT (NO DUPLICATE)
//
client.on("guildMemberAdd", async (member) => {
  const guildConf = BOT_CONFIG[member.guild.id] || {};

  // autorole
  if (guildConf.autorole) {
    try { await member.roles.add(guildConf.autorole, "Auto-role"); }
    catch (e) { console.log("Autorole err:", e); }
  }

  // welcome message
  const welcomeChannel = member.guild.channels.cache.get("1449015370244423690");
  if (welcomeChannel) {
    const embed = new EmbedBuilder()
      .setTitle("🔥 Welcome to Yakuza Esports! 🔥")
      .setDescription(
        `Welcome <@${member.id}>!\n\nWe’re hyped to have you joining us and sticking with the squad! 💮⚔️\n` +
        `Let’s vibe, grow, and make big moves together. 🏆🔥`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
      .setImage("https://i.ibb.co/ZLxmW7f/yakuza-banner.png")
      .setColor(0xff0000)
      .setFooter({ text: `Yakuza Esports • Member #${member.guild.memberCount}` })
      .setTimestamp();

    welcomeChannel.send({ embeds: [embed] });
  }
});

//
//  💨 LEAVE MESSAGE EVENT
//
client.on("guildMemberRemove", async (member) => {
  const leaveChannel = member.guild.channels.cache.get("1448718756191801556");
  if (!leaveChannel) return;

  const embed = new EmbedBuilder()
    .setTitle("💨 Member Left Yakuza Esports")
    .setDescription(
      `**${member.user.username}** has left Yakuza Esports.\n\n` +
      `We appreciate the time you spent with us 🙏\n` +
      `Wishing you the best — keep grinding and stay winning ⚔️🔥`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .setColor(0xff6600)
    .setTimestamp()
    .setFooter({ text: "Yakuza Esports" });

  leaveChannel.send({ embeds: [embed] });
});

// INTERACTIONS
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (name === "ping") return interaction.reply(`🏓 ${client.ws.ping}ms`);

  if (name === "setautorole") {
    if (!isAdmin) return interaction.reply({ content: "Admin only", ephemeral: true });
    BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
    BOT_CONFIG[interaction.guild.id].autorole = interaction.options.getRole("role").id;
    saveConfig();
    return interaction.reply("Autorole added.");
  }

  if (name === "setlogchannel") {
    if (!isAdmin) return interaction.reply({ content: "Admin only", ephemeral: true });
    BOT_CONFIG[interaction.guild.id] = BOT_CONFIG[interaction.guild.id] || {};
    BOT_CONFIG[interaction.guild.id].logChannel = interaction.options.getChannel("channel").id;
    saveConfig();
    return interaction.reply("Log channel set.");
  }

  if (name === "joinvc") {
    const ch = interaction.options.getChannel("channel");
    try {
      joinVoiceChannel({
        channelId: ch.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfMute: true,
        selfDeaf: true
      });
      BOT_CONFIG[interaction.guild.id].vcChannel = ch.id;
      saveConfig();
      interaction.reply(`Joined **${ch.name}**`);
    } catch (e) {
      interaction.reply("Error joining VC.");
    }
  }

  if (name === "leavevc") {
    const conn = getVoiceConnection(interaction.guild.id);
    if (conn) conn.destroy();
    BOT_CONFIG[interaction.guild.id].vcChannel = null;
    saveConfig();
    interaction.reply("Left voice channel.");
  }
});

// READY
client.once("ready", async () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
  client.user.setActivity("Yakuza | Moderation", { type: 3 });

  await registerCommands();

  // auto rejoin VC
  for (const gid of Object.keys(BOT_CONFIG)) {
    const id = BOT_CONFIG[gid].vcChannel;
    if (!id) continue;
    try {
      const ch = await client.channels.fetch(id);
      if (ch && ch.isVoiceBased()) {
        joinVoiceChannel({
          channelId: id,
          guildId: ch.guild.id,
          adapterCreator: ch.guild.voiceAdapterCreator,
          selfMute: true,
          selfDeaf: true
        });
      }
    } catch {}
  }
});

// LOGIN
client.login(TOKEN);
