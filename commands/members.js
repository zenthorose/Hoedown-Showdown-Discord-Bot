const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('members')
        .setDescription('Fetches a list of all server members with their IDs.'),
    async execute(interaction) {
        await interaction.guild.members.fetch(); // Ensures cache is populated
        const members = interaction.guild.members.cache
            .map(member => `${member.user.username} (ID: ${member.user.id})`)
            .join('\n');

            const { MessageAttachment } = require('discord.js');
            const fs = require('fs');
            
            if (members.length > 2000) {
                fs.writeFileSync('members.txt', members);
                const attachment = new MessageAttachment('members.txt');
                return interaction.reply({ content: 'Member list:', files: [attachment] });
            }

        await interaction.reply(`**Server Members:**\n${members}`);
    },
};
