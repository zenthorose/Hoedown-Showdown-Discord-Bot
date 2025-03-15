const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactions')
        .setDescription('Fetches reactions from a specific message in any channel.')
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
            await interaction.reply(`Failed to fetch reactions for message ID ${messageId}.`);
        }
    },
};
