const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('time-slots')
        .setDescription('Send an announcement followed by multiple time slot sign-up messages!'),

    async execute(interaction, reactionPostsManager) {
        try {
            console.log("🔹 Starting time-slots command");

            // --- Role / user permission check ---
            const member = await interaction.guild.members.fetch(interaction.user.id);
            console.log("Fetched member:", member.user.tag);

            const allowedRoles = Array.isArray(config.allowedRoles) ? config.allowedRoles : [];
            console.log("Allowed roles from config:", allowedRoles);

            const hasRequiredRole = member && member.roles.cache.some(role => allowedRoles.includes(role.id));
            console.log("Has required role?", hasRequiredRole);

            const isAllowedUser = Array.isArray(config.allowedUserIds) ? config.allowedUserIds.includes(interaction.user.id) : false;
            console.log("Is allowed user?", isAllowedUser);

            if (!hasRequiredRole && !isAllowedUser) {
                console.warn("❌ Permission check failed");
                return interaction.reply({ content: "❌ You don't have the required role or ID to use this command.", ephemeral: true });
            }

            const targetChannel = interaction.channel;
            console.log("Target channel:", targetChannel.name);

            // --- Validate timeSlots / emojis length ---
            if (!Array.isArray(config.timeSlots) || !Array.isArray(config.emojis)) {
                console.error("❌ timeSlots or emojis not defined in config");
                return interaction.reply({ content: "❌ Configuration error: timeSlots or emojis not set.", ephemeral: true });
            }

            console.log("timeSlots:", config.timeSlots);
            console.log("emojis:", config.emojis);

            if (config.timeSlots.length !== config.emojis.length) {
                console.warn("⚠️ Warning: The number of emojis does not match the number of time slots.");
            }

            // --- Send a public processing message so it can be deleted later ---
            const responseMessage = await interaction.reply({ 
                content: "Posting time slot sign-up messages...", 
                fetchReply: true
            });
            console.log("Processing message sent, message ID:", responseMessage.id);

            // --- Post introductory embed ---
            const introEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle("Hoedown Showdown Time Slot Sign-Ups")
                .setDescription("React to the messages below to sign up for a time slot. Make sure to remove your reaction if you are no longer available.")
                .setTimestamp();

            const introMessage = await targetChannel.send({ embeds: [introEmbed] });
            console.log("Introductory embed posted, message ID:", introMessage.id);

            // --- Post each time slot ---
            for (let i = 0; i < config.timeSlots.length; i++) {
                const timeSlot = config.timeSlots[i];
                const emoji = config.emojis[i];

                console.log(`Posting time slot #${i + 1}: ${timeSlot} with emoji ${emoji}`);

                const exampleEmbed = new EmbedBuilder()
                    .setColor('#444444')
                    .setTitle(`React to the emoji below to join the ${timeSlot} time slot!`)
                    .setTimestamp(); 

                const message = await targetChannel.send({ embeds: [exampleEmbed] });
                console.log(`Time slot message posted, message ID: ${message.id}`);

                if (reactionPostsManager && typeof reactionPostsManager.addPost === "function") {
                    reactionPostsManager.addPost({ channelId: message.channel.id, messageId: message.id, embedId: exampleEmbed.id, reactions: [] });
                    console.log("Added message to reactionPostsManager");
                } else {
                    console.warn("⚠️ reactionPostsManager not defined or addPost not a function");
                }

                await message.react(emoji);
                console.log(`Reacted to message with emoji: ${emoji}`);

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // --- Delete processing message after all posts ---
            if (responseMessage) {
                setTimeout(async () => {
                    try { 
                        await responseMessage.delete(); 
                        console.log("Processing message deleted");
                    } catch (err) { 
                        console.error("Error deleting processing message:", err); 
                    }
                }, 5000);
            }

        } catch (error) {
            console.error("Error executing time-slots command:", error);
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
};
