const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-message')
        .setDescription('Manually updates a message sent by the bot.')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('The ID of the message to update')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('new_content')
                .setDescription('The new content for the message')
                .setRequired(true)),
    
    async execute(interaction) {
        const messageId = interaction.options.getString('message_id');
        const newContent = interaction.options.getString('new_content');

        try {
            const channel = interaction.channel;
            const message = await channel.messages.fetch(messageId);

            if (!message) {
                return interaction.reply({ content: 'Message not found.', ephemeral: true });
            }

            if (message.author.id !== interaction.client.user.id) {
                return interaction.reply({ content: 'I can only update my own messages.', ephemeral: true });
            }

            await message.edit(newContent);
            return interaction.reply({ content: 'Message updated successfully!', ephemeral: true });

        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'Failed to update the message. Check if the message ID is correct.', ephemeral: true });
        }
    }
};
