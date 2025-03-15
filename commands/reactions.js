const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactions')
        .setDescription('Fetches reactions from a specific message without needing a channel ID.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        const messageId = interaction.options.getString('messageid');

        try {
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
                    .setTitle(`Reactions for message ID ${messageId}`)
                    .setTimestamp();

                for (const reaction of reactions.values()) {
                    const users = await reaction.users.fetch();
                    const userList = users
                        .filter(user => user.id !== interaction.client.user.id) // Ignore bot's own reactions
                        .map(user => user.username)
                        .join(', ');

                    embed.addFields({ name: `Emoji: ${reaction.emoji.name}`, value: userList || 'No users' });
                }

                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply(`No reactions found for message ID ${messageId}.`);
            }
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `Failed to fetch reactions for message ID ${messageId}.`, ephemeral: true });
        }
    },
};