const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { removeOptInReactions } = require('../utils/optInReactions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unoptin')
    .setDescription('Remove a player from all opt-in time slots.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The person to remove from all opt-in time slots')
        .setRequired(true)),

  async execute(interaction) {
    async function logUsage(extra = '') {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `📝 **/unoptin** used by **${interaction.user.tag}** to remove **${interaction.options.getUser('player').tag}** ${extra}`
          );
        }
      } catch (error) {
        console.error('❌ Failed to log /unoptin usage:', error);
      }
    }

    try {
      await interaction.deferReply({ flags: 64 });
    } catch (error) {
      console.warn('⚠️ Defer failed, continuing without defer:', error?.message || error);
    }

    if (!interaction.guild) {
      return interaction.editReply('❌ This command must be run in a server.');
    }

    const allowedRoles = Array.isArray(config.allowedRoles) ? config.allowedRoles : [];
    const allowedUserIds = Array.isArray(config.allowedUserIds) ? config.allowedUserIds : [];

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));
      const isAllowedUser = allowedUserIds.includes(interaction.user.id);
      if (!hasRequiredRole && !isAllowedUser) {
        await logUsage('(denied: missing staff role)');
        return interaction.editReply('❌ You do not have permission to use this command.');
      }
    } catch (error) {
      console.error('❌ Failed to verify /unoptin staff permissions:', error);
      await logUsage('(denied: staff permission check failed)');
      return interaction.editReply('❌ Could not verify your staff permissions.');
    }

    const target = interaction.options.getUser('player', true);

    try {
      await interaction.editReply(`🔎 Scanning opt-in time slots for ${target.tag}…`);
      const { removedCount, failedCount, slotCount } =
        await removeOptInReactions(interaction.client, interaction.guild, target);

      const status = failedCount === 0 ? '✅' : removedCount > 0 ? '⚠️' : '❌';
      const result = `${status} Removed ${removedCount} reaction(s) for ${target.tag} across ${slotCount} opt-in time-slot message(s).` +
        (failedCount > 0 ? `\n${failedCount} reaction(s) could not be checked or removed; see bot logs for details.` : '');
      await interaction.editReply(result);
      await logUsage(`(${removedCount} reaction(s) removed)`);
    } catch (error) {
      console.error('❌ Error executing /unoptin:', error);
      await interaction.editReply(`❌ Failed to remove reactions: ${error.message}`);
      await logUsage(`(error: ${error.message})`);
    }
  },
};
