const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info-check')
        .setDescription('See your currently submitted info.'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const triggerUrl = process.env.Google_Apps_Script_URL;

        if (!triggerUrl) {
            return await interaction.reply({ 
                content: '❌ Error: Google Apps Script URL is not defined.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.reply({ 
                content: 'Fetching your info...', 
                flags: MessageFlags.Ephemeral 
            });
        } catch (error) {
            // Ignore if interaction was already acknowledged
        }

        try {
            const response = await axios.post(triggerUrl, {
                command: 'info-check',
                userId
            });

            const data = response.data;

            if (data.error) {
                return await safeEdit(interaction, `❌ ${data.error}`);
            }

            const msg = [
                `✅ Here’s your submitted info:`,
                `**Region:** ${data.region || 'Not set'}`,
                `**Steam Code:** ${data.steamCode || 'Not set'}`,
                `**Stream Link:** ${data.streamLink || 'Not set'}`
            ].join('\n');

            await safeEdit(interaction, msg);

        } catch (error) {
            await safeEdit(interaction, '⚠️ Error fetching info. Please try again later.');
        }

        async function safeEdit(interaction, content) {
            try {
                await interaction.editReply({ content });
            } catch {
                try {
                    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
                } catch {}
            }
        }
    }
};
