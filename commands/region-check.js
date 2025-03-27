const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('region-check')
        .setDescription('Checks your region setting'),
    
    async execute(interaction) {
        const userId = interaction.user.id;

        // Trigger the Google Apps Script
        const triggerUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
        await axios.post(triggerUrl, {
            command: 'region-check',
            userId: userId
        });

        await interaction.reply({ content: 'The result will be back in a moment.', ephemeral: true });
    }
};
