const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); // Updated imports

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin-button')
        .setDescription('Sends a muffin button for users to click!'),
    
    async execute(interaction) {
        // Create the muffin button using ButtonBuilder
        const muffinButton = new ButtonBuilder()
            .setCustomId('muffin') // The custom ID used to identify the button click
            .setLabel('Muffin Button') // Button label
            .setStyle(ButtonStyle.Primary); // Button style (Primary, Secondary, Danger, Link)

        // Create a row to hold the button using ActionRowBuilder
        const row = new ActionRowBuilder().addComponents(muffinButton);

        // Send the message with the button
        await interaction.reply({
            content: 'Muffin!',
            components: [row],
        });
    },
};
