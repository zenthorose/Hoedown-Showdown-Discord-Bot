const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains Google Sheets API credentials and Apps Script URL

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
        .setName('swap')
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('TeamSet')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('RemovePlayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('AddPlayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const TeamSet = interaction.options.getString('TeamSet');
        const RemovePlayer = interaction.options.getString('RemovePlayer');
        const AddPlayer = interaction.options.getString('AddPlayer');

        console.log(`Received swap command: TeamSet=${TeamSet}, RemovePlayer=${RemovePlayer}, AddPlayer=${AddPlayer}`);

        // Simulate a team data structure (you can replace this with an actual database or file if needed)
        const teams = {
            "teamA": ["Alice", "Bob", "Charlie"],
            "teamB": ["David", "Eve", "Frank"]
        };

        // Check if the team exists
        if (!teams[TeamSet]) {
            return interaction.reply({
                content: `❌ Team "${TeamSet}" not found.`,
                ephemeral: true
            });
        }

        // Check if the player to remove is in the team
        if (!teams[TeamSet].includes(RemovePlayer)) {
            return interaction.reply({
                content: `❌ Player "${RemovePlayer}" is not in team "${TeamSet}".`,
                ephemeral: true
            });
        }

        // Check if the player to add is already in the team
        if (teams[TeamSet].includes(AddPlayer)) {
            return interaction.reply({
                content: `❌ Player "${AddPlayer}" is already in team "${TeamSet}".`,
                ephemeral: true
            });
        }

        // Perform the swap
        const index = teams[TeamSet].indexOf(RemovePlayer);
        teams[TeamSet][index] = AddPlayer;

        // Send swap data to Google Sheets
        try {
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            const swapData = [
                [TeamSet, RemovePlayer, AddPlayer, new Date().toISOString()]
            ];

            // Append the swap information to the sheet
            await sheets.spreadsheets.values.append({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A:D`,
                valueInputOption: "RAW",
                resource: {
                    values: swapData
                }
            });

            // Trigger the Google Apps Script for further processing
            const triggerUrl = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
            await axios.post(triggerUrl, {
                TeamSet: TeamSet,
                RemovePlayer: RemovePlayer,
                AddPlayer: AddPlayer
            });

            console.log("Swap data sent to Google Sheets and Apps Script triggered.");

        } catch (error) {
            console.error("Error with Google Sheets or Apps Script:", error);
            await interaction.reply({
                content: "❌ There was an error updating Google Sheets or triggering the Apps Script.",
                ephemeral: true
            });
        }

        // Respond with the updated team
        await interaction.reply({
            content: `✅ Player "${RemovePlayer}" has been removed from team "${TeamSet}", and "${AddPlayer}" has been added.`,
            ephemeral: true
        });

        // Optionally, log or do something with the updated team data
        console.log(`Updated team "${TeamSet}": ${teams[TeamSet].join(', ')}`);
    }
};
