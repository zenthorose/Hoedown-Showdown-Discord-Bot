const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config.json');

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
                    flags: 64
                });
            }

            await interaction.deferReply(); // Defer the reply immediately to prevent interaction timeout

            const messageId = interaction.options.getString('messageid');
            let targetMessage = null;

            // Search for the message in all text-based channels
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
                return interaction.editReply({ content: `❌ Message with ID ${messageId} not found.`, flags: 64 });
            }

            const reactions = targetMessage.reactions.cache;
            if (reactions.size === 0) {
                return interaction.editReply({ content: `⚠ No reactions found for message ID ${messageId}.`, flags: 64 });
            }

            // Fetch users who reacted
            const uniqueUsers = new Set();
            for (const reaction of reactions.values()) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsers.add(user.username);
                });
            }

            if (uniqueUsers.size === 0) {
                return interaction.editReply({ content: `⚠ No valid users found in reactions for message ID ${messageId}.`, flags: 64 });
            }

            const sortedUserList = Array.from(uniqueUsers)
                .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                .map(username => [username]);

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

            // Trigger Google Apps Script if URL is set in config
            if (config.GOOGLE_APPS_SCRIPT_URL) {
                await axios.post(config.GOOGLE_APPS_SCRIPT_URL, {});
                console.log("✅ Google Apps Script triggered successfully!");
            } else {
                console.warn("⚠ GOOGLE_APPS_SCRIPT_URL not set in config. Skipping trigger.");
            }

            // Final response
            await interaction.editReply({ content: "✅ Reaction user list updated in Google Sheets and team generation triggered!", flags: 64 });

        } catch (error) {
            console.error("❌ Error in grab-reactions command:", error);
            await interaction.editReply({ content: "❌ An error occurred while processing your request.", flags: 64 });
        }
    },
};
