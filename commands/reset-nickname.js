const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-all-nicknames')
        .setDescription('Resets all server member nicknames back to their default Discord usernames.'),

    async execute(interaction) {
        // Permission check first
        const hasPermission = await checkPermissions(interaction);
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        // Defer reply (visible only to command invoker to avoid flooding chat)
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch all members in the guild
            await interaction.guild.members.fetch();

            let successCount = 0;
            let skippedCount = 0;

            // Loop through all members
            for (const member of interaction.guild.members.cache.values()) {
                try {
                    if (member.manageable && member.nickname) {
                        // Reset nickname (null = remove nickname)
                        await member.setNickname(null);
                        successCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️ Could not reset nickname for ${member.user.tag}: ${err.message}`);
                    skippedCount++;
                }
            }

            await interaction.editReply(`✅ Nickname reset complete!\n- Success: ${successCount}\n- Skipped: ${skippedCount}`);
        } catch (error) {
            console.error("❌ Error bulk resetting nicknames:", error);
            await interaction.editReply("❌ Failed to bulk reset nicknames. Check bot permissions and role hierarchy.");
        }
    },
};
