const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab-reactions')  // Command name
        .setDescription('Grabs people that reacted to the message to form teams out of them.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to check reactions for')
                .setRequired(true)
        ),

    async execute(interaction) {
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        let replyMessage;
        try {
            replyMessage = await interaction.reply({
                content: 'Grabbing reactions... Please wait.',
                fetchReply: true
            });

            const messageId = interaction.options.getString('messageid');
            console.log("✅ Message ID received:", messageId);

            // Fetch OptInChannelID from environment variables
            const channelId = config.OptInChannelID;
            if (!channelId) throw new Error('OptInChannelID is not defined in config properties.');

            console.log(`✅ Found OptInChannelID from config properties: ${channelId}`);

            // Fetch the specific channel by ID
            const channel = await interaction.guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) throw new Error(`Invalid or non-text channel: ${channelId}`);

            // Fetch the message in the specific channel
            const message = await channel.messages.fetch(messageId);
            if (!message) throw new Error('Message not found in the specified channel.');

            const uniqueUsernames = new Set();
            for (const [_, reaction] of message.reactions.cache) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUsernames.add(user.username); // Collecting usernames instead of user IDs
                });
            }

            console.log("✅ Unique usernames collected:", Array.from(uniqueUsernames));

            // Send the reaction data to Google Apps Script (no posting back in the channel)
            const triggerUrl = process.env.Google_Apps_Script_URL;
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

            await axios.post(triggerUrl, {
                command: 'grab-reactions',
                discordUsernames: Array.from(uniqueUsernames) // Sending usernames instead of IDs
            });

            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send("✅ Reaction user list update triggered!");
            await interaction.channel.send("✅ Reaction user list update triggered in Google Sheets!");

            if (replyMessage) await replyMessage.delete();
        } catch (error) {
            console.error("❌ Error in grab-reactions command:", error);
            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(`❌ Error in grab-reactions command: ${error.message}`);
            await interaction.channel.send("❌ Failed to trigger Google Apps Script.");

            if (replyMessage) await replyMessage.delete();
        }
    },
};
