const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { Hoedown_New_banner } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Send the reaction role message!')
        .addStringOption(option => 
            option.setName('timeslot')
                .setDescription('Enter the time for this reaction role')
                .setRequired(true)
        ),
    async execute(interaction, reactionPostsManager) {
        const timeSlot = interaction.options.getString('timeslot'); // Get user-inputted time

        const exampleEmbed = new EmbedBuilder()
            .setColor('#444444')
            .setTitle(`React to ${Hoedown_New_banner} to join the ${timeSlot} time slot!`)
            .setDescription('') // Keeps the description blank for later use
            .setTimestamp();

        const message = await interaction.reply({ embeds: [exampleEmbed], fetchReply: true });
        reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });
        console.log(`Added new reaction post via slash command: ${message.id}`);

        await message.react(Hoedown_New_banner);
        console.log(`Bot reacted to message via slash command: ${message.id}`);
    }
};
