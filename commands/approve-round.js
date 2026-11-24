const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { getBotSettings } = require('../database/botSettings');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const { approveLatestRound } = require('../utils/roundApproval');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-round')
    .setDescription('Approves the current pending round.'),

  async execute(interaction) {
    let botSettingsPromise;
    const loadBotSettings = () => {
      if (!botSettingsPromise) botSettingsPromise = getBotSettings();
      return botSettingsPromise;
    };

    async function logUsage(extra = '') {
      let channels = config;
      try {
        const settings = await loadBotSettings();
        channels = {
          ...config,
          ...settings.channels,
          roundChannels: { ...config.roundChannels, ...settings.channels.roundChannels },
          teamChannels: { ...config.teamChannels, ...settings.channels.teamChannels }
        };
      } catch (error) {
        console.error('Could not load bot channels for /approve-round logging:', error);
      }
      try {
        const logChannel = await interaction.client.channels.fetch(channels.LOG_CHANNEL_ID || config.LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `📝 **/approve-round** used by **${interaction.user.tag}** in **#${interaction.channel?.name || 'Unknown'}** ${extra}`
          );
        }
      } catch (error) {
        console.error('Failed to log /approve-round:', error);
      }
    }

    try {
      await logUsage();
      await interaction.deferReply({ ephemeral: true });

      if (!(await checkPermissions(interaction))) {
        return interaction.editReply('❌ You do not have permission to use this command!');
      }

      const botSettings = await loadBotSettings();
      const { collections, databases } = await connectHoedownInfo();
      const result = await approveLatestRound({
        teamCheckCollection: collections.teamCheck,
        roundsDatabase: databases.rounds,
        previousPairingsCollection: collections.previousPairings,
        botSettings,
        discordClient: interaction.client,
        guild: interaction.guild,
        actor: {
          discordId: interaction.user.id,
          username: interaction.user.username || interaction.user.tag,
          discordUsername: interaction.user.tag,
          avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 64 })
        }
      });

      if (!result.approved) {
        const message = `Approval is incomplete and can be retried. ${result.failures.join(' ')}`;
        await logUsage(`❌ Round #${result.round} approval incomplete: ${result.failures.join('; ')}`);
        return interaction.editReply(`❌ ${message}`);
      }

      const response = [
        `✅ Round #${result.round} approved successfully.`,
        result.warnings.length ? `⚠️ Completed with warnings: ${result.warnings.join(' ')}` : ''
      ].filter(Boolean).join('\n');
      await logUsage(`✅ Round #${result.round} approved.${result.warnings.length ? ` Warnings: ${result.warnings.join('; ')}` : ''}`);
      await interaction.editReply(response);
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          console.error('Failed to delete /approve-round response:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Unexpected error in /approve-round:', error);
      await logUsage(`❌ Approval failed: ${error.message}`);
      const message = `❌ Could not approve the current round: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply(message);
        } catch (notifyError) {
          console.error('Failed to notify /approve-round caller:', notifyError);
        }
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};
