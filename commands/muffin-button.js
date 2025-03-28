const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),
    
    async execute(interaction) {
        // Create the muffin button
        const muffinButton = new MessageButton()
            .setCustomId('muffin') // The custom ID used to identify the button click
            .setLabel('Muffin Button') // Button label
            .setStyle('PRIMARY'); // Button style (PRIMARY, SECONDARY, DANGER, LINK)

        // Create a row to hold the button
        const row = new MessageActionRow().addComponents(muffinButton);

        // Send the message with the button
        await interaction.reply({
            content: 'Muffin!',
            components: [row],
        });
    },
};
