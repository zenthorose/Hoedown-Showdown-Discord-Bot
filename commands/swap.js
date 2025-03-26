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
            option.setName('team')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const teamName = interaction.options.getString('team');
        const removePlayer = interaction.options.getString('removeplayer');
        const addPlayer = interaction.options.getString('addplayer');

        console.log(`Received swap command: team=${teamName}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

        // Simulate a team data structure (you can replace this with an actual database or file if needed)
        const teams = {
            "teamA": ["Alice", "Bob", "Charlie"],
            "teamB": ["David", "Eve", "Frank"]
        };

        // Check if the team exists
        if (!teams[teamName]) {
            return interaction.reply({
                content: `❌ Team "${teamName}" not found.`,
                ephemeral: true
            });
        }

        // Check if the player to remove is in the team
        if (!teams[teamName].includes(removePlayer)) {
            return interaction.reply({
                content: `❌ Player "${removePlayer}" is not in team "${teamName}".`,
                ephemeral: true
            });
        }

        // Check if the player to add is already in the team
        if (teams[teamName].includes(addPlayer)) {
            return interaction.reply({
                content: `❌ Player "${addPlayer}" is already in team "${teamName}".`,
                ephemeral: true
            });
        }

        // Perform the swap
        const index = teams[teamName].indexOf(removePlayer);
        teams[teamName][index] = addPlayer;

        // Send swap data to Google Sheets
        try {
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            const swapData = [
                [teamName, removePlayer, addPlayer, new Date().toISOString()]
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
                command: 'swap',  // This indicates that it's a swap action
                teamName: teamName,
                removePlayer: removePlayer,
                addPlayer: addPlayer
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
            content: `✅ Player "${removePlayer}" has been removed from team "${teamName}", and "${addPlayer}" has been added.`,
            ephemeral: true
        });

        // Optionally, log or do something with the updated team data
        console.log(`Updated team "${teamName}": ${teams[teamName].join(', ')}`);
    }
};
