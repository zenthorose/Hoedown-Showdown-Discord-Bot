const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab-reactions')  // Command name
        .setDescription('Fetches unique users who reacted to a specific message and uploads them to Google Sheets.')
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

        console.log("🔍 Checking permissions...");
        console.log("User ID:", interaction.user.id);
        console.log("Allowed Roles:", allowedRoles);
        console.log("Allowed User IDs:", allowedUserIds);
        console.log("Has Required Role:", hasRequiredRole);
        console.log("Is Allowed User:", isAllowedUser);

        if (!hasRequiredRole && !isAllowedUser) {
            console.log("❌ User lacks permission");
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

            const message = await interaction.channel.messages.fetch(messageId);
            console.log("✅ Fetched message:", message.id);

            const uniqueUserIds = new Set();

            for (const [_, reaction] of message.reactions.cache) {
                console.log("🔍 Checking reaction:", reaction.emoji.name);

                const users = await reaction.users.fetch();
                console.log("✅ Users fetched for reaction:", Array.from(users.keys()));

                users.forEach(user => {
                    if (!user.bot) {
                        uniqueUserIds.add(user.id);
                        console.log("✅ Added user ID:", user.id);
                    }
                });
            }

            console.log("✅ Unique User IDs collected:", Array.from(uniqueUserIds));

            const triggerUrl = process.env.Google_Apps_Script_URL;
            console.log("✅ Google Apps Script URL from environment:", triggerUrl);
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

            console.log("🚀 Sending data to Google Apps Script...");
            console.log("Payload:", {
                command: 'grab-reactions',
                discordIds: Array.from(uniqueUserIds)
            });

            const response = await axios.post(triggerUrl, {
                command: 'grab-reactions',
                discordIds: Array.from(uniqueUserIds)
            });

            console.log("✅ Google Apps Script Response:", response.data);

            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send("✅ Reaction user list update triggered!");
            await interaction.channel.send("✅ Reaction user list update triggered in Google Sheets!");

            if (replyMessage) await replyMessage.delete();
        } catch (error) {
            console.error("❌ Error in grab-reactions command:", error);

            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(`❌ Error: ${error.message}`);
            await interaction.channel.send("❌ Failed to trigger Google Apps Script.");

            if (replyMessage) await replyMessage.delete();
        }
    },
};
