const { SlashCommandBuilder } = require('@discordjs/builders'); // Import SlashCommandBuilder
// Array to hold multiple message IDs
let messageIds = [];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap a player in a team.')
        .addStringOption(option =>
            option.setName('team')
                .setDescription('The team name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('oldplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('newplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const teamName = interaction.options.getString('team');
        const oldPlayer = interaction.options.getString('oldplayer');
        const newPlayer = interaction.options.getString('newplayer');

        console.log(`Received swap command: team=${teamName}, oldPlayer=${oldPlayer}, newPlayer=${newPlayer}`);

        // Acknowledge the interaction with a deferReply
        await interaction.deferReply();

        try {
            const response = await fetch('https://script.google.com/macros/s/AKfycbzA23TVLxEhPBVNiL6Fk7R7jjQ1fo5TKKcOX2jnn9AWqFDPxTUzRT_4AAiwV4JN-DJE/dev', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command: 'swap',
                    teamName: teamName,
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

            // Send the initial reply and store the message ID
            const initialReply = await interaction.editReply(messages[0]); // Edit the initial reply with first message
            messageIds.push(initialReply.id);  // Store the message ID

            // Follow up with remaining parts and store their message IDs
            for (let i = 1; i < messages.length; i++) {
                const followUp = await interaction.followUp(messages[i]);
                messageIds.push(followUp.id);  // Store each subsequent message ID
            }

        } catch (error) {
            console.error("Error sending request:", error);
            await interaction.editReply("An error occurred while processing the request.");
        }
    },

    // Function to edit all messages later
    async editAllMessages(newContent) {
        for (const messageId of messageIds) {
            try {
                const message = await interaction.channel.messages.fetch(messageId);
                await message.edit(newContent);
            } catch (error) {
                console.error(`Error editing message ${messageId}:`, error);
            }
        }
    },

    // Function to delete all messages later
    async deleteAllMessages() {
        for (const messageId of messageIds) {
            try {
                const message = await interaction.channel.messages.fetch(messageId);
                await message.delete();
            } catch (error) {
                console.error(`Error deleting message ${messageId}:`, error);
            }
        }
    }
};
