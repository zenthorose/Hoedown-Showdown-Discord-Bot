const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spreadsheet-test')
    .setDescription('Run repeated read-only checks of Google Sheets access.')
    .addIntegerOption(option =>
      option
        .setName('attempts')
        .setDescription('Number of checks to run (1–10; defaults to 10).')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (interaction.user.id !== config.devID) {
      return interaction.reply({
        content: '❌ You do not have permission to run this diagnostic.',
        flags: 64
      });
    }

    await interaction.deferReply({ flags: 64 });

    const triggerUrl = process.env.Google_Apps_Script_URL;
    if (!triggerUrl) {
      return interaction.editReply('❌ Google Apps Script URL is not defined.');
    }

    const attempts = interaction.options.getInteger('attempts') || 10;

    try {
      const response = await axios.post(
        triggerUrl,
        { command: 'spreadsheet-test', attempts },
        { timeout: 90000 }
      );
      const result = response.data;

      if (!result || !Array.isArray(result.results)) {
        throw new Error('Unexpected response; expected spreadsheet-test results.');
      }

      const details = result.results.map(attempt => {
        if (attempt.success) {
          return `#${attempt.attempt} PASS — ${attempt.elapsedMs} ms, rows: ${attempt.lastRow}`;
        }

        const error = String(attempt.error || 'Unknown spreadsheet error').replace(/\s+/g, ' ').slice(0, 100);
        return `#${attempt.attempt} FAIL — ${attempt.elapsedMs} ms: ${error}`;
      });

      const summary =
        `Spreadsheet access test (${result.version ? `GAS v${result.version}, ` : ''}` +
        `${result.successes}/${result.attempts} passed, ${result.elapsedMs} ms total):`;

      await interaction.editReply(`${summary}\n${details.join('\n')}`);
    } catch (error) {
      console.error('❌ /spreadsheet-test failed:', {
        message: error.message,
        code: error.code,
        status: error.response ? error.response.status : undefined
      });

      const message = error.message === 'Unexpected response; expected spreadsheet-test results.'
        ? 'The endpoint returned an unexpected response. Check the Apps Script deployment and URL.'
        : 'The spreadsheet test request failed. Check the bot and Apps Script execution logs.';
      await interaction.editReply(`❌ ${message}`);
    }
  }
};
