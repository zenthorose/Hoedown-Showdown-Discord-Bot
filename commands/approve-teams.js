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
        try {
            // Check permissions
            const hasPermission = await checkPermissions(interaction);
            if (!hasPermission) {
                return await interaction.reply({
                    content: '🚫 You do not have permission to use this command.',
                    ephemeral: true
                });
            }

            const teamSet = interaction.options.getInteger('teamset');

            // Defer the reply to give yourself more time
            await interaction.deferReply({ ephemeral: true });

            // Get Google Apps Script URL from env vars
            const triggerUrl = process.env.Google_Apps_Script_URL;
            if (!triggerUrl) {
                return await interaction.editReply('❌ Error: Google Apps Script URL is not defined.');
            }

            // Post to Google Apps Script
            await axios.post(triggerUrl, {
                command: "approve-teams",
                teamSet: teamSet
            });

            console.log("Approval request sent to Google Apps Script.");

            // Send log message to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Team set "${teamSet}" has been approved.`);

            // Edit deferred reply with success message
            await interaction.editReply(`✅ Team set ${teamSet} approved successfully.`);

        } catch (error) {
            console.error("Error with Google Apps Script or command execution:", error);

            // Reply or edit reply with error message depending on interaction state
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('❌ There was an error triggering the Apps Script.');
            } else {
                await interaction.reply({ content: '❌ There was an error triggering the Apps Script.', ephemeral: true });
            }

            // Log error to Discord channel
            try {
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
            } catch (logError) {
                console.error('Failed to send error message to log channel:', logError);
            }
        }
    }
};
