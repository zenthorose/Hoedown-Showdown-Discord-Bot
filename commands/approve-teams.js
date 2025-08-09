const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials
const { checkPermissions } = require('../permissions'); // Import the permissions check

module.exports = {
    data: new SlashCommandBuilder()
        .setName('approve-teams')
        .setDescription('Approves a team set for use.')
        .addIntegerOption(option =>
            option.setName('teamset')
                .setDescription('The team set number to approve')
                .setRequired(true)),

    async execute(interaction) {
        // Use the checkPermissions function to validate the user’s role or ID
        const permissionError = await checkPermissions(interaction);
        if (permissionError) {
            return interaction.reply({
                content: permissionError,
                ephemeral: true
            });
        }

        const teamSet = interaction.options.getInteger('teamset');

        console.log(`Received approve-teams command: teamSet=${teamSet}`);

        // Initial response to avoid interaction timeout
        await interaction.reply({ content: `🔄 Processing team approval...`, ephemeral: true });

        try {
            // Get the Google Apps Script URL from environment variables
            const { googleAppsScriptUrl } = require('./path/to/main.js'); // adjust path as needed
            const triggerUrl = googleAppsScriptUrl;


            // Make sure the environment variable is defined
            if (!triggerUrl) {
                await interaction.followUp({ content: '❌ Error: Google Apps Script URL is not defined.', ephemeral: true });
                return;
            }

            await axios.post(triggerUrl, {
                command: "approve-teams",  // Command name
                teamSet: teamSet           // Team set number
            });

            console.log("Approval request sent to Google Apps Script.");

            // Fetch log channel and send update
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Team set "${teamSet}" has been approved.`);

            // Follow up with success response
            await interaction.followUp({ content: `✅ Team set ${teamSet} approved successfully.`, ephemeral: true });

        } catch (error) {
            console.error("Error with Google Apps Script:", error);

            await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
        }
    }
};