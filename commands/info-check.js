const { SlashCommandBuilder } = require('@discordjs/builders');
const { InteractionResponseFlags } = require('discord.js'); // v14+

const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info-check')
        .setDescription('See your currently submitted info.'),

    async execute(interaction) {
        const userId = interaction.user.id;

        // Reply instantly with flags.Ephemeral
        await interaction.reply({ 
            content: 'Fetching your info...', 
            flags: InteractionResponseFlags.Ephemeral 
        });

        const triggerUrl = process.env.Google_Apps_Script_URL;
        if (!triggerUrl) {
            return await interaction.editReply({ content: 'Error: Google Apps Script URL is not defined.' });
        }

        try {
            // Post to Google Apps Script and wait for JSON back
            const response = await axios.post(triggerUrl, {
                command: 'info-check',
                userId: userId
            });

            const data = response.data;

            if (data.error) {
                return await interaction.editReply({ content: `❌ ${data.error}` });
            }

            const msg = [
                `✅ Here’s your submitted info:`,
                `**Region:** ${data.region || 'Not set'}`,
                `**Steam Code:** ${data.steamCode || 'Not set'}`,
                `**Stream Link:** ${data.streamLink || 'Not set'}`
            ].join('\n');

            await interaction.editReply({ content: msg });

        } catch (error) {
            console.error('Error sending request:', error);
            await interaction.editReply({ content: '⚠️ Error fetching info. Please try again later.' });
        }
    }
};
