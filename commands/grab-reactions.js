const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab-reactions')  // Command name
        .setDescription('Fetches unique users who reacted to a specific message in a specific channel and uploads them to Google Sheets.')
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

            // Fetch the channel ID from the Google Apps Script property "OptInChannelID"
            const triggerUrl = process.env.Google_Apps_Script_URL;
            console.log("✅ Google Apps Script URL:", triggerUrl);
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

            // Send a request to Google Apps Script to get the channel ID (OptInChannelID)
            const response = await axios.get(`${triggerUrl}?command=get-opt-in-channel-id`);
            const channelId = response.data.channelId;

            if (!channelId) throw new Error('Channel ID (OptInChannelID) not found in Google Apps Script.');

            console.log(`✅ Found OptInChannelID: ${channelId}`);

            // Fetch the specific channel by ID
            const channel = await interaction.guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) throw new Error(`Invalid or non-text channel: ${channelId}`);

            // Fetch the message in the specific channel
            const message = await channel.messages.fetch(messageId);
            if (!message) throw new Error('Message not found in the specified channel.');

            const uniqueUserIds = new Set();
            for (const [_, reaction] of message.reactions.cache) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUserIds.add(user.id);
                });
            }

            console.log("✅ Unique user IDs collected:", Array.from(uniqueUserIds));

            // Send the reaction data to Google Apps Script (no posting back in the channel)
            await axios.post(triggerUrl, {
                command: 'grab-reactions',
                discordIds: Array.from(uniqueUserIds)
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
