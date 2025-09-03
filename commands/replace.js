const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replace')
        .setDescription('Replace a player in a round.')
        .addIntegerOption(option =>
            option.setName('round')
                .setDescription('The round number')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('removeplayer')
                .setDescription('The player to be removed')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('addplayer')
                .setDescription('The player to be added')
                .setRequired(true)),

    async execute(interaction) {
        const allowedRoles = config.allowedRoles;

        if (!interaction.guild) {
            return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

            if (!hasRequiredRole) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command!',
                    ephemeral: true
                });
            }

            const round = interaction.options.getInteger('round');
            const removePlayer = interaction.options.getString('removeplayer');
            const addPlayer = interaction.options.getString('addplayer');

            console.log(`Received replace command: round=${round}, removePlayer=${removePlayer}, addPlayer=${addPlayer}`);

            await interaction.reply({ content: `🔄 Processing replacement for Round #${round}...`, ephemeral: true });

            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

                await axios.post(triggerUrl, {
                    command: "replace",
                    round: round,
                    removePlayer: removePlayer,
                    addPlayer: addPlayer
                });

                console.log("Replacement data sent to Google Apps Script.");

                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`✅ Player "${removePlayer}" has been replaced with "${addPlayer}" in Round #${round}.`);

                await interaction.followUp({ content: `✅ Replacement completed successfully.`, ephemeral: true });

            } catch (error) {
                console.error("Error with Google Apps Script:", error);

                await interaction.followUp({ content: "❌ There was an error triggering the Apps Script.", ephemeral: true });

                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`❌ Error with Google Apps Script: ${error.message}`);
            }

        } catch (error) {
            console.error("❌ Error checking permissions:", error);
            return interaction.reply({ content: "❌ Error checking permissions.", ephemeral: true });
        }
    }
};
