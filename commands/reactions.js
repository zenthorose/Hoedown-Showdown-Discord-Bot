const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios'); // Import axios for HTTP requests
const { SPREADSHEET_ID, SHEET_REACTIONS } = require('../config.json'); // Load spreadsheet details

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
        .setName('reactions')
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply(); // ✅ Defer reply to prevent interaction timeout

        const messageId = interaction.options.getString('messageid');

        try {
            let targetMessage = null;

            // Search for the message in all accessible text channels
            for (const [channelId, channel] of interaction.guild.channels.cache) {
                if (channel.isTextBased()) {
                    try {
                        targetMessage = await channel.messages.fetch(messageId);
                        if (targetMessage) break; // Stop searching once found
                    } catch (err) {
                        continue; // Ignore errors and move to the next channel
                    }
                }
            }

            if (!targetMessage) {
                return await interaction.editReply({ content: `Message with ID ${messageId} not found.`, flags: 64 });
            }

            const reactions = targetMessage.reactions.cache;
            if (reactions.size === 0) {
                return await interaction.editReply({ content: `No reactions found for message ID ${messageId}.`, flags: 64 });
            }

            const uniqueUsers = new Set(); // To prevent duplicate usernames

            for (const reaction of reactions.values()) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsers.add(user.username);
                });
            }

            // Convert Set to sorted list
            const sortedUserList = Array.from(uniqueUsers).sort((a, b) =>
                a.localeCompare(b, 'en', { sensitivity: 'base' })
            ).map(username => [username]); // Format for Sheets (one name per row)

            // Authenticate with Google Sheets API
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // 🔴 Step 1: Clear column C before updating
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_REACTIONS}!C:C`, // Clears column C
            });

            console.log("🧹 Cleared column C before updating.");

            // 🟢 Step 2: Upload new reactions user list to Column C
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_REACTIONS}!A1`, // Start at A1
                valueInputOption: "RAW",
                resource: { values: [["Reacted Users"], ...sortedUserList] } // Header + Data
            });

            console.log("✅ Reaction user list successfully uploaded to Google Sheets!");

            // 🟣 Step 3: Trigger team generation (call the Google Apps Script Web App)
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbzA23TVLxEhPBVNiL6Fk7R7jjQ1fo5TKKcOX2jnn9AWqFDPxTUzRT_4AAiwV4JN-DJE/exec'; // Replace with your actual Google Apps Script Web App URL
            await axios.post(triggerUrl, {
                // Send any necessary parameters if needed, like:
                // sheetId: SPREADSHEET_ID
            });

            console.log("✅ Triggered team generation via Google Apps Script!");

            await interaction.editReply("✅ Reaction user list updated in Google Sheets and team generation triggered!");

        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.editReply("❌ Failed to upload reaction user list to Google Sheets.");
        }
    },
};
