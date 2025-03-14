const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('members')
        .setDescription('Fetches a list of all server members.'),
    async execute(interaction) {
        await interaction.guild.members.fetch(); // Ensures cache is populated
        const members = interaction.guild.members.cache.map(member => `${member.user.username}#${member.user.discriminator}`).join('\n');
        
        if (members.length > 2000) {
            return interaction.reply('Member list is too long to display.');
        }

        await interaction.reply(`**Server Members:**\n${members}`);
    },
};
