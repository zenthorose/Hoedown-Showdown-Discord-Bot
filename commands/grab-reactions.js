const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config.json'); // Import the config file

const credentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT
};

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
                fetchReply: true  // This ensures that we get the actual Message object
            });

            const messageId = interaction.options.getString('messageid');

            // Process the reaction retrieval and Google Sheets update in the background
            setTimeout(async () => {
                try {
                    let targetMessage = null;

                    // Search for the message in the guild channels
                    for (const [channelId, channel] of interaction.guild.channels.cache) {
                        if (channel.isTextBased()) {
                            try {
                                targetMessage = await channel.messages.fetch(messageId);
                                if (targetMessage) break;
                            } catch (err) {
                                continue;
                            }
                        }
                    }

                    if (!targetMessage) {
                        const logMessage = `❌ Message with ID ${messageId} not found.`;
                        await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage); // Send to log channel
                        if (replyMessage) await replyMessage.delete(); // Clean up the initial reply if task fails
                        return;
                    }

                    const reactions = targetMessage.reactions.cache;
                    if (reactions.size === 0) {
                        const logMessage = `⚠ No reactions found for message ID ${messageId}.`;
                        await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage); // Send to log channel
                        if (replyMessage) await replyMessage.delete(); // Clean up the initial reply if task fails
                        return;
                    }

                    const uniqueUsers = new Set();
                    for (const reaction of reactions.values()) {
                        const users = await reaction.users.fetch();
                        users.forEach(user => {
                            if (!user.bot) uniqueUsers.add(user.username);
                        });
                    }

                    const sortedUserList = Array.from(uniqueUsers)
                        .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                        .map(username => [username]);

                    const auth = new google.auth.GoogleAuth({
                        credentials,
                        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
                    });

                    const sheets = google.sheets({ version: "v4", auth });

                    // Clear existing data in the specified range (C column)
                    await sheets.spreadsheets.values.clear({
                        spreadsheetId: config.SPREADSHEET_ID,
                        range: `${config.SHEET_REACTIONS}!A:A`,
                    });

                    // Update the sheet with the new list of users
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: config.SPREADSHEET_ID,
                        range: `${config.SHEET_REACTIONS}!A1`,
                        valueInputOption: "RAW",
                        resource: { values: [["Reacted Users"], ...sortedUserList] }
                    });

                    // Trigger the Google Apps Script and send the list of users
                    const triggerUrl = 'https://script.google.com/macros/s/AKfycbwnJn72Yhf1JHFlf_1Nx947bdoSseOSX080yPOlU7k/dev';
                    await axios.post(triggerUrl);

                    const logMessage = "✅ Reaction user list updated and team generation triggered!";
                    await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage); // Send to log channel

                    // Send a normal message with the result to the command channel
                    await interaction.channel.send({ content: "✅ Reaction user list updated in Google Sheets and team generation triggered!" });

                    if (replyMessage) await replyMessage.delete(); // Clean up the initial reply

                } catch (error) {
                    const logMessage = `❌ Error updating Google Sheets: ${error.message}`;
                    await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(logMessage); // Send to log channel

                    // Send a failure message to the command channel
                    await interaction.channel.send({ content: "❌ Failed to upload reaction user list to Google Sheets." });

                    if (replyMessage) await replyMessage.delete(); // Clean up the initial reply
                }
            }, 1000); // Small delay to avoid blocking execution

        } catch (error) {
            console.error("❌ Error sending initial reply:", error);
            await interaction.channel.send({ content: "❌ Failed to send the initial reply." });
        }
    },
};
