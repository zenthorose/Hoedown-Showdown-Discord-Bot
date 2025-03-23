const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios'); // Import axios for HTTP requests
const { SPREADSHEET_ID, SHEET_REACTIONS, testGroup } = require('../config.json'); // Load spreadsheet details and test group

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
        .setName('testreactions')
        .setDescription('Uploads a test user list to Google Sheets.'),

    async execute(interaction) {
        try {
            // Use the testGroup list from config.json instead of fetching from Discord
            const sortedUserList = testGroup.sort((a, b) => 
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

            // 🟢 Step 2: Upload new test user list to Column C
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_REACTIONS}!A1`, // Start at A1
                valueInputOption: "RAW",
                resource: { values: [["Test Users"], ...sortedUserList] } // Header + Data
            });

            console.log("✅ Test user list successfully uploaded to Google Sheets!");

            // 🟣 Step 3: Trigger team generation (call the Google Apps Script Web App)
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbwnJn72Yhf1JHFlf_1Nx947bdoSseOSX080yPOlU7k/dev'; // Replace with your actual Google Apps Script Web App URL
            await axios.post(triggerUrl, {});

            console.log("✅ Triggered team generation via Google Apps Script!");
            await interaction.reply("✅ Test user list updated in Google Sheets and team generation triggered!");

        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.reply("❌ Failed to upload test user list to Google Sheets.");
        }
    },
};
