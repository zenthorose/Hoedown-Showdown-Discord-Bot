const { SlashCommandBuilder } = require('@discordjs/builders');
const { allowedRoles, allowedIds } = require('../config.json'); // Load allowed roles & IDs

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    async execute(interaction) {
        // Ensure the command is run in a server (not DM)
        if (!interaction.guild) {
            return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
        }

        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member) {
            return interaction.reply({ content: "❌ Unable to retrieve member data.", ephemeral: true });
        }

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));

        // Check if the user is in the allowed user list
        const isAllowedUser = allowedIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({ content: "❌ You don't have the required role or ID to use this command.", ephemeral: true });
        }

        // Respond with "Pong!" if the user has the required permissions
        await interaction.reply('Pong!');
    },
};
