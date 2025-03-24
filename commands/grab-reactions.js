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
        .setName('grab-reactions')
        .setDescription('Fetches reactions from a specific message and uploads users to Google Sheets.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            console.log("Start executing the command.");

            // Defer early to acknowledge the interaction
            await interaction.deferReply({ ephemeral: true });
            console.log("Interaction deferred.");

            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;
            const member = await interaction.guild.members.fetch(interaction.user.id);
            console.log(`Fetched member: ${interaction.user.id}`);

            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
            const isAllowedUser = allowedUserIds.includes(interaction.user.id);

            console.log(`Checking permissions: hasRequiredRole=${hasRequiredRole}, isAllowedUser=${isAllowedUser}`);

            if (!hasRequiredRole && !isAllowedUser) {
                console.log("User does not have permission to use this command.");
                return interaction.editReply({
                    content: '❌ You do not have permission to use this command!',
                    ephemeral: true
                });
            }

            const messageId = interaction.options.getString('messageid');
            console.log(`Received message ID: ${messageId}`);
            let targetMessage = null;

            // Search for the target message
            console.log("Searching for the target message in all channels.");
            for (const [, channel] of interaction.guild.channels.cache) {
                if (channel.isTextBased()) {
                    try {
                        console.log(`Attempting to fetch message from channel: ${channel.id}`);
                        targetMessage = await channel.messages.fetch(messageId);
                        if (targetMessage) break;
                    } catch (err) {
                        console.error(`Error fetching message from channel ${channel.id}:`, err);
                        continue;
                    }
                }
            }

            if (!targetMessage) {
                console.log(`Message with ID ${messageId} not found.`);
                return interaction.editReply({
                    content: `❌ Message with ID ${messageId} not found.`,
                    ephemeral: true
                });
            }

            const uniqueUsers = new Set();
            for (const reaction of targetMessage.reactions.cache.values()) {
                console.log(`Fetching users for reaction: ${reaction.emoji.name}`);
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsers.add(user.username);
                });
            }

            console.log(`Found ${uniqueUsers.size} unique users who reacted.`);
            if (uniqueUsers.size === 0) {
                return interaction.editReply({
                    content: `⚠ No reactions found for message ID ${messageId}.`,
                    ephemeral: true
                });
            }

            const sortedUserList = Array.from(uniqueUsers)
                .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                .map(username => [username]);

            console.log("Sending payload to Apps Script:", { names: sortedUserList });

            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // Clear existing reactions list
            console.log("Clearing existing reactions list in Google Sheets.");
            await sheets.spreadsheets.values.clear({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A:A`,
            });

            // Upload users to Google Sheets
            console.log("Uploading users to Google Sheets.");
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A1`,
                valueInputOption: "RAW",
                resource: { values: [["Reacted Users"], ...sortedUserList] }
            });

            // Trigger the Apps Script to generate teams
            console.log("Triggering Apps Script for team generation.");
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbzrk2JjgWUKpyWtnPOZzRf2wkjsg7lJBZs2b_4zWJOPt6VLju0u4SxcOlvHfi083yHw/dev';
            await axios.post(triggerUrl, { names: sortedUserList });

            console.log("✅ Reaction user list updated and team generation triggered!");

            // Send an initial response while we wait for the team message
            await interaction.editReply({
                content: "✅ Teams are being generated... The message ID will be logged soon.",
                ephemeral: false
            });

            // Wait 5-10 seconds for the team message to be posted
            console.log("Waiting 5 seconds before fetching the team message.");
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Get the target channel ID from the config
            const targetChannelId = config.TeamChannelPostingID;
            console.log(`Target channel ID: ${targetChannelId}`);

            // Fetch the target channel using the ID
            const targetChannel = await interaction.guild.channels.fetch(targetChannelId);
            console.log(`Fetched target channel: ${targetChannel ? targetChannel.id : 'Not Found'}`);

            if (!targetChannel || !targetChannel.isText()) {
                console.log("Invalid target channel. Not a text channel.");
                return interaction.followUp({
                    content: "⚠ Target channel is not a valid text channel.",
                    ephemeral: true
                });
            }

            // Fetch the last 10 messages from the specified channel
            console.log("Fetching last 10 messages from the target channel.");
            const fetchedMessages = await targetChannel.messages.fetch({ limit: 10 });

            let botMessage = fetchedMessages.find(msg =>
                msg.author.id === interaction.client.user.id && msg.content.includes("Here are the teams")
            );

            if (botMessage) {
                // Handle the message found
                const botMessageId = botMessage.id;
                console.log(`✅ Found the team message! Message ID: ${botMessageId}`);

                // Store the message ID properly
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `${config.SHEET_REACTIONS}!M1`,
                    valueInputOption: "RAW",
                    resource: { values: [[botMessageId]] }
                });

                console.log("✅ Bot message ID stored in Google Sheets!");

                // Ensure interaction isn't already acknowledged before replying again
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.followUp({
                        content: `✅ Team message posted! Message ID: **${botMessageId}**`,
                        ephemeral: false
                    });
                }
            } else {
                console.warn("⚠ Could not find the team message.");
                await interaction.followUp({
                    content: "⚠ Team message not found! Please check manually.",
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error("❌ Error during execution:", error);

            // Ensure we don't send duplicate replies
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({
                    content: "❌ Failed to execute the command.",
                    ephemeral: true
                });
            }
        }
    },
};
