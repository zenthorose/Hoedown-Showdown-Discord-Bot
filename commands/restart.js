const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restarts the bot (Admin Only)'),
    
    async execute(interaction) {
        const allowedUserId = '144747826981765120'; // Replace with your Discord ID

        if (interaction.user.id !== allowedUserId) {
            return interaction.reply({ content: "❌ You do not have permission to restart the bot!", ephemeral: true });
        }

        await interaction.reply({ content: "🔄 Restarting bot...", ephemeral: true });

        console.log("🔄 Restarting bot by command...");
        process.exit(1); // Exits the process, triggering a restart if managed by a process manager
    }
};
