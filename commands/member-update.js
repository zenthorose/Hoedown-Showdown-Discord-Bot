const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-update')
    .setDescription('Updates member list in Google Sheets and resets nicknames to usernames.')
    .setDefaultMemberPermissions(0), // Requires Manage Messages permission

  async execute(interaction) {
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `👤 **/member-update** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    // 🔒 Permission check
    const hasPermission = await checkPermissions(interaction);
    if (!hasPermission) {
      await logUsage("❌ Permission denied");
      return interaction.reply({
        content: '❌ You do not have permission to use this command!',
        ephemeral: true
      });
    }

    // ⏳ Defer reply (ephemeral so only invoker sees it)
    await interaction.deferReply({ ephemeral: true });

    try {
      // Fetch all members from the guild
      await interaction.guild.members.fetch();

      //
      // ---- PART 1: Update Member List in Google Sheets ----
      //
      const sortedMembers = interaction.guild.members.cache
        .map(member => [
          member.user.username, // Actual username
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

      // ✅ Success message to invoker
      const resultMsg =
        `✅ Member update complete!\n- Synced with Google Sheets\n- Nicknames reset: ${successCount}\n- Skipped: ${skippedCount}`;
      await interaction.editReply(resultMsg);

      // 📝 Public log
      await logUsage(`✅ Completed | Reset: ${successCount}, Skipped: ${skippedCount}`);

    } catch (error) {
      console.error("❌ Error with member-update:", error);
      await interaction.editReply("❌ Failed to update members. Check bot permissions and Google Apps Script URL.");
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};
