const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('member-update')
        .setDescription('Updates member list in Google Sheets and resets nicknames to usernames.'),

    async execute(interaction) {
        // Permission check
        const hasPermission = await checkPermissions(interaction);
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        // Defer reply (private to invoker while running tasks)
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch all members of the guild
            await interaction.guild.members.fetch();

            //
            // ---- PART 1: Update Member List in Google Sheets ----
            //
            const sortedMembers = interaction.guild.members.cache
                .map(member => [
                    member.user.username, // Always use actual username
                    member.user.id        // Discord ID
                ])
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

            const memberData = [["Username", "Discord ID"], ...sortedMembers];
            const triggerUrl = process.env.Google_Apps_Script_URL;
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

            await axios.post(triggerUrl, {
                command: "member-update",
                memberData: memberData
            });

            //
            // ---- PART 2: Reset Nicknames ----
            //
            let successCount = 0;
            let skippedCount = 0;

            for (const member of interaction.guild.members.cache.values()) {
                try {
                    // Skip guild owner
                    if (member.id === interaction.guild.ownerId) {
                        skippedCount++;
                        continue;
                    }

                    // Skip if not manageable by the bot
                    if (!member.manageable) {
                        skippedCount++;
                        continue;
                    }

                    // Skip elevated permissions
                    if (
                        member.permissions.has('Administrator') ||
                        member.permissions.has('ManageGuild') ||
                        member.permissions.has('ManageNicknames')
                    ) {
                        skippedCount++;
                        continue;
                    }

                    // Reset nickname if different from username
                    if (member.displayName !== member.user.username) {
                        await member.setNickname(member.user.username);
                        successCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️ Could not update ${member.user.tag}: ${err.message}`);
                    skippedCount++;
                }
            }

            // ✅ Success message
            await interaction.editReply(
                `✅ Member update complete!\n- Synced with Google Sheets\n- Nicknames reset: ${successCount}\n- Skipped: ${skippedCount}`
            );

        } catch (error) {
            console.error("❌ Error with member-update:", error);
            await interaction.editReply("❌ Failed to update members. Check bot permissions and Google Apps Script URL.");
        }
    },
};
