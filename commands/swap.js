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

            // Send messages in sequence and store their message IDs for later editing
            const sentMessages = [];  // Store the sent message IDs here
            const firstMessage = await interaction.editReply(messages[0]);
            sentMessages.push(firstMessage.id);  // Store the first message ID

            for (let i = 1; i < messages.length; i++) {
                const nextMessage = await interaction.followUp(messages[i]);
                sentMessages.push(nextMessage.id);  // Store the message ID for subsequent messages
            }

            // Here, you can update the stored messages after the swap
            // Example: Edit all the messages based on the stored message IDs
            setTimeout(async () => {
                for (const messageId of sentMessages) {
                    const messageToEdit = await interaction.channel.messages.fetch(messageId);
                    await messageToEdit.edit("Updated message after swap!");
                }
            }, 5000); // Update after 5 seconds or any other delay you deem fit

        } catch (error) {
            console.error("Error sending request:", error);
            await interaction.editReply("An error occurred while processing the request.");
        }
    }
};
