const { SlashCommandBuilder } = require('@discordjs/builders');
const { InteractionResponseFlags } = require('discord.js');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commands-info')
        .setDescription('Shows a list of available commands'),

    async execute(interaction) {
        try {
            const hasPermission = await checkPermissions(interaction);
            if (!hasPermission) {
                return await interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    flags: InteractionResponseFlags.Ephemeral
                });
            }

            // Defer reply to acknowledge and get more time
            await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });

            const commands = [
                { name: '/commands-info', description: 'Provides bot information' },
                // ... your other commands ...
            ];

            let commandList = commands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');

            await interaction.editReply({
                content: `\`\`\`\nHere are my commands:\n\n${commandList}\n\`\`\``
            });

        } catch (error) {
            console.error("Error executing commands-info command:", error);

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('❌ There was an error executing this command.');
            } else {
                await interaction.reply({ content: '❌ There was an error executing this command.', flags: InteractionResponseFlags.Ephemeral });
            }
        }
    }
};
