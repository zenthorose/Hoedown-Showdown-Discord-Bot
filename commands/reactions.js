module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactions')
        .setDescription('Fetches reactions from a specific message in any channel.')
        .setDescription('Fetches reactions from a specific message without needing a channel ID.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel where the message is located')
                .setRequired(true)
        ),

    async execute(interaction) {
        const messageId = interaction.options.getString('messageid');
        const targetChannel = interaction.options.getChannel('channel'); // Get the specified channel

        try {
            const targetMessage = await targetChannel.messages.fetch(messageId);
            const reactions = targetMessage.reactions.cache;
            let targetMessage = null;

            // Search all accessible channels for the message
            for (const [channelId, channel] of interaction.guild.channels.cache) {
                if (channel.isTextBased()) {
                    try {
                        targetMessage = await channel.messages.fetch(messageId);
                        if (targetMessage) break; // Stop searching once found
                    } catch (err) {
                        continue; // Ignore errors and move to the next channel
                    }
                }
            }

            if (!targetMessage) {
                return await interaction.reply({ content: `Message with ID ${messageId} not found in any accessible channel.`, ephemeral: true });
            }

            const reactions = targetMessage.reactions.cache;
            if (reactions.size > 0) {
                const embed = new EmbedBuilder()
                    .setColor('#444444')

@@ -46,7 +56,7 @@ module.exports = {
            }
        } catch (error) {
            console.error(error);
            await interaction.reply(`Failed to fetch reactions for message ID ${messageId}.`);
            await interaction.reply({ content: `Failed to fetch reactions for message ID ${messageId}.`, ephemeral: true });
        }
    },
};