const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-my-nickname')
        .setDescription('Resets your server nickname back to your default Discord username.'),

    async execute(interaction) {
        // Defer reply (ephemeral so only you see it)
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get the member who invoked the command
            const member = await interaction.guild.members.fetch(interaction.user.id);

            // Reset nickname to null (clears server nickname, falls back to default username)
            await member.setNickname(null);

            await interaction.editReply("✅ Your nickname has been reset to your default Discord username!");
        } catch (error) {
            console.error("❌ Error resetting nickname:", error);
            await interaction.editReply("❌ Failed to reset your nickname. Make sure the bot has permission to manage nicknames and its role is above yours.");
        }
    },
};
