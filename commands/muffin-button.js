const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),

    async execute(interaction) {
        try {
            // Permission Checks
            const allowedRoles = config.allowedRoles;
            const allowedUserIds = config.allowedUserIds;

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
            const isAllowedUser = allowedUserIds.includes(interaction.user.id);

            if (!hasRequiredRole && !isAllowedUser) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command.',
                    ephemeral: true
                });
            }

            // Create Muffin Button
            const muffinButton = new ButtonBuilder()
                .setCustomId('muffin')
                .setLabel('Muffin Button')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(muffinButton);

            // Send the message with the button
            await interaction.reply({
                content: 'Press the Muffin Button!',
                components: [row]
            });

        } catch (error) {
            console.error(error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Failed to send the muffin button!',
                    ephemeral: true
                });
            }
        }
    }
};
