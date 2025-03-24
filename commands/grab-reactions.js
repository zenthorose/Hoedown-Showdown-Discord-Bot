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
        .setName('grab-reactions')  // Command name
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Fetch the allowed roles and user IDs from the config file
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        // Check if the user has the required role or the specific Discord ID
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        
        // Check if the user's Discord ID is in the allowed list
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

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

                // Log the payload to verify the data before sending
                console.log("Sending payload to Apps Script:", { names: sortedUserList });

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

                // Trigger the Google Apps Script (you can replace this URL with your own if needed)
                const triggerUrl = 'https://script.google.com/macros/s/AKfycbzrk2JjgWUKpyWtnPOZzRf2wkjsg7lJBZs2b_4zWJOPt6VLju0u4SxcOlvHfi083yHw/dev';
                await axios.post(triggerUrl, { names: sortedUserList });  // Send the payload with 'names'

                console.log("✅ Reaction user list updated and team generation triggered!");

                // Now send the teams message
                const teamsMessage = await interaction.channel.send("Here are the teams: ..."); // Replace with your actual teams message
                const teamsMessageId = teamsMessage.id; // Get the message ID of the teams message

                // Save the teams message ID to the Google Sheet (Column M)
                await sheets.spreadsheets.values.append({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `${config.SHEET_REACTIONS}!M:M`, // Column M in the MessageIDs sheet
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[teamsMessageId]], // Save the teams message ID
                    },
                });
                console.log("✅ Teams message ID saved to Google Sheets!");

                // Final response once everything is complete
                await interaction.editReply({ content: "✅ Reaction user list updated in Google Sheets, team generation triggered, and teams message ID saved!", flags: 64 });

            } catch (error) {
                console.error("❌ Error updating Google Sheets:", error);
                await interaction.editReply({ content: "❌ Failed to upload reaction user list to Google Sheets.", flags: 64 });
            }
        }, 1000); // Small delay to avoid blocking execution
    },
};
