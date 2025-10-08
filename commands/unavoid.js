const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unavoid')
    .setDescription('Remove avoidance between two players.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('The person removing the avoid')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('Who’s being unavoided')
        .setRequired(true)),

  async execute(interaction) {
    let replyMessage;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`📝 **/unavoid** used by **${userTag}** in **#${channelName}** ${extra}`);
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

      // Collect the two users
      const users = [];
      for (let i = 1; i <= 2; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return interaction.reply({ content: '❌ You must select exactly 2 players.', ephemeral: true });
      }

      console.log('📤 Sending unavoid data to GAS:', JSON.stringify({ command: 'unavoid', users }, null, 2));

      // --- Defer reply to avoid Unknown interaction errors ---
      replyMessage = await interaction.deferReply({ ephemeral: true });

      // --- Trigger the GAS unavoid function ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const response = await axios.post(triggerUrl, { command: 'unavoid', users });
      console.log('✅ Google Apps Script response:', response.data);

      const { success, removedPairs, skippedPairs } = response.data;

      let displayMessage = success
        ? `✅ Avoid list updated. Removed: ${removedPairs}, Skipped (not found): ${skippedPairs}`
        : `❌ Failed to update avoid list.`;

      // --- Edit deferred reply with result ---
      await interaction.editReply(displayMessage);
      await logUsage(`→ ${displayMessage}. Players: ${users.map(u => u.username).join(', ')}`);

      // Optional: delete reply after 5 seconds
      setTimeout(async () => {
        try { await interaction.deleteReply(); } catch { }
      }, 5000);

    } catch (error) {
      console.error("❌ Error executing /unavoid:", error);
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
