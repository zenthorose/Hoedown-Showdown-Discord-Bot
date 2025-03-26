const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json'); // Load config

module.exports = {
    data: new SlashCommandBuilder()
        .setName('time-slots')  // Command name
        .setDescription('Send an announcement followed by multiple time slot sign-up messages!'),  // Description
    
    async execute(interaction, reactionPostsManager) {
        // Check if the user has the required role or ID
        const member = interaction.guild.members.cache.get(interaction.user.id);

        // Check if the member has any of the allowed roles or matching ID
        const hasRequiredRole = member && member.roles.cache.some(role => config.allowedRoles.includes(role.name)); // Changed to role.name
        const isAllowedUser = config.allowedUserIds.includes(interaction.user.id); // Changed to allowedUserIds

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({ content: "❌ You don't have the required role or ID to use this command.", ephemeral: true });
        }

        try {
            const targetChannel = interaction.channel; // Use the current channel

            // Ensure lists are the same length
            if (config.timeSlots.length !== config.emojis.length) {
                console.warn("⚠️ Warning: The number of emojis does not match the number of time slots.");
            }

            // Acknowledge command first
            const responseMessage = await interaction.reply({ 
                content: "Posting time slot sign-up messages...", 
                ephemeral: true 
            });

            // 🔹 Post an **Introductory Embed** before the time slot messages
            const introEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle("Hoedown Showdown Time Slot Sign-Ups")
                .setDescription("React to the messages below to sign up for a time slot. Make sure to remove your reaction if you are no longer available.")
                .setTimestamp();

            await targetChannel.send({ embeds: [introEmbed] });

            // Loop through each time slot and emoji
            for (let i = 0; i < config.timeSlots.length; i++) {
                const timeSlot = config.timeSlots[i];
                const emoji = config.emojis[i]; // Pick matching emoji for this time slot

                const exampleEmbed = new EmbedBuilder()
                    .setColor('#444444')
                    .setTitle(`React to the emoji below to join the ${timeSlot} time slot!`)
                    .setTimestamp(); 

                const message = await targetChannel.send({ embeds: [exampleEmbed] });
                reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });

                console.log(`Posted time slot for: ${timeSlot} in ${targetChannel.name} with emoji ${emoji}`);

                await message.react(emoji); // React with corresponding emoji

                // ⏳ Add a small delay (1 second) before posting the next message
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 🔥 Delete the original bot response after all messages are posted
            await responseMessage.delete();

        } catch (error) {
            console.error("Error executing timeslots command:", error);
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
};
