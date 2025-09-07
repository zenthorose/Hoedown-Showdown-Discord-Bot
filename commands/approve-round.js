const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('approve-round')
        .setDescription('Approves a round for use.')
        .addIntegerOption(option =>
            option.setName('round')
                .setDescription('The round number to approve')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            // --- Permission check ---
            const permissionError = await checkPermissions(interaction);
            if (permissionError) {
                console.log("Permission check failed:", permissionError);
                return interaction.reply({ content: String(permissionError), ephemeral: true });
            }

            const round = interaction.options.getInteger('round');
            console.log(`Received approve-round command: round=${round}`);

            // --- Send ephemeral "processing" message ---
            let replyMessage;
            try {
                replyMessage = await interaction.reply({
                    content: `🔄 Processing approval for Round #${round}...`,
                    fetchReply: true,
                    ephemeral: true
                });
                console.log("Sent ephemeral processing message.");
            } catch (err) {
                console.error("Error sending processing reply:", err);
            }

            // --- Clear previous bot messages in the channel ---
            try {
                const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
                const botMessages = fetchedMessages.filter(msg => msg.author.bot);
                if (botMessages.size > 0) {
                    await interaction.channel.bulkDelete(botMessages, true);
                    console.log(`Deleted ${botMessages.size} previous bot messages.`);
                }
            } catch (clearError) {
                console.error("❌ Error clearing bot messages:", clearError);
            }

            // --- Send approval request to Google Apps Script ---
            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');
                
                console.log(`Sending POST to Google Apps Script: ${triggerUrl}`);
                const response = await axios.post(triggerUrl, { command: "approve-round", round });
                console.log("Google Apps Script responded:", response.data);

                // --- Log to log channel ---
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`✅ Round #${round} has been approved.`);
                    console.log("Logged approval in log channel.");
                }

                // --- Update ephemeral message to success and delete after 5s ---
                if (replyMessage) {
                    await replyMessage.edit(`✅ Round #${round} approved successfully!`);
                    setTimeout(async () => {
                        try { await replyMessage.delete(); } catch (err) { console.error(err); }
                    }, 5000);
                }

            } catch (error) {
                console.error("❌ Error with Google Apps Script:", error);

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
