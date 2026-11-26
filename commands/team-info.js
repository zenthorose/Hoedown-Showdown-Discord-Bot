const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const { ROUND_COUNT, roundCollectionName } = require('../database/roundCollections');

function escapeDiscordMarkdown(value) {
  return String(value).replace(/([\\_*~`|>])/g, '\\$1');
}

async function findLatestApprovedRound(roundsDatabase) {
  for (let round = ROUND_COUNT; round >= 1; round -= 1) {
    const snapshot = await roundsDatabase.collection(roundCollectionName(round)).findOne({
      _id: 'current',
      status: 'approved'
    });
    if (snapshot) {
      return {
        ...snapshot,
        round: Number.isInteger(snapshot.round) ? snapshot.round : round
      };
    }
  }
  return null;
}

module.exports = {
  findLatestApprovedRound,
  data: new SlashCommandBuilder()
    .setName('team-info')
    .setDescription('Repost the approved team info for this team (latest approved round).')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    // Only allow in configured team channels
    try {
      const channelId = interaction.channelId;
      const teamEntry = Object.entries(config.teamChannels || {}).find(([key, id]) => String(id) === String(channelId));
      if (!teamEntry) {
        return interaction.reply({ content: '❌ This command can only be used in configured team text channels.', ephemeral: true });
      }

      const teamKey = teamEntry[0]; // e.g., 'Team A'
      const teamName = teamKey.replace(/^Team\s+/, ''); // 'A'

      await interaction.deferReply();

      const { databases } = await connectHoedownInfo();
      const approvedRound = await findLatestApprovedRound(databases.rounds);
      if (!approvedRound) {
        return interaction.editReply('❌ No approved round was found in MongoDB.');
      }

      const round = approvedRound.round;
      const team = Array.isArray(approvedRound.teams)
        ? approvedRound.teams.find((entry) => entry.name === teamName)
        : null;
      const players = Array.isArray(team?.players) ? team.players : [];

      if (!players || players.length === 0) {
        return interaction.editReply(`No players found for Team ${teamName} in the latest approved round (#${round}).`);
      }

      let teamOutput = `📋 **Team ${teamName} — Round #${round}**\n\n`;
      for (const p of players) {
        const displayName = escapeDiscordMarkdown(p.name || p.username || p.discordId || 'Unknown');
        const steam = p.steamId || 'N/A';
        const stream = p.streamLink || 'N/A';
        teamOutput += `- ${displayName} | Steam: ${steam} | Stream: ${stream}\n`;
      }

      // Post to channel as visible message
      try {
        await interaction.editReply(teamOutput);
      } catch (e) {
        try { await interaction.followUp({ content: teamOutput }); } catch (e) { /* ignore */ }
      }

    } catch (err) {
      console.error('❌ Error in /team-info:', err);
      try { await interaction.editReply('⚠️ Error fetching team info.'); } catch { try { await interaction.followUp({ content: '⚠️ Error fetching team info.' }); } catch {} }
    }
  }
};
