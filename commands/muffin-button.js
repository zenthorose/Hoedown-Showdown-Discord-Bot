const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),

    async execute(interaction) {
        try {
            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
            const isAllowedUser = allowedUserIds.includes(interaction.user.id);

            // Check permissions
            if (!hasRequiredRole && !isAllowedUser) {
                await interaction.reply({
                    content: '❌ You do not have permission to use this command.',
                    ephemeral: true
                });
                return;
            }

            // Defer reply to handle processing
            await interaction.deferReply({ ephemeral: true });

            // Create the muffin button using v14 syntax
            const muffinButton = new ButtonBuilder()
                .setCustomId('muffin')
                .setLabel('Muffin Button')
                .setStyle(ButtonStyle.Primary);

            // Use ActionRowBuilder for the row
            const row = new ActionRowBuilder().addComponents(muffinButton);

            // Send the response
            await interaction.editReply({
                content: 'Muffin!',
                components: [row],
            });
        } catch (error) {
            console.error(error);

            // Check if interaction was already acknowledged
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: '❌ There was an error executing this command.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '❌ There was an error executing this command.',
                    ephemeral: true
                });
            }
        }
    }
};
