const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js'); // Use EmbedBuilder here
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!')
        .setDefaultMemberPermissions(0), // Requires Manage Messages permission

    async execute(interaction) {
        try {
            // Permission Checks
            const allowedRoles = config.allowedRoles;
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));

            if (!hasRequiredRole && !isAllowedUser) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command.',
                    ephemeral: true  // Make this message visible only to the user
                });
            }

            // Create Muffin Button
            const muffinButton = new ButtonBuilder()
                .setCustomId('muffin')
                .setLabel('Muffin Button')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(muffinButton);

            // Create the embed with the provided GIF using EmbedBuilder
            const embed = new EmbedBuilder()
                .setTitle('Press the Muffin Button!')
                .setImage('https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/94aaf128-b928-4b05-a219-3ceb2e442f5a/d4fcns8-722041b1-8ce8-4e37-a658-72972ea5cdea.gif?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiJcL2ZcLzk0YWFmMTI4LWI5MjgtNGIwNS1hMjE5LTNjZWIyZTQ0MmY1YVwvZDRmY25zOC03MjIwNDFiMS04Y2U4LTRlMzctYTY1OC03Mjk3MmVhNWNkZWEuZ2lmIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.bd_CR7qSxv6UjSdNYTQXATodTpjtlD00ypcBAhqsVFM');

            // Send the message with the button and the embed
            await interaction.channel.send({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error(error);
            // Send an error message and delete it after 5 seconds
            interaction.channel.send({
                content: '❌ Failed to send the muffin button!'
            }).then(msg => msg.delete({ timeout: 5000 }));
        }
    }
};