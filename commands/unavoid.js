const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { removeAvoidRelationship } = require('../database/pairingImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unavoid')
    .setDescription('Remove the first player’s avoid of the second player.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('The person whose avoid request is being removed')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('The person they currently avoid')
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
        return interaction.reply({ content: '❌ You do not have permission to use this command!', flags: 64 });
      }

      // Collect the two users
      const users = [];
      for (let i = 1; i <= 2; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) users.push({ username: user.username, id: user.id });
      }

      if (users.length < 2) {
        return interaction.reply({ content: '❌ You must select exactly 2 players.', flags: 64 });
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
      const mongoResult = await removeAvoidRelationship(database, users[0], users[1]);
      const mongoStatus = mongoResult.removed
        ? 'relationship removed'
        : mongoResult.foundDocument
          ? 'relationship was already absent'
          : 'requesting player had no Avoids document';
      const displayMessage = `✅ MongoDB (HoedownInfo.${mongoResult.collectionName}): ${mongoStatus}.`;

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