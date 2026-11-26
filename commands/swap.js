const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const {
  getPendingCurrentDraftForRound,
  swapCurrentDraftPlayersById
} = require('../database/teamDrafts');
const { refreshTeamCheckPreview } = require('../utils/teamCheckPreview');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Swap the positions of up to 5 player pairs in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    // --- First swap set (required) ---
    .addUserOption(option =>
      option.setName('player1a')
        .setDescription('First player of swap #1')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2a')
        .setDescription('Second player of swap #1')
        .setRequired(true))
    // --- Extra swap sets (optional) ---
    .addUserOption(option =>
      option.setName('player1b').setDescription('First player of swap #2'))
    .addUserOption(option =>
      option.setName('player2b').setDescription('Second player of swap #2'))
    .addUserOption(option =>
      option.setName('player1c').setDescription('First player of swap #3'))
    .addUserOption(option =>
      option.setName('player2c').setDescription('Second player of swap #3'))
    .addUserOption(option =>
      option.setName('player1d').setDescription('First player of swap #4'))
    .addUserOption(option =>
      option.setName('player2d').setDescription('Second player of swap #4'))
    .addUserOption(option =>
      option.setName('player1e').setDescription('First player of swap #5'))
    .addUserOption(option =>
      option.setName('player2e').setDescription('Second player of swap #5')),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", flags: 64 });
    }

    const round = interaction.options.getInteger('round');

    // --- Build swaps array ---
    const swapPairs = ['a', 'b', 'c', 'd', 'e'];
    const swaps = [];

    for (const suffix of swapPairs) {
      const p1 = interaction.options.getUser(`player1${suffix}`);
      const p2 = interaction.options.getUser(`player2${suffix}`);
      if (p1 && p2) {
        swaps.push({
          player1: { username: p1.username, id: p1.id },
          player2: { username: p2.username, id: p2.id }
        });
      }
    }

    if (swaps.length === 0) {
      return interaction.reply({ content: "❌ You must specify at least one swap pair.", flags: 64 });
    }
    if (swaps.some((swap) => swap.player1.id === swap.player2.id)) {
      return interaction.reply({ content: '❌ Each swap must contain two different players.', flags: 64 });
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/swap** by **${userTag}** (${userId}) in **#${channelName}** for Round #${round}\n` +
            `Swaps: ${swaps.map(s => `${s.player1.username} ↔ ${s.player2.username}`).join(", ")}\n${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }
    let teamCollections;
    let currentDraft;

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

      console.log(`Received swap command: round=${round}, swaps=${JSON.stringify(swaps)}`);

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

      // --- Initial Reply ---
      let replyMessage = await interaction.reply({
        content: `🔄 Processing ${swaps.length} swap(s) for Round #${round}...`,
        fetchReply: true
      });

      const results = [];
      let successCount = 0;
      let teamCheckSyncCount = 0;
      let updatedTeamCheckDraft;
      const teamCheckSyncErrors = [];
      for (const swap of swaps) {
        try {
          updatedTeamCheckDraft = await swapCurrentDraftPlayersById({
            teamCheckCollection: teamCollections.teamCheck,
            avoidsCollection: teamCollections.avoids,
            previousPairingsCollection: teamCollections.previousPairings,
            round,
            generationId: currentDraft.generationId,
            player1DiscordId: swap.player1.id,
            player2DiscordId: swap.player2.id
          });
          teamCheckSyncCount += 1;
          successCount += 1;
          results.push({
            pair: [swap.player1.username, swap.player2.username],
            status: 'ok'
          });
        } catch (syncError) {
          teamCheckSyncErrors.push(
            `${swap.player1.username} ↔ ${swap.player2.username}: ${syncError.message}`
          );
          results.push({
            pair: [swap.player1.username, swap.player2.username],
            status: 'failed',
            reason: syncError.message
          });
        }
      }
      const failCount = results.length - successCount;
      let previewRefreshError;
      if (updatedTeamCheckDraft) {
        try {
          updatedTeamCheckDraft = await refreshTeamCheckPreview(
            interaction.client,
            updatedTeamCheckDraft
          );
        } catch (error) {
          previewRefreshError = error.message;
        }
      }

      const details = results.map((r, i) =>
        `**${i + 1}.** ${r.pair[0]} ↔ ${r.pair[1]} → ${r.status === "ok" ? "✅ Success" : `❌ Failed (${r.reason || "unknown"})`}`
      ).join("\n");

      const syncDetails = successCount > 0
        ? (teamCheckSyncCount
          ? `\n\n✅ Team Check and desktop app updated for ${teamCheckSyncCount} swap(s).` +
            (updatedTeamCheckDraft?.previewStatus === 'disabled'
              ? '\nℹ️ The Discord Team Check preview is disabled.'
              : previewRefreshError
                ? `\n⚠️ The Team Check update succeeded, but the Discord preview refresh failed: ${previewRefreshError}`
                : '\n✅ Discord Team Check preview refreshed.')
          : '') +
          (teamCheckSyncErrors.length
            ? `\n⚠️ Some swaps could not be saved to Team Check:\n${teamCheckSyncErrors.join('\n')}`
            : '')
        : '';
      const finalMessage = `📋 Swap results for Round #${round}:\n${details}\n\n✅ ${successCount} succeeded | ❌ ${failCount} failed${syncDetails}`;

      await replyMessage.edit(finalMessage);
      await logUsage(
        `✅ ${successCount} success | ❌ ${failCount} failed | ` +
        `Team Check synced ${teamCheckSyncCount}; sync failures ${teamCheckSyncErrors.length}`
      );

      // Optionally auto-delete after 15s
      setTimeout(async () => {
        try { await replyMessage.delete(); } catch {}
      }, 15000);

    } catch (error) {
      console.error("❌ Error in swap command:", error);
      const errorMessage = error.statusCode
        ? `❌ Swap failed: ${error.message}`
        : '❌ Swap failed. Please try again.';

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply({ content: errorMessage, flags: 64 });
      }

      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};