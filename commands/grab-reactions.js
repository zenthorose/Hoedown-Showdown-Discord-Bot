const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab-reactions')  // Command name
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Fetch the allowed roles and user IDs from the config file
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        // Check if the user has the required role or the specific Discord ID
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        
        // Check if the user's Discord ID is in the allowed list
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        // Send an initial message acknowledging the command
        let replyMessage;
        try {
            replyMessage = await interaction.reply({
                content: 'Grabbing reactions... Please wait.',
                fetchReply: true
            });

            const messageId = interaction.options.getString('messageid');
            
            // Trigger the Google Apps Script to process the reactions
            setTimeout(async () => {
                try {
                    // Get the Google Apps Script URL from environment variables
                    const triggerUrl = process.env.Google_Apps_Script_URL;
                    
                    if (!triggerUrl) {
                        await interaction.channel.send({ content: 'Error: Google Apps Script URL is not defined.' });
                        return;
                    }

                    // Send the message ID to the Google Apps Script for processing
                    await axios.post(triggerUrl, {
                        command: 'grab-reactions',
                        messageId: messageId  // Sending the message ID to the script
                    });

                    const logMessage = "✅ Reaction user list update triggered!";
                    await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage);

                    await interaction.channel.send({ content: "✅ Reaction user list update triggered in Google Sheets!" });

                    if (replyMessage) await replyMessage.delete();  // Clean up the initial reply

                } catch (error) {
                    const logMessage = `❌ Error sending to Google Apps Script: ${error.message}`;
                    await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage);

                    await interaction.channel.send({ content: "❌ Failed to trigger Google Apps Script." });

                    if (replyMessage) await replyMessage.delete();
                }
            }, 1000); // Small delay to avoid blocking execution

        } catch (error) {
            console.error("❌ Error sending initial reply:", error);
            await interaction.channel.send({ content: "❌ Failed to send the initial reply." });
        }
    },
};
