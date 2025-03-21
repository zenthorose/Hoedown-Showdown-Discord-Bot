const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios');
const { SPREADSHEET_ID, SHEET_REACTIONS } = require('../config.json');

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
        .setName('grabreactions')  // Changed the command name here
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Acknowledge the interaction with deferReply if the process will take a while
        await interaction.deferReply();

        const messageId = interaction.options.getString('messageid');

        // Process the reaction retrieval and Google Sheets update in the background
        setTimeout(async () => {
            try {
                let targetMessage = null;

                for (const [channelId, channel] of interaction.guild.channels.cache) {
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

                const uniqueUsers = new Set();
                for (const reaction of reactions.values()) {
                    const users = await reaction.users.fetch();
                    users.forEach(user => {
                        if (!user.bot) uniqueUsers.add(user.username);
                    });
                }

                const sortedUserList = Array.from(uniqueUsers)
                    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                    .map(username => [username]);

                const auth = new google.auth.GoogleAuth({
                    credentials,
                    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
                });

                const sheets = google.sheets({ version: "v4", auth });

                // Clear existing data in the specified range (C column)
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_REACTIONS}!A:A`,
                });

                // Update the sheet with the new list of users
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_REACTIONS}!A1`,
                    valueInputOption: "RAW",
                    resource: { values: [["Reacted Users"], ...sortedUserList] }
                });

                // Trigger the Google Apps Script (you can replace this URL with your own if needed)
                const triggerUrl = 'https://script.google.com/macros/s/AKfycbzA23TVLxEhPBVNiL6Fk7R7jjQ1fo5TKKcOX2jnn9AWqFDPxTUzRT_4AAiwV4JN-DJE/dev';
                await axios.post(triggerUrl, {});

                console.log("✅ Reaction user list updated and team generation triggered!");

                // Final response once everything is complete
                await interaction.editReply({ content: "✅ Reaction user list updated in Google Sheets and team generation triggered!", flags: 64 });

            } catch (error) {
                console.error("❌ Error updating Google Sheets:", error);
                await interaction.editReply({ content: "❌ Failed to upload reaction user list to Google Sheets.", flags: 64 });
            }
        }, 1000); // Small delay to avoid blocking execution
    },
};
