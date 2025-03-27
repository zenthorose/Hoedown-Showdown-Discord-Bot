const { SlashCommandBuilder } = require('@discordjs/builders');
const { CommandInteraction } = require('discord.js');
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
        let selectedRegion = interaction.options.getString('region').toLowerCase();  // Ensure region is case-insensitive
        const userId = interaction.user.id;
        const channelId = interaction.channel.id;

        // Validate the region
        if (!['east', 'west', 'both'].includes(selectedRegion)) {
            return await interaction.reply({ content: 'Invalid region selected. Please choose from "East", "West", or "Both".', ephemeral: true });
        }

        // Google Apps Script URL
        const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';

        try {
            // Acknowledge the interaction to prevent timeout
            await interaction.deferReply({ ephemeral: true });

            // Send the region change request to Google Apps Script
            await axios.post(triggerUrl, {
                command: 'region-change',
                userId: userId,
                region: selectedRegion,
                channelId: channelId
            });

        } catch (error) {
            console.error('Error sending request:', error);
            await interaction.editReply({ content: 'There was an error updating your region. Please try again later.' });
        }
    }
};
