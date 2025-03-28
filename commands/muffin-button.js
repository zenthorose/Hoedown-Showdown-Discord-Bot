const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),

    async execute(interaction) {
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        // Check permissions
        if (!hasRequiredRole && !isAllowedUser) {
            await interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true // Visible only to the user
            });
            return;
        }

        // Defer reply to avoid multiple responses
        await interaction.deferReply({ ephemeral: true });

        // Create the muffin button
        const muffinButton = new ButtonBuilder()
            .setCustomId('muffin')
            .setLabel('Muffin Button')
            .setStyle(ButtonStyle.Primary);

        const row = new MessageActionRow().addComponents(muffinButton);

        // Update the original reply
        await interaction.editReply({
            content: 'Muffin!',
            components: [row],
        });
    }
};
