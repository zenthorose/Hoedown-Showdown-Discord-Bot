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

            // Acknowledge the command before posting messages
            await interaction.reply({ content: "Posting reaction role messages...", ephemeral: true });

            // Loop through each time slot and send a message
            for (const timeSlot of timeSlots) {
                const exampleEmbed = new EmbedBuilder()
                    .setColor('#444444')
                    .setTitle(`${Hoedown_New_banner} React to join the ${timeSlot} time slot!`)
                    .setTimestamp(); 

                const message = await interaction.channel.send({ embeds: [exampleEmbed] });
                reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });

                console.log(`Posted reaction role for: ${timeSlot}`);

                await message.react(Hoedown_New_banner);

                // ⏳ Add a small delay (1 second) before posting the next message
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

        } catch (error) {
            console.error("Error executing reactionrole command:", error);
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
};
