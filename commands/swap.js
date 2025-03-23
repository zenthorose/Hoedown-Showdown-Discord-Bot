const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap a player in the last column of the sheet.')
        .addStringOption(option =>
            option.setName('oldplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('newplayer')
                .setDescription('The player to be added')
                .setRequired(true)),
    
    async execute(interaction) {
        const oldPlayer = interaction.options.getString('oldplayer');
        const newPlayer = interaction.options.getString('newplayer');

        console.log(`Received swap command: oldPlayer=${oldPlayer}, newPlayer=${newPlayer}`);

        // Acknowledge the interaction with a deferReply
        await interaction.deferReply();

        try {
            // Send the request to the Google Apps Script
            const response = await fetch('https://script.google.com/macros/s/AKfycbzA23TVLxEhPBVNiL6Fk7R7jjQ1fo5TKKcOX2jnn9AWqFDPxTUzRT_4AAiwV4JN-DJE/dev', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command: 'swap',
                    oldPlayer: oldPlayer,
                    newPlayer: newPlayer
                })
            });

            const responseText = await response.text();
            console.log(`Response from Google Apps Script: ${responseText}`);

            // Function to split long messages
            function splitMessage(content, maxLength = 2000) {
                const chunks = [];
                while (content.length > maxLength) {
                    let splitIndex = content.lastIndexOf("\n", maxLength); // Try to split at a newline
                    if (splitIndex === -1) splitIndex = maxLength; // If no newline found, hard cut
                    chunks.push(content.slice(0, splitIndex));
                    content = content.slice(splitIndex);
                }
                chunks.push(content);
                return chunks;
            }

            const messages = splitMessage(responseText);

            console.log(`Split response into ${messages.length} parts`);

            // Edit the initial deferred reply with updated message
            await interaction.editReply(messages[0]); // Edit the initial reply with first message
            for (let i = 1; i < messages.length; i++) {
                await interaction.followUp(messages[i]); // Follow up with remaining parts
            }
        } catch (error) {
            console.error("Error sending request:", error);
            await interaction.editReply("An error occurred while processing the request.");
        }
    }
};
