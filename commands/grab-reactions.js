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

        console.log("Reached before environment variable check");
        const triggerUrl = 'https://script.google.com/macros/s/AKfycbxTzAHpufp3lI1N5W3K01MDTES7HCd1sJsiqRKmjNIy84J6R92QgVSqBmW5igfvZXuH/exec';
        console.log("Google Apps Script URL:", triggerUrl);

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
            const message = await interaction.channel.messages.fetch(messageId);
            const uniqueUserIds = new Set();

            for (const [_, reaction] of message.reactions.cache) {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) uniqueUserIds.add(user.id);
                });
            }

            console.log("Reached before environment variable check");
            const triggerUrl = process.env.Google_Apps_Script_URL;
            console.log("Google Apps Script URL:", triggerUrl);
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

            await axios.post(triggerUrl, {
                command: 'grab-reactions',
                discordIds: Array.from(uniqueUserIds)
            });

            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send("✅ Reaction user list update triggered!");
            await interaction.channel.send("✅ Reaction user list update triggered in Google Sheets!");

            if (replyMessage) await replyMessage.delete();
        } catch (error) {
            await interaction.client.channels.cache.get(config.LOG_CHANNEL_ID).send(`❌ Error: ${error.message}`);
            await interaction.channel.send("❌ Failed to trigger Google Apps Script.");

            if (replyMessage) await replyMessage.delete();
        }
    },
};
