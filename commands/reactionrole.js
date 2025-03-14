const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { MaleEmoji, FemaleEmoji } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Send the reaction role message without assigning roles.'),
    async execute(interaction, reactionPostsManager) {
        const exampleEmbed = new EmbedBuilder()
            .setColor('#444444')
            .setTitle('React to the emoji if you are able to make it to this time slot.')
            .setDescription(`Once you have reacted, you will be added to the list for the round!\n\n${MaleEmoji} - Male\n${FemaleEmoji} - Female`)
            .setTimestamp();

        const message = await interaction.reply({ embeds: [exampleEmbed], fetchReply: true });
        reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });

        console.log(`Added new reaction post via slash command: ${message.id}`);
        console.log(reactionPostsManager.getAllPosts());

        await message.react(MaleEmoji);
        await message.react(FemaleEmoji);
        console.log(`Bot reacted to message: ${message.id}`);
    }
};
