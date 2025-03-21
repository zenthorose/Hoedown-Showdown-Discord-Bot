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

        try {
            await interaction.guild.members.fetch();

            const sortedMembers = interaction.guild.members.cache
                .map(member => [member.user.username, member.user.id])
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

            // Authenticate with Google Sheets API
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            // 🔴 Step 1: Clear columns A & B before updating
            await sheets.spreadsheets.values.clear({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_MEMBERS}!A:B`, // Clears column A & B
            });

            console.log("🧹 Cleared columns A & B before updating.");

            // 🟢 Step 2: Upload new member list
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${config.SHEET_MEMBERS}!A1`, // Start at A1
                valueInputOption: "RAW",
                resource: { values: [["Full Discord List User Name", "Discord ID's"], ...sortedMembers] }
            });

            await interaction.reply("✅ Member list successfully uploaded to Google Sheets!");
        } catch (error) {
            console.error("❌ Error updating Google Sheets:", error);
            await interaction.reply("❌ Failed to upload member list to Google Sheets.");
        }
    },
};
