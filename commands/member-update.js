const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
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
        .setName('member-update')
        .setDescription('Fetches a list of all server members and uploads them to Google Sheets.'),
    async execute(interaction) {
        // Defer the reply immediately (visible to the user only)
        await interaction.deferReply();

        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.editReply('❌ You do not have permission to use this command!');
        }

        try {
            await interaction.guild.members.fetch();

            const sortedMembers = interaction.guild.members.cache
                .map(member => [
                    member.nickname || member.user.username, // Nickname (or username if none)
                    member.user.username, // Actual Discord username
                    member.user.id // Discord ID
                ])
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

            // Authenticate with Google Sheets API
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // 🔴 Step 1: Clear columns A to C before updating
            await sheets.spreadsheets.values.clear({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_MEMBERS}!A:C`, // Clears columns A, B, and C
            });

            console.log("🧹 Cleared columns A to C before updating.");

            // 🟢 Step 2: Upload new member list
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_MEMBERS}!A1`,
                valueInputOption: "RAW",
                resource: { values: [["Nickname", "Username", "Discord ID"], ...sortedMembers] }
            });

            // ✅ Make success message visible to everyone
            await interaction.editReply("✅ Member list successfully uploaded to Google Sheets!");
        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.editReply("❌ Failed to upload member list to Google Sheets.");
        }
    },
};
