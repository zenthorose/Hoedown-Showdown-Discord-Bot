const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('region-check')
        .setDescription('Checks your region setting'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const channelId = interaction.channel.id; // Capture the channel ID

        // Reply instantly to acknowledge the command
        await interaction.reply({ content: 'The result will be back in a moment.', ephemeral: true });

        // Google Apps Script URL
        const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';

        try {
            // Send the region check request to Google Apps Script
            await axios.post(triggerUrl, {
                command: 'region-check',
                userId: userId,
                channelId: channelId // Send the channel ID
            });
        } catch (error) {
            console.error('Error sending request:', error);
            // Optionally, handle errors from the Google Apps Script request
        }
    }
};
