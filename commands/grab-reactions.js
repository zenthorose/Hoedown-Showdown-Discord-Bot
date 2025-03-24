const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config.json');

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
            await interaction.deferReply({ ephemeral: true });
            
            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!member.roles.cache.some(role => allowedRoles.includes(role.name)) && 
                !allowedUserIds.includes(interaction.user.id)) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
            }

            const messageId = interaction.options.getString('messageid');
            const optInChannelId = config.OptInChannelID;
            const targetChannel = await interaction.guild.channels.fetch(optInChannelId);

            if (!targetChannel || !targetChannel.isTextBased()) {
                return interaction.followUp({ content: "⚠ Target channel is not a valid text channel.", ephemeral: true });
            }

            const targetMessage = await targetChannel.messages.fetch(messageId);
            if (!targetMessage) {
                return interaction.editReply({ content: `❌ Message with ID ${messageId} not found.`, ephemeral: true });
            }

            const uniqueUsers = new Set();
            for (const reaction of targetMessage.reactions.cache.values()) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsers.add(user.username);
                });
            }

            if (uniqueUsers.size === 0) {
                return interaction.editReply({ content: `⚠ No reactions found for message ID ${messageId}.`, ephemeral: true });
            }

            const sortedUserList = Array.from(uniqueUsers).sort().map(username => [username]);
            const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
            const sheets = google.sheets({ version: "v4", auth });

            await sheets.spreadsheets.values.clear({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A:A`,
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_REACTIONS}!A1`,
                valueInputOption: "RAW",
                resource: { values: [["Reacted Users"], ...sortedUserList] }
            });

            await axios.post(config.APPS_SCRIPT_URL, { names: sortedUserList });
            
            await interaction.followUp({ content: "✅ Teams are being generated...", ephemeral: false });

            await new Promise(resolve => setTimeout(resolve, 5000));

            const teamChannel = await interaction.guild.channels.fetch(config.TeamChannelPostingID);
            const fetchedMessages = await teamChannel.messages.fetch({ limit: 10 });

            const botMessage = fetchedMessages.find(msg =>
                msg.author.id === interaction.client.user.id && msg.content.includes("Here are the teams")
            );

            if (botMessage) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `${config.SHEET_REACTIONS}!M1`,
                    valueInputOption: "RAW",
                    resource: { values: [[botMessage.id]] }
                });
                await interaction.followUp({ content: `✅ Team message posted! Message ID: **${botMessage.id}**`, ephemeral: false });
            } else {
                await interaction.followUp({ content: "⚠ Team message not found! Please check manually.", ephemeral: true });
            }
        } catch (error) {
            console.error("❌ Error during execution:", error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.editReply({ content: "❌ Failed to execute the command.", ephemeral: true });
            }
        }
    },
};
