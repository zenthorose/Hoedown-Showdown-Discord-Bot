const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json'); // Import the config file
const { checkPermissions } = require('../permissions'); // Import the permissions check

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message-purge')
        .setDescription('Deletes all messages in this channel sent by the bot.')
        .setDefaultMemberPermissions(0), // Requires Manage Messages permission

    async execute(interaction) {
        // Use the checkPermissions function to validate the user’s role or ID
        const permissionError = await checkPermissions(interaction);
        if (permissionError) {
            return interaction.reply({
                content: permissionError,
                ephemeral: true
            });
        }

        // Ensure the bot has permissions to delete messages
        if (!interaction.channel.permissionsFor(interaction.client.user).has("ManageMessages")) {
            return interaction.reply({ content: "❌ I don't have permission to delete messages in this channel.", ephemeral: true });
        }

        // Defer the reply to avoid interaction timeout
        await interaction.deferReply({ ephemeral: true });

        try {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });

            const botMessages = messages.filter(msg => msg.author.bot);

            if (botMessages.size === 0) {
                return interaction.editReply("✅ No bot messages found to delete.");
            }

            await interaction.channel.bulkDelete(botMessages, true);

            interaction.editReply(`✅ Deleted ${botMessages.size} bot messages!`);
        } catch (error) {
            console.error("❌ Error deleting messages:", error);
            interaction.editReply("❌ Failed to delete bot messages. Make sure messages are not older than 14 days.");
        }
    }
};