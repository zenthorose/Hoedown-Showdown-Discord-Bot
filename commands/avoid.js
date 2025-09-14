const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

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

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
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
        return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
      }

      // Collect selected users
      const users = [];
      for (let i = 1; i <= 6; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return interaction.reply({ content: '❌ You must select at least 2 players.', ephemeral: true });
      }

      console.log('📤 Sending avoid data to GAS:', JSON.stringify({ command: 'avoid', users }, null, 2));

      // --- Defer reply to avoid Unknown interaction errors ---
      replyMessage = await interaction.deferReply({ ephemeral: true });

      // --- Trigger the GAS avoid function ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const response = await axios.post(triggerUrl, { command: 'avoid', users });
      console.log('✅ Google Apps Script response:', response.data);

      const { success, addedPairs, skippedPairs } = response.data;

      let displayMessage = success
        ? `✅ Avoid list updated. Added: ${addedPairs}, Skipped (existing): ${skippedPairs}`
        : `❌ Failed to update avoid list.`;

      // --- Edit deferred reply with result ---
      await interaction.editReply(displayMessage);
      await logUsage(`→ ${displayMessage}. Players: ${users.map(u => u.username).join(', ')}`);

      // Optional: delete reply after 5 seconds
      setTimeout(async () => {
        try { await interaction.deleteReply(); } catch { }
      }, 5000);

    } catch (error) {
      console.error("❌ Error executing /avoid:", error);
      await logUsage(`❌ Error: ${error.message}`);

      try {
        if (replyMessage) {
          await interaction.editReply('❌ There was an error executing this command. Please try again.');
        } else {
          await interaction.reply({ content: '❌ There was an error executing this command. Please try again.', ephemeral: true });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  },
};
