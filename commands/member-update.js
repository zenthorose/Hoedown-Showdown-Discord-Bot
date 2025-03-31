const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');  // Import the config file
const { checkPermissions } = require('../permissions');  // Import checkPermissions

module.exports = {
    data: new SlashCommandBuilder()
        .setName('member-update')
        .setDescription('Fetches a list of all server members and uploads them to Google Sheets.'),

    async execute(interaction) {
        // Check if the user has the required permissions (role or user ID)
        const hasPermission = await checkPermissions(interaction);

        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        // Defer the reply immediately (visible to the user only)
        await interaction.deferReply();

        try {
            // Fetch all members of the guild
            await interaction.guild.members.fetch();

            const sortedMembers = interaction.guild.members.cache
                .map(member => [
                    member.nickname || member.user.username, // Nickname (or username if none)
                    member.user.username, // Actual Discord username
                    member.user.id // Discord ID
                ])
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

            // Prepare data to be sent to the Google Apps Script
            const memberData = [["Nickname", "Username", "Discord ID"], ...sortedMembers];

            // Send the data to the Google Apps Script URL
            const triggerUrl = process.env.Google_Apps_Script_URL;

            if (!triggerUrl) {
                return interaction.editReply('❌ Google Apps Script URL is not defined.');
            }

            // Send data to Google Apps Script via POST request
            await axios.post(triggerUrl, {
                command: "member-update",  // Command name
                memberData: memberData     // Member data array
            });

            // ✅ Make success message visible to everyone
            await interaction.editReply("✅ Member list successfully sent to Google Apps Script for updating!");

        } catch (error) {
            console.error("❌ Error with member-update:", error);
            await interaction.editReply("❌ Failed to send member list to Google Apps Script.");
        }
    },
};
