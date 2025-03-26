const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json'); // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
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

            // Respond with "Pong!" if the user has the required permissions
            await interaction.reply('Pong!');

        } catch (error) {
            console.error("❌ Error checking permissions:", error);
            return interaction.reply({ content: "❌ Error checking permissions.", ephemeral: true });
        }
    },
};
