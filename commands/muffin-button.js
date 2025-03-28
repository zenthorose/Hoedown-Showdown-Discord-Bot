const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json'); // Assuming the roles and user IDs are in a config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),
    
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

        // If the user doesn't have the required role or ID, deny access
        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have the required permissions to use this command.',
                ephemeral: true, // Sends the reply privately to the user
            });
        }

        // Create the muffin button using ButtonBuilder
        const muffinButton = new ButtonBuilder()
            .setCustomId('muffin') // The custom ID used to identify the button click
            .setLabel('Muffin Button') // Button label
            .setStyle(ButtonStyle.Primary); // Button style (Primary, Secondary, Danger, Link)

        // Create a row to hold the button using ActionRowBuilder
        const row = new ActionRowBuilder().addComponents(muffinButton);

        // Send the message with the button
        await interaction.reply({
            content: 'Muffin!',
            components: [row],
        });
    },
};
