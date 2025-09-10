const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions'); // Assume this is a helper function to check permissions

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
                return interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    ephemeral: true,
                });
            }

            // If the user has permission, reply with Pong!
            await interaction.reply('Pong!');

        } catch (error) {
            console.error("❌ Error in /ping command:", error);
            return interaction.reply({
                content: '❌ Something went wrong!',
                ephemeral: true,
            });
        }
    },
};