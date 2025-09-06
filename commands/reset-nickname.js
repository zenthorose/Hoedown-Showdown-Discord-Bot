const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-all-nicknames')
        .setDescription('Resets all server member display names to their default Discord usernames.'),

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
                    // Skip the guild owner (cannot change)
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

                    // Reset nickname if their display name doesn't match their username
                    if (member.displayName !== member.user.username) {
                        await member.setNickname(member.user.username);
                        console.log(`✅ Set display name to username for ${member.user.tag}`);
                        successCount++;
                    } else {
                        console.log(`⏩ Skipped ${member.user.tag}: Display name already matches username`);
                        skippedCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️ Could not update ${member.user.tag}: ${err.message}`);
                    skippedCount++;
                }
            }

            await interaction.editReply(
                `✅ Display name reset complete!\n- Updated: ${successCount}\n- Skipped: ${skippedCount}`
            );
        } catch (error) {
            console.error("❌ Error bulk resetting display names:", error);
            await interaction.editReply("❌ Failed to bulk reset display names. Check bot permissions and role hierarchy.");
        }
    },
};
