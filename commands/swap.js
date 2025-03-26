const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('teamset')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const teamSet = interaction.options.getString('teamset');
        const removePlayer = interaction.options.getString('removeplayer');
        const addPlayer = interaction.options.getString('addplayer');

        console.log(`Received swap command: team=${teamSet}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

        // Initial response to avoid interaction timeout
        await interaction.reply({ content: `🔄 Processing swap...`, ephemeral: true });

        try {
            const triggerUrl = 'https://script.google.com/macros/s/AKfycbydZRdwzXzl-96Og3usrxCEKsDIAol0Yfukm1IGVUfScQ8N_DliIV-L40Hyk4BX00Ul/exec';
            await axios.post(triggerUrl, {
                command: "swap",
                teamSet: teamSet,
                removePlayer: removePlayer,
                addPlayer: addPlayer
            });

            console.log("Swap data sent to Google Apps Script.");

            // Fetch log channel and send update
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`✅ Player "${removePlayer}" has been removed from team "${teamSet}", and "${addPlayer}" has been added.`);

            // Follow up with success response
            await interaction.followUp({ content: `✅ Swap completed successfully.`, ephemeral: true });

        } catch (error) {
            console.error("Error with Google Apps Script:", error);

            await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

            // Log error to Discord channel
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
        }
    }
};
