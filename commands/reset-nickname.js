const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-all-nicknames')
        .setDescription('Resets all server member nicknames back to their default Discord usernames.'),

    async execute(interaction) {
        // Permission check
        const hasPermission = await checkPermissions(interaction);
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        // Defer reply (private to invoker)
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch all members from the guild
            await interaction.guild.members.fetch();

            let successCount = 0;
            let skippedCount = 0;

            for (const member of interaction.guild.members.cache.values()) {
                try {
                    // Skip the guild owner (can never change)
                    if (member.id === interaction.guild.ownerId) {
                        console.log(`⏩ Skipped ${member.user.tag}: Guild Owner`);
                        skippedCount++;
                        continue;
                    }

                    // Skip if not manageable by the bot
                    if (!member.manageable) {
                        console.log(`⏩ Skipped ${member.user.tag}: Not manageable by bot`);
                        skippedCount++;
                        continue;
                    }

                    // Skip if member has elevated permissions
                    if (
                        member.permissions.has('Administrator') ||
                        member.permissions.has('ManageGuild') ||
                        member.permissions.has('ManageNicknames')
                    ) {
                        console.log(`⏩ Skipped ${member.user.tag}: Elevated permissions`);
                        skippedCount++;
                        continue;
                    }

                    // Only reset if they have a nickname
                    if (member.nickname) {
                        await member.setNickname(null);
                        console.log(`✅ Reset nickname for ${member.user.tag}`);
                        successCount++;
                    } else {
                        console.log(`⏩ Skipped ${member.user.tag}: No nickname set`);
                        skippedCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️ Could not reset nickname for ${member.user.tag}: ${err.message}`);
                    skippedCount++;
                }
            }

            await interaction.editReply(
                `✅ Nickname reset complete!\n- Success: ${successCount}\n- Skipped: ${skippedCount}`
            );
        } catch (error) {
            console.error("❌ Error bulk resetting nicknames:", error);
            await interaction.editReply("❌ Failed to bulk reset nicknames. Check bot permissions and role hierarchy.");
        }
    },
};
