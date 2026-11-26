﻿require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const moment = require('moment-timezone');
const fs = require('fs');
const express = require('express');
const { updateBotStatus } = require('./events/swampmail');

// --- Global error & health handlers ---
function safeAppend(path, text) {
  try { fs.appendFileSync(path, text); } catch (e) { console.error('Failed to write log:', e); }
}

process.on('uncaughtException', (err) => {
  const msg = `[${new Date().toISOString()}] uncaughtException: ${err && err.stack ? err.stack : String(err)}\n`;
  safeAppend('./bot-crashes.log', msg);
  console.error('uncaughtException:', err);
  // Give logs a moment to flush, then exit so an external supervisor can restart if configured
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  const msg = `[${new Date().toISOString()}] unhandledRejection: ${String(reason)}\n`;
  safeAppend('./bot-crashes.log', msg);
  console.error('unhandledRejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down gracefully.');
  try { client?.destroy?.(); } catch (e) {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully.');
  try { client?.destroy?.(); } catch (e) {}
  process.exit(0);
});

// Periodic health snapshot (every 5 minutes)
setInterval(() => {
  try {
    const mem = process.memoryUsage();
    const msg = `[${new Date().toISOString()}] memory=${JSON.stringify(mem)}\n`;
    safeAppend('./bot-health.log', msg);
  } catch (e) { /* ignore */ }
}, 5 * 60 * 1000);

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

client.commands = new Collection();
const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

// Reaction posts manager
const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

// Config
const { Hoedown_New_banner, STATUS_CHANNEL_ID } = require('./config.json');

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

// --- Ready / clientReady event (compatibility across discord.js versions) ---
let _readyHandled = false;
async function onClientReady() {
  if (_readyHandled) return;
  _readyHandled = true;

  console.log(`✅ Bot online as ${client.user.tag}`);
  try { safeAppend('./bot-starts.log', `[${new Date().toISOString()}] online as ${client.user?.tag || 'unknown'}\n`); } catch (e) {}

  // Startup status
  try {
    const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID);
    if (statusChannel) {
      const currentTime = moment().tz("America/New_York").format("hh:mm:ss A [EST]");
      await statusChannel.send(`✅ The Hoedown Showdown Bot is now online! 🚀\n🕒 Current Time: **${currentTime}**`);
    } else console.warn("⚠️ Status channel not found.");
  } catch (err) {
    console.error("❌ Failed to send startup status:", err);
  }
  await updateBotStatus(client);
}

// Prefer the new event name; avoid registering the deprecated 'ready' listener
client.once('clientReady', onClientReady);

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

// --- Swampmail event handlers ---
const swampmail = require('./events/swampmail.js');
client.on('messageCreate', msg => swampmail.handleMessageCreate(client, msg));
client.on('messageUpdate', (oldMsg, newMsg) => swampmail.handleMessageUpdate(client, oldMsg, newMsg));
client.on('messageDelete', msg => swampmail.handleMessageDelete(client, msg));

// --- Muffin watcher in the messageCreate listener ---
client.on('messageCreate', async (message) => {
  try {
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
        if (interaction.isButton() && interaction.customId === 'muffin') {
      try {
        await interaction.update({
          content: 'Howdy partner, here is your muffin! <:muffin:1355005309604593714>',
          embeds: [{ image: { url: 'https://static.wikia.nocookie.net/teamfourstar/images/e/e5/ImagesCAJ3ZF22.jpg/revision/latest?cb=20120306001642' } }],
          components: []
        });
        } catch (err) {
          console.error('Muffin button error:', err);
          if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ Something went wrong!', flags: 64 });
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
        try {
          const alreadyAcknowledged = (typeof interaction.acknowledged !== 'undefined') ? interaction.acknowledged : (interaction.replied || interaction.deferred);
          const errorContent = { content: '❌ There was an error executing this command!', flags: 64 };

          if (!alreadyAcknowledged) {
            // Safe to reply directly
            try {
              await interaction.reply(errorContent);
            } catch (replyErr) {
              // If reply failed because interaction is already acknowledged or unknown, try followUp
              if (replyErr?.code === 40060 || replyErr?.code === 10062) {
                try { await interaction.followUp(errorContent); } catch (fuErr) {
                  console.warn('⚠️ Follow-up failed after reply error:', fuErr?.message || fuErr);
                }
              } else {
                console.warn('⚠️ Failed to send error reply to interaction:', replyErr?.message || replyErr);
              }
            }
          } else {
            // Interaction already acknowledged — use followUp or editReply when possible
            try {
              if (interaction.deferred || interaction.replied) {
                // Prefer editReply if we previously replied/deferred and can edit
                try { await interaction.editReply({ content: errorContent.content }); }
                catch (editErr) {
                  // If edit fails, fallback to followUp
                  if (editErr?.code === 10062) {
                    console.warn('⚠️ Unknown interaction when attempting editReply — skipping.');
                  } else {
                    try { await interaction.followUp(errorContent); }
                    catch (fuErr) { console.warn('⚠️ followUp failed after editReply error:', fuErr?.message || fuErr); }
                  }
                }
              } else {
                // If acknowledged but not replied/deferred (rare), try followUp
                try { await interaction.followUp(errorContent); }
                catch (fuErr) {
                  if (fuErr?.code === 10062) console.warn('⚠️ Unknown interaction when attempting followUp — skipping.');
                  else console.warn('⚠️ followUp failed for acknowledged interaction:', fuErr?.message || fuErr);
                }
              }
            } catch (innerErr) {
              console.warn('⚠️ Could not send error response to interaction (possible already acknowledged):', innerErr?.message || innerErr);
            }
          }
        } catch (replyErr) {
          console.warn('⚠️ Failed to send error response to interaction (unexpected):', replyErr?.message || replyErr);
        }
      }
  } catch (err) {
    console.error('Unexpected interactionCreate error:', err);
  }
});

// --- Express endpoints ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/ping', (req, res) => res.send('Pong!'));

async function startWebService() {
  const authEnvironment = ['MONGODB_ADMIN', 'JWT_SECRET', 'ADMIN_API_KEY'];
  const authConfigured = authEnvironment.some((name) => Boolean(process.env[name]));
  if (authConfigured) {
    const { createRuntime } = require('./electron-app/auth-service/server.cjs');
    const authRuntime = await createRuntime({ discordClient: client });
    app.use(authRuntime.app);
    console.log('🔐 Authentication API mounted on the bot service.');
  } else {
    console.warn('⚠️ Authentication API is disabled. Configure MONGODB_ADMIN, JWT_SECRET, and ADMIN_API_KEY to enable it.');
  }

  app.listen(port, async () => {
    console.log(`🌐 Express server running on port ${port}`);
    if (!botToken) {
      console.error('❌ BOT_TOKEN missing in environment!');
      process.exit(1);
    }
    try {
      await client.login(botToken);
      // If the library does not emit 'clientReady', call handler directly
      try { await onClientReady(); } catch (e) { /* already handled or error */ }
    } catch (err) {
      console.error('❌ Failed to login bot:', err);
      process.exit(1);
    }
  });
}

startWebService().catch((err) => {
  console.error('❌ Failed to start web service:', err);
  process.exit(1);
});