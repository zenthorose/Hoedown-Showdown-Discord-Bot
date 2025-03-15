const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const fs = require('fs');
const credentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fixes key formatting
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT
};


const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE";

module.exports = {
    data: new SlashCommandBuilder()
        .setName('members')
        .setDescription('Fetches a list of all server members and uploads them to Google Sheets.'),
    async execute(interaction) {
        await interaction.guild.members.fetch(); // Ensures cache is populated

        const sortedMembers = interaction.guild.members.cache
            .map(member => [member.user.username, member.user.id]) // Format for Sheets
            .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

        // Authenticate with Google Sheets API
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });

        const sheets = google.sheets({ version: "v4", auth });

        try {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: "A1", // Start at the first cell
                valueInputOption: "RAW",
                resource: { values: [["Username", "User ID"], ...sortedMembers] } // Header + data
            });

            await interaction.reply("✅ Member list successfully uploaded to Google Sheets!");
        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.reply("❌ Failed to upload member list to Google Sheets.");
        }
    },
};
