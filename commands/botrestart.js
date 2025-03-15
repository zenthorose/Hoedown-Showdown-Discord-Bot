const { SlashCommandBuilder } = require('@discordjs/builders');
const { statusChannelId } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botrestart')  // Renamed from 'restart' to 'botrestart'
        .setDescription('Restarts the bot (Admin Only)'),
    
    async execute(interaction) {
        const allowedUserId = '144747826981765120'; // Replace with your actual Discord ID

        if (interaction.user.id !== allowedUserId) {
            return interaction.reply({ content: "❌ You do not have permission to restart the bot!", ephemeral: true });
        }

        await interaction.reply({ content: "🔄 Restarting bot...", ephemeral: true });

        // Send restart message to status channel
        const channel = interaction.client.channels.cache.get(statusChannelId);
        if (channel) {
            await channel.send("🔄 Bot is restarting...");
        }

        console.log("🔄 Restarting bot by command...");
        process.exit(1); // Exit process, Render will auto-restart
    }
};
