// main.js — full updated version
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

// Reaction posts manager (your existing class)
const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

// Config (from your config.json)
const { Hoedown_New_banner, STATUS_CHANNEL_ID, SPREADSHEET_ID, SHEET_MEMBERS } = require('./config.json');

// Google credentials object (you already build these via env in your project)
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

// --- Load slash commands from /commands ---
const commandFiles = fs.readdirSync('./commands/').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  try {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) {
      client.commands.set(command.data.name, command);
    } else {
      console.error(`⚠️ Command file ${file} missing proper structure.`);
    }
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

  // Test connectivity to Google Apps Script (optional)
  try {
    if (process.env.Google_Apps_Script_URL) {
      const response = await axios.get(process.env.Google_Apps_Script_URL);
      console.log("Google Script test response:", response.data);
    }
  } catch (err) {
    console.error("Error contacting Google Apps Script:", err?.message || err);
  }

  // Post startup status to configured status channel
  try {
    const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID);
    if (statusChannel) {
      const currentTime = moment().tz("America/New_York").format("hh:mm:ss A [EST]");
      await statusChannel.send(`✅ The Hoedown Showdown Bot is now online and ready to start blasting! 🚀\n🕒 Current Time: **${currentTime}**`);
    } else {
      console.warn("⚠️ Status channel not found (check config.json STATUS_CHANNEL_ID).");
    }
  } catch (err) {
    console.error("❌ Failed to send startup status:", err);
  }
});

// --- Auto-run member-update when someone joins (run as the BOT) ---
client.on('guildMemberAdd', async (member) => {
  console.log(`🎉 New member joined: ${member.user.tag} (${member.id})`);

  try {
    const commandName = 'member-update';
    const command = client.commands.get(commandName);
    if (!command) {
      console.error(`❌ Command "${commandName}" not found.`);
      return;
    }

    // Use the bot member (so permission checks validate the bot's roles)
    const botMember = member.guild.members.me;

    // Create a minimal fake interaction for your command to consume.
    // Note: command.execute should work with this shape (we matched earlier pattern).
    const fakeInteraction = {
      user: client.user,
      member: botMember,
      guild: member.guild,
      client,
      commandName,
      options: {
        getString: () => null,
        getUser: () => null,
        getRole: () => null,
        getChannel: () => null
      },
      reply: async (data) => {
        const logChannel = member.guild.channels.cache.get(STATUS_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(data?.content || `✅ Auto-run ${commandName} for ${member.user.tag}`);
        }
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

// --- Modmail handler (DM -> ticket) ---
const modmailHandler = require('./events/swampmail.js');
// We'll forward all messageCreate events to the modmail handler and also process guild messages here
client.on('messageCreate', async (message) => {
  try {
    // Give modmail handler a chance to process (it will return quickly if not a DM)
    try { await modmailHandler(client, message); } catch (e) { console.error('Modmail handler error:', e); }

    // Keep-alive ping (bot respond to !ping)
    if (message.content === '!ping') {
      try { await message.channel.send('Pong!'); } catch {}
      return;
    }

    // Word watcher (muffin) in a specific channel
    const targetChannelId = '1052393482699948132';
    const targetWord = 'muffin';
    if (!message.author.bot && message.channel?.id === targetChannelId && message.content.toLowerCase().includes(targetWord)) {
      try {
        const customEmoji = message.guild?.emojis.cache.find(e => e.name === 'Muffin');
        if (customEmoji) {
          await message.react(customEmoji);
        } else {
          console.warn('Custom muffin emoji not found.');
        }
      } catch (err) {
        console.error('Error reacting to muffin word:', err);
      }
    }
  } catch (err) {
    console.error('Unexpected messageCreate error:', err);
  }
});

// --- Button interaction handler + command interactions (single listener) ---
client.on('interactionCreate', async (interaction) => {
  try {
    // Button interactions (muffin button)
    if (interaction.isButton()) {
      if (interaction.customId === 'muffin') {
        try {
          await interaction.update({
            content: 'Howdy partner, here is your muffin! <:muffin:1355005309604593714>',
            embeds: [{
              image: { url: 'https://static.wikia.nocookie.net/teamfourstar/images/e/e5/ImagesCAJ3ZF22.jpg/revision/latest?cb=20120306001642' }
            }],
            components: []
          });
        } catch (err) {
          console.error('Muffin button error:', err);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Something went wrong!', ephemeral: true });
          }
        }
      }
      return;
    }

    // Slash commands
    if (!interaction.isCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, reactionPostsManager);
    } catch (err) {
      console.error(`❌ Error executing command ${interaction.commandName}:`, err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ There was an error executing this command!', ephemeral: true });
        } else {
          await interaction.editReply({ content: '❌ There was an error executing this command!' });
        }
      } catch (e) {
        console.error('Error sending command error reply:', e);
      }
    }
  } catch (err) {
    console.error('Unexpected interactionCreate error:', err);
  }
});

// --- Express endpoints (keep-alive + sendmessage) ---
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
  // Finally login the bot
  if (!botToken) {
    console.error('❌ BOT_TOKEN missing in environment!');
    process.exit(1);
  }
  client.login(botToken).catch(err => {
    console.error('❌ Failed to login bot:', err);
    process.exit(1);
  });
});
