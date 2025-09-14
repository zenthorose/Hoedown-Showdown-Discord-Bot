const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avoid')
    .setDescription('Mark selected players to avoid each other in teams.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    // Allow up to 6 users to be selected
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('Select a player')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('Select another player')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player3')
        .setDescription('Select an optional player'))
    .addUserOption(option =>
      option.setName('player4')
        .setDescription('Select an optional player'))
    .addUserOption(option =>
      option.setName('player5')
        .setDescription('Select an optional player'))
    .addUserOption(option =>
      option.setName('player6')
        .setDescription('Select an optional player')),

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = true) {
      if (replied) {
        return interaction.followUp({ content, ephemeral: isEphemeral });
      } else {
        replied = true;
        return interaction.reply({ content, ephemeral: isEphemeral });
      }
    }

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
        return safeReply('❌ You do not have permission to use this command!');
      }

      // Collect selected users
      const users = [];
      for (let i = 1; i <= 6; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return safeReply('❌ You must select at least 2 players.');
      }

      console.log('📤 Sending avoid data to GAS:', JSON.stringify({ command: 'avoid', players: users }, null, 2));

      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      await axios.post(triggerUrl, { command: 'avoid', players: users });

      await safeReply(`✅ Avoid list updated for ${users.length} players.`);
      await logUsage(`✅ Avoid list updated for ${users.map(u => u.username).join(', ')}`);

    } catch (error) {
      console.error("❌ Error executing /avoid:", error);
      await logUsage(`❌ Error: ${error.message}`);
      await safeReply('❌ Failed to execute /avoid. Please try again.');
    }
  }
};
