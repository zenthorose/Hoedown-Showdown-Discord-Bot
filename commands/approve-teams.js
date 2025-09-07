const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('approve-teams')
        .setDescription('Approves a team set for use.')
        .addIntegerOption(option =>
            option.setName('teamset')
                .setDescription('The team set number to approve')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            // --- Permission check ---
            const permissionError = await checkPermissions(interaction);
            if (permissionError) {
                return interaction.reply({ content: String(permissionError), ephemeral: true });
            }

            const teamSet = interaction.options.getInteger('teamset');
            console.log(`Received approve-teams command: teamSet=${teamSet}`);

            // --- Send ephemeral processing message ---
            let replyMessage;
            try {
                replyMessage = await interaction.reply({
                    content: `🔄 Processing approval for Team Set #${teamSet}...`,
                    fetchReply: true,
                    ephemeral: true
                });
            } catch (err) {
                console.error("Error sending processing reply:", err);
            }

            // --- Send approval request to Google Apps Script ---
            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

                await axios.post(triggerUrl, {
                    command: "approve-teams",
                    teamSet: teamSet
                });

                console.log("Approval request sent to Google Apps Script.");

                // --- Log to log channel ---
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`✅ Team set "${teamSet}" has been approved.`);
                }

                // --- Send success message and delete after 5 seconds ---
                if (replyMessage) {
                    await replyMessage.edit(`✅ Team Set #${teamSet} approved successfully!`);
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