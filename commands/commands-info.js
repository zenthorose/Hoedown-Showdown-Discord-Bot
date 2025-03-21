const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');  // Import the config file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commands-info')
        .setDescription('Shows a list of available commands'),

    async execute(interaction) {
        // Fetch the allowed roles and user IDs from the config file
        const allowedRoles = config.allowedRoles;
        const allowedUserIds = config.allowedUserIds;

        // Check if the user has the required role or the specific Discord ID
        const member = await interaction.guild.members.fetch(interaction.user.id);
        
        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.name));
        
        // Check if the user's Discord ID is in the allowed list
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        if (!hasRequiredRole && !isAllowedUser) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        const commands = [
            { name: '/info', description: 'Provides bot information' },
            { name: '/member-update', description: 'Gathers a list of all members of the discord before sending it to the Google Sheets.' },
            { name: '/message-purge', description: 'Deletes all previous messages from the bot in whatever channel the command was entered in.' },
            { name: '/grab-reactions', description: 'Sends the list of reactions from the selected message to the Google Sheets to begin the team creation.' },
            { name: '/time-slots', description: 'Posts all of the timeslot posts for people to opt in or out of.' },
            { name: '/testreactions', description: 'Temp command, will be removed and likely won’t work currently.' },
            { name: '/ping', description: 'Checks bot latency' }
        ];

        let commandList = commands.map(cmd => `\"${cmd.name}\" - ${cmd.description}`).join('\n');

        // Send the command list in a code block, visible to everyone
        await interaction.reply({
            content: `\`\`\`\nHere are my commands:\n\n${commandList}\n\`\`\``
        });
    }
};
