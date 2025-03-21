const { SlashCommandBuilder } = require('@discordjs/builders');
const { allowedRoles, allowedIds } = require('../config.json'); // Assuming roles and IDs are in config.json

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    async execute(interaction) {
        // Check if the user has the required role or ID
        const member = interaction.guild.members.cache.get(interaction.user.id);

        // Check if the member has any of the allowed roles or matching ID
        const hasRequiredRole = member && member.roles.cache.some(role => allowedRoles.includes(role.id));
        const isAllowedUser = allowedIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({ content: "❌ You don't have the required role or ID to use this command.", ephemeral: true });
        }

        // Respond with "Pong!" if the user has the required permissions
        await interaction.reply('Pong!');
    },
};
