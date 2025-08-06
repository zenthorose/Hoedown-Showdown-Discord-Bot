const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js'); // For permission handling
const config = require('../config.json'); // Import your config

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-assign')
        .setDescription('Assigns a specified role to all server members.')
        .addRoleOption(option => 
            option.setName('role')
            .setDescription('The role to assign to all members.')
            .setRequired(true)
        ),

    async execute(interaction) {
        try {
            // Check if the user has the "Administrator" permission
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({
                    content: '❌ You lack the required permissions (Administrator) to use this command!',
                    ephemeral: true
                });
            }

            const role = interaction.options.getRole('role');

            // Confirm the action
            await interaction.reply({
                content: `⚡ Starting to assign the "${role.name}" role to all members...`,
                ephemeral: true
            });

            // Fetch all server members
            await interaction.guild.members.fetch(); // Ensure all members are cached

            const members = interaction.guild.members.cache;

            let successCount = 0;
            let errorCount = 0;

            for (const [_, member] of members) {
                // Skip bots
                if (member.user.bot) continue;

                try {
                    // Assign role
                    await member.roles.add(role);
                    successCount++;
                } catch (err) {
                    console.error(`❌ Failed to assign role to ${member.user.username}:`, err);
                    errorCount++;
                }
            }

            await interaction.editReply(`✅ Role "${role.name}" assigned to ${successCount} members. Errors: ${errorCount}`);
        } catch (error) {
            console.error("❌ Error in role-assign command:", error);
            await interaction.editReply("❌ An error occurred while assigning roles.");
        }
    },
};