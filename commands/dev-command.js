const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only command that separates members by East/West roles.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Permission check
    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    try {
      const guild = interaction.guild;
      const eastRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'east');
      const westRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'west');

      if (!eastRole || !westRole) {
        return interaction.editReply('❌ Could not find "East" or "West" roles.');
      }

      // Create arrays of usernames
      const eastMembers = [];
      const westMembers = [];

      guild.members.cache.forEach(member => {
        if (member.roles.cache.has(eastRole.id)) {
          eastMembers.push(member.user.username);
        } else if (member.roles.cache.has(westRole.id)) {
          westMembers.push(member.user.username);
        }
      });

      // Prepare output
      const eastList = eastMembers.length ? eastMembers.join(', ') : 'None';
      const westList = westMembers.length ? westMembers.join(', ') : 'None';

      const message = 
        `✅ **Member Separation Complete**\n\n` +
        `**East (${eastMembers.length}):** ${eastList}\n\n` +
        `**West (${westMembers.length}):** ${westList}`;

      await interaction.editReply({ content: message });

    } catch (err) {
      console.error('❌ Error separating members:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};
