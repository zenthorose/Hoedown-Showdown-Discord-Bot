const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { Hoedown_New_banner } = require('../config.json'); // Default emoji from config

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Send an announcement followed by multiple reaction role messages!'),
    async execute(interaction, reactionPostsManager) {
        try {
            // List of preset time slots
            const timeSlots = [
                "8:00 AM EST", "9:30 AM EST", "11:00 AM EST", "12:30 PM EST",
                "2:00 PM EST", "3:30 PM EST", "5:00 PM EST", "6:30 PM EST",
                "8:00 PM EST", "9:30 PM EST", "11:00 PM EST", "12:30 AM EST",
                "2:00 AM EST", "3:30 AM EST", "5:00 AM EST", "6:30 AM EST",
            ];

            // List of emojis (must match the length of `timeSlots`)
            const emojis = [
                "🔥", "🌟", "⚡", "💥", "🎉", "🚀", "🕒", "⏰",
                "🌙", "☀️", "🎶", "🏆", "📅", "✅", "🎭", "👑"
            ];

            // Ensure lists are the same length to avoid mismatches
            if (timeSlots.length !== emojis.length) {
                throw new Error("The number of emojis must match the number of time slots.");
            }

            // Acknowledge command first
            const responseMessage = await interaction.reply({ 
                content: "Posting reaction role messages...", 
                ephemeral: true 
            });

            // 🔹 Post an **Introductory Embed** before the time slot messages
            const introEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle("📢 Time Slot Sign-Ups")
                .setDescription("React to the messages below to sign up for a time slot. Make sure to remove your reaction if you are no longer available.")
                .setTimestamp();

            await interaction.channel.send({ embeds: [introEmbed] });

            // Loop through each time slot and emoji
            for (let i = 0; i < timeSlots.length; i++) {
                const timeSlot = timeSlots[i];
                const emoji = emojis[i]; // Pick matching emoji for this time slot

                const exampleEmbed = new EmbedBuilder()
                    .setColor('#444444')
                    .setTitle(`React to ${emoji} to join the ${timeSlot} time slot!`)
                    .setTimestamp(); 

                const message = await interaction.channel.send({ embeds: [exampleEmbed] });
                reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });

                console.log(`Posted reaction role for: ${timeSlot} with emoji ${emoji}`);

                await message.react(emoji); // React with corresponding emoji

                // ⏳ Add a small delay (1 second) before posting the next message
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 🔥 Delete the original bot response after all messages are posted
            await responseMessage.delete();

        } catch (error) {
            console.error("Error executing reactionrole command:", error);
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
};
