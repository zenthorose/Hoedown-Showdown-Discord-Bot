const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

const EVENT_TIME = Date.parse('2026-11-14T08:00:00-05:00');
const ALLOWED_USER_ID = '899399309768925206';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('countdown')
    .setDescription('Shows the time remaining until November 14 at 8:00 AM EST.'),

  async execute(interaction) {
    const hasPermission = interaction.user.id === ALLOWED_USER_ID ||
      await checkPermissions(interaction);

    if (!hasPermission) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command!',
        flags: 64
      });
    }

    const remainingMilliseconds = Math.max(0, EVENT_TIME - Date.now());
    const remainingSeconds = Math.floor(remainingMilliseconds / 1000);
    const days = Math.floor(remainingSeconds / 86400);
    const hours = Math.floor((remainingSeconds % 86400) / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    await interaction.reply(
      `⏳ **Countdown to November 14 at 8:00 AM EST**\n` +
      `**${days}** Days, **${hours}** Hours, **${minutes}** Minutes, **${seconds}** Seconds`
    );
  }
};
