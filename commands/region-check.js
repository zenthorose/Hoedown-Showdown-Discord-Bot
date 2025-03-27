const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('region-check')
        .setDescription('Checks your region setting'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const channelId = interaction.channel.id; // Capture the channel ID

        // Google Apps Script URL
        const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';

        try {
            // Acknowledge the interaction to prevent timeout
            await interaction.deferReply({ ephemeral: true });

            // Send the region check request to Google Apps Script
            await axios.post(triggerUrl, {
                command: 'region-check',
                userId: userId,
                channelId: channelId // Send the channel ID
            });

            // Edit the initial response once the request is completed
            await interaction.editReply({ content: 'The result will be back in a moment.' });
        } catch (error) {
            console.error('Error sending request:', error);
            await interaction.editReply({ content: 'There was an error checking your region. Please try again later.' });
        }
    }
};
