const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-message')
        .setDescription('Updates a message previously sent by the bot.')
        .addStringOption(option => 
            option.setName('channelid')
                .setDescription('The ID of the channel where the message was sent')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('messageid')
                .setDescription('The ID of the message to update')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('newcontent')
                .setDescription('The new embed description')
                .setRequired(true)),

    async execute(interaction) {
        const channelId = interaction.options.getString('channelid');
        const messageId = interaction.options.getString('messageid');
        const newContent = interaction.options.getString('newcontent');

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel) return interaction.reply({ content: "Invalid channel ID.", ephemeral: true });

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return interaction.reply({ content: "Message not found.", ephemeral: true });

        if (!message.editable) return interaction.reply({ content: "I can't edit this message.", ephemeral: true });

        const newEmbed = new EmbedBuilder()
            .setTitle(newContent)
            .setColor('#444444')
            .setTimestamp();

        await message.edit({ embeds: [newEmbed] });

        interaction.reply({ content: "Message updated successfully!", ephemeral: true });
    }
};
