const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');  // Import the config file
const { checkPermissions } = require('../permissions');  // Import the checkPermissions function

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commands-info')
        .setDescription('Shows a list of available commands'),

    async execute(interaction) {
        // Check if the user has the required permissions (role or user ID)
        const hasPermission = await checkPermissions(interaction);

        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        const commands = [
            { name: '/commands-info', description: 'Provides bot information' },
            { name: '/member-update', description: 'Gathers a list of all members of the discord before sending it to the Google Sheets.' },
            { name: '/message-purge', description: 'Deletes all previous messages from the bot in whatever channel the command was entered in.' },
            { name: '/time-slots', description: 'Posts all of the timeslot posts for people to opt in or out of.' },
            { name: '/grab-reactions', description: 'Sends the list of reactions from the selected message to the Google Sheets to begin the team creation.' },
            { name: '/swap', description: 'Used to replace members on teams before official list is posted. Enter Team Set # followed by the person you are replacing lastly who you are replacing them with.' },
            { name: '/approve-teams', description: 'Use this command after the team has been reviewed and everything is good to publish the official Team List to everyone.' },
            { name: '/region-change', description: 'Changes your region to one of the three options "East", "West", or "Both".' },
            { name: '/region-check', description: 'Returns what regions you are currently selected for.' },
            { name: '/ping', description: 'This keeps the bot alive.' }
        ];

        let commandList = commands.map(cmd => `\"${cmd.name}\" - ${cmd.description}`).join('\n');

        // Send the command list in a code block, visible to everyone
        await interaction.reply({
            content: `\`\`\`\nHere are my commands:\n\n${commandList}\n\`\`\``
        });
    }
};
