const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageAttachment } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('members')
        .setDescription('Fetches a list of all server members with their IDs.'),
    async execute(interaction) {
        await interaction.guild.members.fetch(); // Ensures cache is populated

        // Sort members alphabetically by username
        const sortedMembers = interaction.guild.members.cache
            .map(member => `${member.user.username} (ID: ${member.user.id})`)
            .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
            .join('\n');

        if (sortedMembers.length > 2000) {
            fs.writeFileSync('members.txt', sortedMembers);
            const attachment = new MessageAttachment('members.txt');
            return interaction.reply({ content: 'Member list:', files: [attachment] });
        }

        await interaction.reply(`**Server Members:**\n${sortedMembers}`);
    },
};
