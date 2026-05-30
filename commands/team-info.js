const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
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

      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) {
        return interaction.editReply('❌ Google Apps Script URL is not configured.');
      }

      const resp = await axios.post(triggerUrl, { command: 'team-info' });
      const data = resp.data;
      if (data.error) {
        return interaction.editReply(`❌ Error: ${data.error}`);
      }
      if (!data.success) {
        const reason = data.reason || data.message || 'Unknown';
        return interaction.editReply(`❌ Could not find approved round: ${reason}`);
      }

      const round = data.round;
      const teams = data.teams || {};
      const players = teams[teamName];

      if (!players || players.length === 0) {
        return interaction.editReply(`No players found for Team ${teamName} in the latest approved round (#${round}).`);
      }

      let teamOutput = `📋 **Team ${teamName} — Round #${round}**\n\n`;
      for (const p of players) {
        const steam = p.steamId || 'N/A';
        const stream = p.streamLink || 'N/A';
        teamOutput += `- ${p.name} | Steam: ${steam} | Stream: ${stream}\n`;
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
