const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js'); // ✅ use MessageFlags
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info-check')
        .setDescription('See your currently submitted info.'),

    async execute(interaction) {
        console.log('[DEBUG] Command execution started');

        const userId = interaction.user.id;
        const triggerUrl = process.env.Google_Apps_Script_URL;

        if (!triggerUrl) {
            console.log('[DEBUG] Google Apps Script URL missing');
            return await interaction.reply({ 
                content: '❌ Error: Google Apps Script URL is not defined.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            console.log('[DEBUG] Sending initial ephemeral reply');
            await interaction.reply({ 
                content: 'Fetching your info...', 
                flags: MessageFlags.Ephemeral 
            });
        } catch (error) {
            console.log('[DEBUG] Initial reply failed:', error);
            // If interaction was already acknowledged, skip defer
        }

        try {
            console.log('[DEBUG] Sending request to Google Script', { userId });
            const response = await axios.post(triggerUrl, {
                command: 'info-check',
                userId
            });

            const data = response.data;
            console.log('[DEBUG] Response from Google Script', data);

            if (data.error) {
                console.log('[DEBUG] User not found in Google Script');
                return await safeEdit(interaction, `❌ ${data.error}`);
            }

            const msg = [
                `✅ Here’s your submitted info:`,
                `**Region:** ${data.region || 'Not set'}`,
                `**Steam Code:** ${data.steamCode || 'Not set'}`,
                `**Stream Link:** ${data.streamLink || 'Not set'}`
            ].join('\n');

            console.log('[DEBUG] Editing reply with user info');
            await safeEdit(interaction, msg);

        } catch (error) {
            console.error('[DEBUG] Error fetching info:', error);
            await safeEdit(interaction, '⚠️ Error fetching info. Please try again later.');
        }

        console.log('[DEBUG] Command execution finished');

        // Helper to safely edit or send reply
        async function safeEdit(interaction, content) {
            try {
                await interaction.editReply({ content });
            } catch (err) {
                console.log('[DEBUG] editReply failed, trying reply instead:', err);
                try {
                    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
                } catch (followErr) {
                    console.error('[DEBUG] followUp also failed:', followErr);
                }
            }
        }
    }
};
