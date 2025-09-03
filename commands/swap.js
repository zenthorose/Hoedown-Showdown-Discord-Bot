const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json'); // Ensure config contains required API credentials

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap the positions of two players in a round.')
        .addStringOption(option =>
            option.setName('round')
                .setDescription('The round number (e.g., 3)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('player1')
                .setDescription('The first player to swap')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('player2')
                .setDescription('The second player to swap')
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

            const round = interaction.options.getString('round');
            const player1 = interaction.options.getString('player1');
            const player2 = interaction.options.getString('player2');

            console.log(`Received swap command: round=${round}, player1=${player1}, player2=${player2}`);

            await interaction.reply({ content: `🔄 Processing swap for Round #${round}...`, ephemeral: true });

            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

                // Send swap data
                await axios.post(triggerUrl, {
                    command: "swap",
                    round: round,
                    player1: player1,
                    player2: player2
                });

                console.log("Swap data sent to Google Apps Script.");

                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`✅ Players "${player1}" and "${player2}" have been swapped in Round #${round}.`);

                await interaction.followUp({ content: `✅ Swap completed successfully.`, ephemeral: true });

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
