const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { Hoedown_New_banner } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Send multiple reaction role messages with different times!'),
    async execute(interaction, reactionPostsManager) {
        try {
            // List of preset time slots
            const timeSlots = [
                "8:00 AM EST",
                "9:30 AM EST",
                "11:00 AM EST",
                "12:30 PM EST",
                "2:00 PM EST",
                "3:30 PM EST",
                "5:00 PM EST",
                "6:30 PM EST",
                "8:00 PM EST",
                "9:30 PM EST",
                "11:00 PM EST",
                "12:30 AM EST",
                "2:00 AM EST",
                "3:30 AM EST",
                "5:00 AM EST",
                "6:30 AM EST",
            ];

            // Loop through each time slot and send a message
            for (const timeSlot of timeSlots) {
                const exampleEmbed = new EmbedBuilder()
                    .setColor('#444444')
                    .setTitle(`${Hoedown_New_banner} React to join the ${timeSlot} time slot!`)
                    //.setDescription('') Keeps the description blank for later use
                    .setTimestamp(); // No description needed

                const message = await interaction.channel.send({ embeds: [exampleEmbed] });
                reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });

                console.log(`Posted reaction role for: ${timeSlot}`);

                // Bot reacts to the message with the banner emoji
                await message.react(Hoedown_New_banner);
            }

            // Confirm execution to the user
            await interaction.reply({ content: "Reaction role messages posted!", ephemeral: true });

        } catch (error) {
            console.error("Error executing reactionrole command:", error);
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
};

