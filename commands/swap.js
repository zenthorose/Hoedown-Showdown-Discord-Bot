const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');

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

        // Send request to Google Apps Script
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
        await interaction.reply(responseText);
    }
};