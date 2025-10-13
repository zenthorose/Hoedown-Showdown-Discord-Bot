// main.js — updated version
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const fs = require('fs');
const axios = require('axios');
const express = require('express');

const client = new Client({
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMembers
  ]
});

const prefix = '.';
client.commands = new Collection();
const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

// Reaction posts manager
const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

// Config
const { Hoedown_New_banner, STATUS_CHANNEL_ID, SPREADSHEET_ID, SHEET_MEMBERS } = require('./config.json');

// Google credentials
const credentials = {
  type: "service_account",
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT
};

// --- Load slash commands ---
const commandFiles = fs.readdirSync('./commands/').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  try {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) client.commands.set(command.data.name, command);
    else console.error(`⚠️ Command file ${file} missing proper structure.`);
  } catch (err) {
    console.error(`⚠️ Failed to load command ${file}:`, err);
  }
}

// --- Register slash commands (global) ---
const rest = new REST({ version: '10' }).setToken(botToken);
(async () => {
  try {
    console.log('🔄 Registering slash commands...');
    const commands = client.commands.map(cmd => cmd.data.toJSON());
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
})();

// --- Ready event ---
client.once('ready', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  // Test connectivity to Google Apps Script
  try {
    if (process.env.Google_Apps_Script_URL) {
      const response = await axios.get(process.env.Google_Apps_Script_URL);
      console.log("Google Script test response:", response.data);
    }
  } catch (err) {
    console.error("Error contacting Google Apps Script:", err?.message || err);
  }

  // Post startup status
  try {
    const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID);
    if (statusChannel) {
      const currentTime = moment().tz("America/New_York").format("hh:mm:ss A [EST]");
      await statusChannel.send(`✅ The Hoedown Showdown Bot is now online! 🚀\n🕒 Current Time: **${currentTime}**`);
    } else console.warn("⚠️ Status channel not found.");
  } catch (err) {
    console.error("❌ Failed to send startup status:", err);
  }
});

// --- Auto-run member-update ---
client.on('guildMemberAdd', async (member) => {
  console.log(`🎉 New member joined: ${member.user.tag} (${member.id})`);
  try {
    const commandName = 'member-update';
    const command = client.commands.get(commandName);
    if (!command) return console.error(`❌ Command "${commandName}" not found.`);

    const fakeInteraction = {
      user: client.user,
      member: member.guild.members.me,
      guild: member.guild,
      client,
      commandName,
      options: { getString: () => null, getUser: () => null, getRole: () => null, getChannel: () => null },
      reply: async (data) => {
        const logChannel = member.guild.channels.cache.get(STATUS_CHANNEL_ID);
        if (logChannel) await logChannel.send(data?.content || `✅ Auto-run ${commandName} for ${member.user.tag}`);
        console.log(`[auto-command] Replied for ${member.user.tag}`);
      },
      deferReply: async () => {},
      editReply: async () => {}
    };

    await command.execute(fakeInteraction, reactionPostsManager);
    console.log(`✅ Auto-ran "${commandName}" for ${member.user.tag}`);
  } catch (err) {
    console.error(`❌ Failed to auto-run member-update:`, err);
  }
});

// --- Message Create (modmail + muffin watcher) ---
const modmailHandler = require('./events/swampmail.js');
client.on('messageCreate', async (message) => {
  try {
    await modmailHandler(client, message);

    if (message.content === '!ping') await message.channel.send('Pong!');

    const targetChannelId = '1052393482699948132';
    const targetWord = 'muffin';
    if (!message.author.bot && message.channel?.id === targetChannelId && message.content.toLowerCase().includes(targetWord)) {
      const customEmoji = message.guild?.emojis.cache.find(e => e.name === 'Muffin');
      if (customEmoji) await message.react(customEmoji);
      else console.warn('Custom muffin emoji not found.');
    }
  } catch (err) {
    console.error('Unexpected messageCreate error:', err);
  }
});

// --- Interaction handler ---
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'muffin') {
        try {
          await interaction.update({
            content: 'Howdy partner, here is your muffin! <:muffin:1355005309604593714>',
            embeds: [{ image: { url: 'https://static.wikia.nocookie.net/teamfourstar/images/e/e5/ImagesCAJ3ZF22.jpg/revision/latest?cb=20120306001642' } }],
            components: []
          });
        } catch (err) {
          console.error('Muffin button error:', err);
          if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ Something went wrong!', ephemeral: true });
        }
      }
      return;
    }

    if (!interaction.isCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, reactionPostsManager);
    } catch (err) {
      console.error(`❌ Error executing command ${interaction.commandName}:`, err);
      if (!interaction.replied && !interaction.deferred)
        await interaction.reply({ content: '❌ There was an error executing this command!', ephemeral: true });
      else await interaction.editReply({ content: '❌ There was an error executing this command!' });
    }
  } catch (err) {
    console.error('Unexpected interactionCreate error:', err);
  }
});

// --- Express endpoints ---
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.get('/ping', (req, res) => res.send('Pong!'));

app.post('/sendmessage', async (req, res) => {
  const { channelId, message } = req.body;
  if (!channelId || !message) return res.status(400).json({ error: 'Missing required fields: channelId and message' });

  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send(message);
    res.status(200).json({ success: `Message sent to channel ${channelId}` });
  } catch (err) {
    console.error('Error sending message to Discord:', err);
    res.status(500).json({ error: 'Failed to send message to Discord' });
  }
});

app.listen(port, () => {
  console.log(`🌐 Express server running on port ${port}`);
  if (!botToken) {
    console.error('❌ BOT_TOKEN missing in environment!');
    process.exit(1);
  }
  client.login(botToken).catch(err => {
    console.error('❌ Failed to login bot:', err);
    process.exit(1);
  });
});
