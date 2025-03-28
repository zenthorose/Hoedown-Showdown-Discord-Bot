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

        // Get the Google Apps Script URL from environment variables
        const triggerUrl = process.env.Google_Apps_Script_URL;

        // Make sure the environment variable is defined
        if (!triggerUrl) {
            return await interaction.editReply({ content: 'Error: Google Apps Script URL is not defined.' });
        }

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
