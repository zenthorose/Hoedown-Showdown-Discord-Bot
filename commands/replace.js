const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replace')
        .setDescription('Replace a player in a round.')
        .addIntegerOption(option =>
            option.setName('round')
                .setDescription('The round number')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        // --- Permission check ---
        const allowedRoles = config.allowedRoles;
        if (!interaction.guild) {
            return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

            if (!hasRequiredRole) {
                return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
            }

            const round = interaction.options.getInteger('round');
            const removeUser = interaction.options.getUser('removeplayer');
            const addUser = interaction.options.getUser('addplayer');

            console.log(`Received replace command: round=${round}, remove=${removeUser.tag}, add=${addUser.tag}`);

            // --- Clear previous bot messages in channel ---
            try {
                const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
                const botMessages = fetchedMessages.filter(msg => msg.author.bot);

                if (botMessages.size > 0) {
                    await interaction.channel.bulkDelete(botMessages, true);
                    console.log(`Deleted ${botMessages.size} bot messages.`);
                }
            } catch (clearError) {
                console.error("❌ Error clearing bot messages:", clearError);
            }

            // --- Send ephemeral "processing" message ---
            let replyMessage;
            try {
                replyMessage = await interaction.reply({
                    content: `🔄 Processing replacement for Round #${round}...`,
                    fetchReply: true
                });
            } catch (err) {
                console.error("Error sending processing reply:", err);
            }

            // --- Send replacement data to Google Apps Script ---
            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

                await axios.post(triggerUrl, {
                    command: "replace",
                    round: round,
                    removePlayer: { username: removeUser.username, id: removeUser.id },
                    addPlayer: { username: addUser.username, id: addUser.id }
                });

                console.log("Replacement data sent to Google Apps Script.");

                // --- Log to log channel ---
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`✅ Player **${removeUser.username}** (${removeUser.id}) has been replaced with **${addUser.username}** (${addUser.id}) in Round #${round}.`);
                }

                // --- Update ephemeral message to success and delete after 5s ---
                if (replyMessage) {
                    await replyMessage.edit(`✅ Replacement completed! Player **${removeUser.username}** has been replaced with **${addUser.username}** in Round #${round}.`);
                    setTimeout(async () => {
                        try { await replyMessage.delete(); } catch (err) { console.error(err); }
                    }, 5000);
                }

            } catch (error) {
                console.error("Error with Google Apps Script:", error);

                if (replyMessage) {
                    await replyMessage.edit(`❌ There was an error triggering the Apps Script.`);
                    setTimeout(async () => {
                        try { await replyMessage.delete(); } catch (err) { console.error(err); }
                    }, 5000);
                }

                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
            }

        } catch (error) {
            console.error("❌ Error checking permissions:", error);
            return interaction.reply({ content: "❌ Error checking permissions.", ephemeral: true });
        }
    }
};
