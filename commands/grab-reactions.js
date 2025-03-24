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
        .setName('grab-reactions')
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
            const isAllowedUser = allowedUserIds.includes(interaction.user.id);

            if (!hasRequiredRole && !isAllowedUser) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    ephemeral: true
                });
            }

            await interaction.deferReply(); // Acknowledge the interaction early

            const messageId = interaction.options.getString('messageid');
            let targetMessage = null;

            // Search for the target message
            for (const [, channel] of interaction.guild.channels.cache) {
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
                return interaction.editReply({
                    content: `❌ Message with ID ${messageId} not found.`,
                    ephemeral: true
                });
            }

            const uniqueUsers = new Set();
            for (const reaction of targetMessage.reactions.cache.values()) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsers.add(user.username);
                });
            }

            if (uniqueUsers.size === 0) {
                return interaction.editReply({
                    content: `⚠ No reactions found for message ID ${messageId}.`,
                    ephemeral: true
                });
            }

            const sortedUserList = Array.from(uniqueUsers)
                .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                .map(username => [username]);

            console.log("Sending payload to Apps Script:", { names: sortedUserList });

            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // Clear existing reactions list
            await sheets.spreadsheets.values.clear({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A:A`,
            });

            // Upload users to Google Sheets
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A1`,
                valueInputOption: "RAW",
                resource: { values: [["Reacted Users"], ...sortedUserList] }
            });

            // Trigger the Apps Script to generate teams
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbzrk2JjgWUKpyWtnPOZzRf2wkjsg7lJBZs2b_4zWJOPt6VLju0u4SxcOlvHfi083yHw/dev';
            await axios.post(triggerUrl, { names: sortedUserList });

            console.log("✅ Reaction user list updated and team generation triggered!");

            // Send an initial response while we wait for the team message
            await interaction.editReply({
                content: "✅ Teams are being generated... The message ID will be logged soon.",
                ephemeral: false
            });

            // Wait 5-10 seconds for the team message to be posted
            await new Promise(resolve => setTimeout(resolve, 5000));

            /** 
             * Start of section to comment out for testing
             * 
             * let botMessage = null;
             * let attempts = 3; // Try fetching the message up to 3 times
             *
             * for (let i = 0; i < attempts; i++) {
             *     const fetchedMessages = await interaction.channel.messages.fetch({ limit: 10 });
             *     botMessage = fetchedMessages.find(msg =>
             *         msg.author.id === interaction.client.user.id && msg.content.includes("Here are the teams")
             *     );
             *
             *     if (botMessage) break; // Exit loop if we find the message
             *     await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
             * }
             *
             * if (!botMessage) {
             *     console.warn("⚠ Could not find the team message after multiple attempts.");
             *     await interaction.followUp({
             *         content: "⚠ Team message not found! Please check manually.",
             *         ephemeral: true
             *     });
             *     return;
             * }
             *
             * const botMessageId = botMessage.id;
             * console.log(`✅ Found the team message! Message ID: ${botMessageId}`);
             *
             * // Store the message ID properly
             * await sheets.spreadsheets.values.update({
             *     spreadsheetId: config.SPREADSHEET_ID,
             *     range: `${config.SHEET_REACTIONS}!M1`,
             *     valueInputOption: "RAW",
             *     resource: { values: [[botMessageId]] }
             * });
             *
             * console.log("✅ Bot message ID stored in Google Sheets!");
             *
             * Ensure interaction isn't already acknowledged before replying again
             * if (!interaction.replied && !interaction.deferred) {
             *     await interaction.followUp({
             *         content: `✅ Team message posted! Message ID: **${botMessageId}**`,
             *         ephemeral: false
             *     });
             * }
             * 
             * End of section to comment out for testing
             */

        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);

            // Ensure we don't send duplicate replies
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({
                    content: "❌ Failed to upload reaction user list to Google Sheets.",
                    ephemeral: true
                });
            }
        }
    },
};
