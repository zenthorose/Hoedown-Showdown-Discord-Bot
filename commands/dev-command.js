const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { removeOptInReactions } = require('../utils/optInReactions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only: remove a member’s reactions from all opt-in time slots.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The person to remove from all opt-in time slots')
        .setRequired(true)),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply('❌ This command must be run in a server.');
    }

    const target = interaction.options.getUser('player', true);

    try {
      await interaction.editReply(`🔎 Scanning opt-in time slots for ${target.tag}…`);
      const { removedCount, failedCount, slotCount } =
        await removeOptInReactions(interaction.client, guild, target);

      const status = failedCount === 0 ? '✅' : removedCount > 0 ? '⚠️' : '❌';
      const result = `${status} Removed ${removedCount} reaction(s) for ${target.tag} across ${slotCount} opt-in time-slot message(s).` +
        (failedCount > 0 ? `\n${failedCount} reaction(s) could not be checked or removed; see bot logs for details.` : '');
      await interaction.editReply(result);

    } catch (err) {
      console.error('❌ Error removing opt-in reactions:', err);
      await interaction.editReply(`❌ Failed to remove reactions: ${err.message}`);
    }
  },
};