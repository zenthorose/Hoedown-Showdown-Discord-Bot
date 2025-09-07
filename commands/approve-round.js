const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

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
        let replyMessage;

        try {
            // --- Role-based permission check ---
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => config.allowedRoles.includes(role.id));

            if (!hasRequiredRole) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    ephemeral: true
                });
            }

            const round = interaction.options.getInteger('round');
            console.log(`✅ Received approve-round command for Round #${round}`);

            // --- Send ephemeral "processing" message ---
            replyMessage = await interaction.reply({
                content: `🔄 Processing approval for Round #${round}...`,
                fetchReply: true,
                ephemeral: true
            });

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

                const response = await axios.post(triggerUrl, { command: "approve-round", round });
                console.log("✅ Google Apps Script responded:", response.data);

                // --- Log in the log channel ---
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`✅ Round #${round} has been approved.`);
                    console.log("✅ Logged approval in log channel.");
                }

                // --- Update ephemeral message to success and delete after 5s ---
                if (replyMessage) {
                    await replyMessage.edit(`✅ Round #${round} approved successfully!`);
                    setTimeout(async () => {
                        try { await replyMessage.delete(); } catch (err) { console.error(err); }
                    }, 5000);
                }

            } catch (gasError) {
                console.error("❌ Error triggering Google Apps Script:", gasError);
                if (replyMessage) {
                    await replyMessage.edit(`❌ There was an error triggering the Apps Script.`);
                    setTimeout(async () => { try { await replyMessage.delete(); } catch (err) { console.error(err); } }, 5000);
                }
                try {
                    const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                    if (logChannel) await logChannel.send(`❌ Error with Google Apps Script: ${gasError.message}`);
                } catch (logErr) {
                    console.error("❌ Failed to log GAS error:", logErr);
                }
            }

        } catch (error) {
            console.error("❌ Unexpected error:", error);
            return interaction.reply({ content: "❌ An unexpected error occurred.", ephemeral: true });
        }
    },
};
