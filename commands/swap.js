const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('teamset')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        // Fetch the allowed roles and user IDs from the config file
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        // Check if the command is run inside a guild
        if (!interaction.guild) {
            return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
        }

        try {
            // Fetch the member data
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

            const teamSet = interaction.options.getString('teamset');
            const removePlayer = interaction.options.getString('removeplayer');
            const addPlayer = interaction.options.getString('addplayer');

            console.log(`Received swap command: team=${teamSet}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

            // Initial response to avoid interaction timeout
            await interaction.reply({ content: `🔄 Processing swap...`, ephemeral: true });

            try {
                // Get the Google Apps Script URL from environment variables
                const triggerUrl = process.env.Google_Apps_Script_URL;

                // Make sure the environment variable is defined
                if (!triggerUrl) {
                    await interaction.followUp({ content: '❌ Error: Google Apps Script URL is not defined.', ephemeral: true });
                    return;
                }

                await axios.post(triggerUrl, {
                    command: "swap",
                    teamSet: teamSet,
                    removePlayer: removePlayer,
                    addPlayer: addPlayer
                });

                console.log("Swap data sent to Google Apps Script.");

                // Fetch log channel and send update
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`);

                // Follow up with success response
                await interaction.followUp({ content: `✅ Swap completed successfully.`, ephemeral: true });

            } catch (error) {
                console.error("Error with Google Apps Script:", error);

                await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

                // Log error to Discord channel
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
            }

        } catch (error) {
            console.error("❌ Error checking permissions:", error);
            return interaction.reply({ content: "❌ Error checking permissions.", ephemeral: true });
        }
    }
};
