const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { addAvoidRelationships } = require('../database/pairingImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avoid')
    .setDescription('Have the first player avoid the selected players in teams.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('The person requesting the avoid')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('Who they want to avoid')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player3')
        .setDescription('Another person they want to avoid'))
    .addUserOption(option =>
      option.setName('player4')
        .setDescription('Another person they want to avoid'))
    .addUserOption(option =>
      option.setName('player5')
        .setDescription('Another person they want to avoid'))
    .addUserOption(option =>
      option.setName('player6')
        .setDescription('Another person they want to avoid')),

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
        return interaction.reply({ content: '❌ You do not have permission to use this command!', flags: 64 });
      }

      // Collect selected users
      const users = [];
      for (let i = 1; i <= 6; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return interaction.reply({ content: '❌ You must select at least 2 players.', flags: 64 });
      }
      if (users.slice(1).some((user) => user.id === users[0].id)) {
        return interaction.reply({
          content: '❌ The player requesting avoids cannot also be selected as an avoided player.',
          flags: 64
        });
      }

      console.log('📤 Sending avoid data to GAS:', JSON.stringify({ command: 'avoid', users }, null, 2));

      // --- Defer reply to avoid Unknown interaction errors ---
      try {
        await interaction.deferReply({ flags: 64 });
        replyMessage = true;
      } catch (err) {
        console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
        replyMessage = false;
      }

      // --- Trigger the GAS avoid function ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const response = await axios.post(triggerUrl, { command: 'avoid', users });
      console.log('✅ Google Apps Script response:', response.data);

      const { success, addedPairs, skippedPairs } = response.data;
      if (!success) {
        const errorMessage = response.data.error || 'Google Sheets rejected the avoid update.';
        await interaction.editReply(`❌ Failed to update avoid list: ${errorMessage}`);
        await logUsage(`❌ Google Sheets update failed: ${errorMessage}`);
        return;
      }

      let displayMessage =
        `✅ Google Sheets updated. Added: ${addedPairs}, skipped (existing): ${skippedPairs}.`;
      try {
        const database = await connectHoedownInfoDatabase();
        const mongoResult = await addAvoidRelationships(database, users);
        displayMessage +=
          `\n✅ MongoDB (${mongoResult.collectionName}) synced ${mongoResult.relationshipCount} avoid relationship(s).`;
      } catch (error) {
        console.error('❌ MongoDB Avoids sync failed:', error);
        displayMessage += `\n⚠️ MongoDB (HoedownInfo.Avoids) sync failed: ${error.message}`;
      }

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
          await interaction.reply({ content: '❌ There was an error executing this command. Please try again.', flags: 64 });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  },
};