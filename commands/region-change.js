const { SlashCommandBuilder } = require('@discordjs/builders');
const { CommandInteraction } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('region-change')
        .setDescription('Change your region selection')
        .addStringOption(option => 
            option.setName('region')
                .setDescription('Choose a region: east, west, or both')
                .setRequired(true)
                .addChoices(
                    { name: 'East', value: 'east' },
                    { name: 'West', value: 'west' },
                    { name: 'Both', value: 'both' }
                )),
    
    async execute(interaction) {
        const selectedRegion = interaction.options.getString('region');
        const userId = interaction.user.id;

        // Google Apps Script URL
        const triggerUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec';

        try {
            // Send the region change request to Google Apps Script
            await axios.post(triggerUrl, {
                command: 'region-change',
                userId: userId,
                region: selectedRegion
            });

            await interaction.reply({ content: `Your region has been updated to **${selectedRegion}**.`, ephemeral: true });
        } catch (error) {
            console.error('Error sending request:', error);
            await interaction.reply({ content: 'There was an error updating your region. Please try again later.', ephemeral: true });
        }
    }
};
