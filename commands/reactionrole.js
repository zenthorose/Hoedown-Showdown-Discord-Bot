const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { MaleEmoji, MaleName, FemaleEmoji, FemaleName } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Send the reaction role message!'),
    async execute(interaction, reactionPostsManager) {
        const exampleEmbed = new EmbedBuilder()
            .setColor('#444444')
            .setTitle('React to the emoji if you are able to make it to this time slot.')
            .setDescription(`Once you have reacted you will be added to the list for the round! If you are unable to make this round please remove your reaction.\n\n${MaleEmoji} for ${MaleName}\n${Hoedown_New_banner} for ${FemaleName}\n`)
            .setTimestamp();

        const message = await interaction.reply({ embeds: [exampleEmbed], fetchReply: true });
        reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });
        console.log(`Added new reaction post via slash command: ${message.id}`);
        console.log(reactionPostsManager.getAllPosts());

        // Add a slight delay before adding the bot's reactions
        // await new Promise(resolve => setTimeout(resolve, 500));
        await message.react(MaleEmoji);
        await message.react(FemaleEmoji);
        console.log(`Bot reacted to message via slash command: ${message.id}`);
    }
};