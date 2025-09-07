const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('swap')
        .setDescription('Swap the positions of two players in a round.')
        .addIntegerOption(option =>
            option.setName('round')
                .setDescription('The round number')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('player1')
                .setDescription('The first player to swap')
                .setRequired(true))
        .addUserOption(option =>
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

            const round = interaction.options.getInteger('round');
            const player1 = interaction.options.getUser('player1');
            const player2 = interaction.options.getUser('player2');

            console.log(`Received swap command: round=${round}, player1=${player1.tag}, player2=${player2.tag}`);

            await interaction.reply({ content: `🔄 Processing swap for Round #${round}...`, ephemeral: true });

            // --- Clear bot messages in the channel ---
            try {
                const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
                const botMessages = fetchedMessages.filter(msg => msg.author.bot);

                if (botMessages.size > 0) {
                    await interaction.channel.bulkDelete(botMessages, true);
                    console.log(`Deleted ${botMessages.size} bot messages.`);
                }
            } catch (clearError) {
                console.error("❌ Error clearing bot messages:", clearError);
            }

            // --- Send swap data to Google Apps Script ---
            try {
                const triggerUrl = process.env.Google_Apps_Script_URL;
                if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

                await axios.post(triggerUrl, {
                    command: "swap",
                    round: round,
                    player1: {
                        username: player1.username,
                        id: player1.id
                    },
                    player2: {
                        username: player2.username,
                        id: player2.id
                    }
                });

                console.log("Swap data sent to Google Apps Script.");

                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                await logChannel.send(`✅ Players **${player1.username}** (${player1.id}) and **${player2.username}** (${player2.id}) have been swapped in Round #${round}.`);

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
