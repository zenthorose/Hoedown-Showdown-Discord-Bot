const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials

module.exports = {
    data: new SlashCommandBuilder()
        .setName('approve-teams')
        .setDescription('Approves a team set for use.')
        .addIntegerOption(option =>
            option.setName('teamset')
                .setDescription('The team set number to approve')
                .setRequired(true)),

    async execute(interaction) {
        // Ensure the command is run in a server (not DM)
        if (!interaction.guild) {
            return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member) {
            return interaction.reply({ content: "❌ Unable to retrieve member data.", ephemeral: true });
        }

        // Fetch the allowed roles and user IDs from the config file
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));

        // Check if the user is in the allowed user list
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        const teamSet = interaction.options.getInteger('teamset');

        console.log(`Received approve-teams command: teamSet=${teamSet}`);

        // Initial response to avoid interaction timeout
        await interaction.reply({ content: `🔄 Processing team approval...`, ephemeral: true });

        try {
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';
            await axios.post(triggerUrl, {
                command: "approve-teams",  // Command name
                teamSet: teamSet           // Team set number
            });

            console.log("Approval request sent to Google Apps Script.");

            // Fetch log channel and send update
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Team set "${teamSet}" has been approved.`);

            // Follow up with success response
            await interaction.followUp({ content: `✅ Team set ${teamSet} approved successfully.`, ephemeral: true });

        } catch (error) {
            console.error("Error with Google Apps Script:", error);

            await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
        }
    }
};
