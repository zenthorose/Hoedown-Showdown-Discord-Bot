const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials
const { checkPermissions } = require('../permissions'); // Import the permissions check function

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('teamset')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        // Check permissions using the function from permissions.js
        const hasPermission = await checkPermissions(interaction);

        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        const teamSet = interaction.options.getString('teamset');
        const removePlayer = interaction.options.getString('removeplayer');
        const addPlayer = interaction.options.getString('addplayer');

        console.log(`Received swap command: team=${teamSet}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

        // Initial response to avoid interaction timeout
        await interaction.reply({ content: `🔄 Processing swap...`, ephemeral: true });

        try {
            // Get the Google Apps Script URL from environment variables
            const triggerUrl = process.env.Google_Apps_Script_URL;

            // Make sure the environment variable is defined
            if (!triggerUrl) {
                await interaction.followUp({ content: '❌ Error: Google Apps Script URL is not defined.', ephemeral: true });
                return;
            }

            // Send the swap data to Google Apps Script
            await axios.post(triggerUrl, {
                command: "swap",
                teamSet: teamSet,
                removePlayer: removePlayer,
                addPlayer: addPlayer
            });

            console.log("Swap data sent to Google Apps Script.");

            // Fetch log channel and send update
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`);

            // Follow up with success response
            await interaction.followUp({ content: `✅ Swap completed successfully.`, ephemeral: true });

        } catch (error) {
            console.error("Error with Google Apps Script:", error);

            await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
        }
    }
};