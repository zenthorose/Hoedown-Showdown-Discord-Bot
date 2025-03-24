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
            // Fetch allowed roles and user IDs
            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;

            // Check if user has required role or specific Discord ID
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
            const isAllowedUser = allowedUserIds.includes(interaction.user.id);

            if (!hasRequiredRole && !isAllowedUser) {
                return interaction.reply({ 
                    content: '❌ You do not have permission to use this command!', 
                    ephemeral: true 
                });
            }

            // Acknowledge the interaction immediately
            await interaction.deferReply({ ephemeral: true });

            const messageId = interaction.options.getString('messageid');
            let targetMessage = null;

            // Find the message in all text-based channels
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

            // Collect unique users who reacted (excluding bots)
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

            // Sort usernames and prepare them for Google Sheets
            const sortedUserList = Array.from(uniqueUsers)
                .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                .map(username => [username]);

            console.log("Sending payload to Apps Script:", { names: sortedUserList });

            // Authenticate with Google Sheets API
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // Clear existing data in the specified range (A column)
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

            // Trigger the Google Apps Script to generate teams
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbzrk2JjgWUKpyWtnPOZzRf2wkjsg7lJBZs2b_4zWJOPt6VLju0u4SxcOlvHfi083yHw/dev';
            await axios.post(triggerUrl, { names: sortedUserList });

            console.log("✅ Reaction user list updated and team generation triggered!");

            // Send a follow-up message containing the confirmation
            const botMessage = await interaction.followUp({ 
                content: "✅ Reaction user list updated in Google Sheets and team generation triggered!", 
                ephemeral: false 
            });

            // Get the message ID of the bot’s response
            const botMessageId = botMessage.id;

            console.log(`✅ Bot message ID: ${botMessageId}`);

            // Store the bot message ID in column M:M
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!M1`,
                valueInputOption: "RAW",
                resource: { values: [[botMessageId]] }
            });

            console.log("✅ Bot message ID stored in Google Sheets!");

        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.editReply({ 
                content: "❌ Failed to upload reaction user list to Google Sheets.", 
                ephemeral: true 
            });
        }
    },
};
