const { SlashCommandBuilder } = require('@discordjs/builders');
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

      // --- Defer reply to avoid Unknown interaction errors ---
      try {
        await interaction.deferReply({ flags: 64 });
        replyMessage = true;
      } catch (err) {
        console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
        replyMessage = false;
      }

      const database = await connectHoedownInfoDatabase();
      const mongoResult = await addAvoidRelationships(database, users);
      const displayMessage =
        `✅ MongoDB (HoedownInfo.${mongoResult.collectionName}) saved ` +
        `${mongoResult.relationshipCount} avoid relationship(s).`;

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
          await interaction.editReply(`❌ Failed to update the MongoDB avoid list: ${error.message}`);
        } else {
          await interaction.reply({ content: `❌ Failed to update the MongoDB avoid list: ${error.message}`, flags: 64 });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  },
};