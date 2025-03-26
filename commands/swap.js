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
        .setName('swap')  // Keeping the command name as 'swap'
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('teamset')  // Changed to lowercase
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')  // Changed to lowercase
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')  // Changed to lowercase
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const teamSet = interaction.options.getString('teamset');  // Changed to lowercase
        const removePlayer = interaction.options.getString('removeplayer');  // Changed to lowercase
        const addPlayer = interaction.options.getString('addplayer');  // Changed to lowercase

        console.log(`Received swap command: team=${teamSet}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

        // Send swap data to Google Sheets
        try {
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            const swapData = [
                [teamSet, removePlayer, addPlayer, new Date().toISOString()]
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
                teamSet: teamSet,
                removePlayer: removePlayer,
                addPlayer: addPlayer
            });

            console.log("Swap data sent to Google Sheets and Apps Script triggered.");

            // Log swap to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`);

        } catch (error) {
            console.error("Error with Google Sheets or Apps Script:", error);
            await interaction.reply({
                content: "❌ There was an error updating Google Sheets or triggering the Apps Script.",
                ephemeral: true
            });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Sheets or Apps Script: ${error.message}`);
        }

        // Respond with the updated swap information
        await interaction.reply({
            content: `✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`,
            ephemeral: true
        });
    }
};
