const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

// Per-feature send toggles for this command
const SENDS = {
  LOGS: true,
  REPLIES: false,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avoid')
    .setDescription('Mark selected players to avoid each other in teams.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('The person Avoiding')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('Who’s being avoided')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player3')
        .setDescription('Who’s being avoided'))
    .addUserOption(option =>
      option.setName('player4')
        .setDescription('Who’s being avoided'))
    .addUserOption(option =>
      option.setName('player5')
        .setDescription('Who’s being avoided'))
    .addUserOption(option =>
      option.setName('player6')
        .setDescription('Who’s being avoided')),

  async execute(interaction) {
    let replyMessage;
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (!SENDS.REPLIES) {
        try {
          if (replied || interaction.deferred) {
            const res = await interaction.followUp({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          } else {
            const res = await interaction.reply({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          }
        } catch (err) {
          return null;
        }
      }

      const options = typeof content === 'string' ? { content } : content;
      if (isEphemeral) options.flags = 64;
      try {
        if (replied || interaction.deferred) {
          return await interaction.followUp(options);
        } else {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        }
      } catch (err) {
        try {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        } catch (err2) {
          return null;
        }
      }
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel && SENDS.LOGS) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`📝 **/avoid** used by **${userTag}** in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);
      await logUsage();

      if (!hasPermission) {
        await logUsage("❌ Permission denied");
        return safeReply('❌ You do not have permission to use this command!', true);
      }

      // Collect selected users
      const users = [];
      for (let i = 1; i <= 6; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return safeReply('❌ You must select at least 2 players.', true);
      }

      console.log('📤 Sending avoid data to GAS:', JSON.stringify({ command: 'avoid', users }, null, 2));

      // --- Acknowledge the interaction with a safe processing reply ---
      try {
        if (SENDS.REPLIES) {
          replyMessage = await safeReply({ content: '🔄 Processing avoid request...', fetchReply: true });
        } else replyMessage = false;
      } catch (err) {
        console.warn('⚠️ Initial reply failed, continuing without initial reply:', err?.message || err);
        replyMessage = false;
      }

      // --- Trigger the GAS avoid function ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const response = await axios.post(triggerUrl, { command: 'avoid', users });
      console.log('✅ Google Apps Script response:', response.data);

      const { success, addedPairs, skippedPairs } = response.data;

      let displayMessage = success
        ? `✅ Avoid list updated. Added: ${addedPairs}, Skipped (existing): ${skippedPairs}`
        : `❌ Failed to update avoid list.`;

      // --- Edit reply with result (robust flow) ---
      if (SENDS.REPLIES) {
        try {
          if (replyMessage && typeof replyMessage.edit === 'function') {
            await replyMessage.edit(displayMessage);
          } else if (interaction.deferred || interaction.replied) {
            await interaction.editReply(displayMessage);
          } else {
            await safeReply(displayMessage);
          }
        } catch (err) {
          await safeReply(displayMessage);
        }
      }
      await logUsage(`→ ${displayMessage}. Players: ${users.map(u => u.username).join(', ')}`);

      // Optional: delete reply after 5 seconds
      setTimeout(async () => {
        try { await interaction.deleteReply(); } catch { }
      }, 5000);

    } catch (error) {
      console.error("❌ Error executing /avoid:", error);
      await logUsage(`❌ Error: ${error.message}`);

      try {
        await safeReply('❌ There was an error executing this command. Please try again.', true);
      } catch (err) {
        console.error('❌ Failed to send error message via safeReply:', err);
      }
    }
  },
};
