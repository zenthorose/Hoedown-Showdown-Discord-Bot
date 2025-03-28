const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('region-change')
        .setDescription('Change your region selection')
        .addStringOption(option =>
            option.setName('region')
                .setDescription('Choose a region: East, West, or Both')
                .setRequired(true)
                .addChoices(
                    { name: 'East', value: 'East' },
                    { name: 'West', value: 'West' },
                    { name: 'Both', value: 'Both' }
                )),

    async execute(interaction) {
        // Get the region and convert it to the proper capitalized format
        let selectedRegion = interaction.options.getString('region');
        
        // Capitalize the first letter and make the rest lowercase
        selectedRegion = selectedRegion.charAt(0).toUpperCase() + selectedRegion.slice(1).toLowerCase();
        
        const userId = interaction.user.id;
        const channelId = interaction.channel.id;

        // Validate the region (case insensitive)
        if (!['East', 'West', 'Both'].includes(selectedRegion)) {
            return await interaction.reply({ content: 'Invalid region selected. Please choose from "East", "West", or "Both".', ephemeral: true });
        }

        // Reply instantly to acknowledge the request
        await interaction.reply({ content: 'Your region is being updated and confirmation will be sent momentarily.', ephemeral: true });

        // Google Apps Script URL
        const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';

        try {
            // Send the region change request to Google Apps Script
            await axios.post(triggerUrl, {
                command: 'region-change',
                userId: userId,
                region: selectedRegion, // Send the capitalized region
                channelId: channelId
            });
        } catch (error) {
            console.error('Error sending request:', error);
            await interaction.editReply({ content: 'There was an error updating your region. Please try again later.' });
        }
    }
};
