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

        // Trigger the Google Apps Script for further processing
        try {
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';
            await axios.post(triggerUrl, {
                command: "swap",
                teamSet: teamSet,
                removePlayer: removePlayer,
                addPlayer: addPlayer
            });

            console.log("Swap data sent to Google Apps Script.");

            // Log swap to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`);

        } catch (error) {
            console.error("Error with Google Apps Script:", error);
            await interaction.reply({
                content: "❌ There was an error triggering the Apps Script.",
                ephemeral: true
            });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
        }

        // Respond with the updated swap information
        await interaction.reply({
            content: `✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`,
            ephemeral: true
        });
    }
};
