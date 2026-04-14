const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions'); // Assume this is a helper function to check permissions

// Per-feature send toggles for this command
const SENDS = {
    REPLIES: true,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!')
        .setDefaultMemberPermissions(0), // Requires Manage Messages permission
    async execute(interaction) {
        try {
            // Check if the user has permission to run the command
            const hasPermission = await checkPermissions(interaction);

            if (!hasPermission) {
                if (SENDS.REPLIES) return interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    flags: 64,
                });
                return;
            }

            // If the user has permission, reply with Pong!
            if (SENDS.REPLIES) await interaction.reply('Pong!');

        } catch (error) {
            console.error("❌ Error in /ping command:", error);
            return interaction.reply({
                content: '❌ Something went wrong!',
                flags: 64,
            });
        }
    },
};