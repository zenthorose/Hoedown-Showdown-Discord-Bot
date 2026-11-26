const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const {
  getPendingCurrentDraftForRound,
  replaceCurrentDraftSlot
} = require('../database/teamDrafts');
const { refreshTeamCheckPreview } = require('../utils/teamCheckPreview');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replace')
    .setDescription('Replace a player or filler in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('removeplayer')
        .setDescription('The player to be removed (Discord user)')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('removefiller')
        .setDescription('The filler number to remove (e.g., 1 for Filler #1)')
        .setMinValue(1)
        .setRequired(false))
    .addUserOption(option =>
      option.setName('addplayer')
        .setDescription('The player to be added (Discord user)')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('addfiller')
        .setDescription('The filler number to add (e.g., 1 for Filler #1)')
        .setMinValue(1)
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", flags: 64 });
    }

    const round = interaction.options.getInteger('round');
    const removeUser = interaction.options.getUser('removeplayer');
    const removeFillerNum = interaction.options.getInteger('removefiller');
    const addUser = interaction.options.getUser('addplayer');
    const addFillerNum = interaction.options.getInteger('addfiller');

    // --- Validation ---
    if (Boolean(removeUser) === Number.isInteger(removeFillerNum)) {
      return interaction.reply({ content: '❌ Specify exactly one player or filler to remove.', flags: 64 });
    }
    if (Boolean(addUser) === Number.isInteger(addFillerNum)) {
      return interaction.reply({ content: '❌ Specify exactly one player or filler to add.', flags: 64 });
    }

    // --- Convert filler numbers to "Filler #" ---
    const removeFiller = removeFillerNum ? `Filler ${removeFillerNum}` : null;
    const addFiller = addFillerNum ? `Filler ${addFillerNum}` : null;

    let teamCollections;
    let currentDraft;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/replace** by **${userTag}** (${userId}) in **#${channelName}** for Round #${round} | Removed: ${removeUser?.tag || removeFiller} ➝ Added: ${addUser?.tag || addFiller} ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // --- Permission Check ---
      const allowedRoles = config.allowedRoles || [];
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

      if (!hasRequiredRole) {
        await interaction.reply({ content: '❌ You do not have permission to use this command!', flags: 64 });
        await logUsage("⚠️ Permission denied.");
        return;
      }

      const database = await connectHoedownInfo();
      teamCollections = database.collections;
      currentDraft = await getPendingCurrentDraftForRound({
        teamCheckCollection: teamCollections.teamCheck,
        round
      });

      console.log(`Received replace command: round=${round}, remove=${removeUser?.tag || removeFiller}, add=${addUser?.tag || addFiller}`);

      // --- Clear old bot messages ---
      try {
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        const botMessages = fetchedMessages.filter(msg => msg.author.bot);
        if (botMessages.size > 0) {
          await interaction.channel.bulkDelete(botMessages, true);
          console.log(`🧹 Deleted ${botMessages.size} bot messages.`);
        }
      } catch (clearError) {
        console.error("❌ Error clearing bot messages:", clearError);
      }

      // --- Acknowledge Command ---
      let replyMessage;
      try {
        replyMessage = await interaction.reply({
          content: `🔄 Processing replacement for Round #${round}...`,
          fetchReply: true
        });
      } catch (err) {
        console.error("Error sending processing reply:", err);
      }

      const updatedDraft = await replaceCurrentDraftSlot({
        teamCheckCollection: teamCollections.teamCheck,
        membersCollection: teamCollections.members,
        avoidsCollection: teamCollections.avoids,
        previousPairingsCollection: teamCollections.previousPairings,
        round,
        generationId: currentDraft.generationId,
        removeDiscordId: removeUser?.id,
        removeFillerNumber: removeFillerNum,
        addDiscordId: addUser?.id,
        addFillerNumber: addFillerNum
      });
      let userMessage =
        `✅ Replacement completed in the current Team Check draft for Round #${round}: ` +
        `**${removeUser?.username || removeFiller}** ➝ **${addUser?.username || addFiller}**.`;
      let logSuffix = '✅ Replacement saved to MongoDB TeamCheck.';
      try {
        const previewDraft = await refreshTeamCheckPreview(interaction.client, updatedDraft);
        userMessage += previewDraft.previewStatus === 'disabled'
          ? '\nℹ️ Team Check and the desktop app were updated; the Discord preview is disabled.'
          : '\n✅ Team Check, the desktop app, and the Discord preview were updated.';
        logSuffix = '✅ Replacement and Discord Team Check preview synchronized.';
      } catch (previewError) {
        userMessage += `\n⚠️ Team Check and desktop app updated, but the Discord preview refresh failed: ${previewError.message}`;
        logSuffix = `⚠️ Team Check synced; Discord preview refresh failed: ${previewError.message}`;
      }

      // --- Edit original reply ---
      if (replyMessage) {
        await replyMessage.edit(userMessage);
        setTimeout(async () => {
          try { await replyMessage.delete(); } catch (err) { console.error(err); }
        }, 8000);
      }

      await logUsage(logSuffix);

    } catch (error) {
      console.error("❌ Error in replace command:", error);
      const errorMessage = `❌ Replacement failed: ${error.message}`;

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply({ content: errorMessage, flags: 64 });
      }

      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};