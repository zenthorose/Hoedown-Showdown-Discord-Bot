const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-update')
    .setDescription('Updates member list in Google Sheets.')
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
        flags: 64
      });
    }

    // ⏳ Defer reply (ephemeral so only invoker sees it)
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    try {
      // Fetch all members from the guild
      await interaction.guild.members.fetch();

      //
      // ---- PART 1: Update Member List in Google Sheets ----
      //
      const sortedMembers = interaction.guild.members.cache
        .map(member => [
          // Desired nickname to reset to: guild nickname if present, otherwise username
          member.nickname || member.user.username,
          member.user.username,
          member.user.id
        ])
        .sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base' }));

      const memberData = [["Nickname", "Username", "Discord ID"], ...sortedMembers];
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      await axios.post(triggerUrl, {
        command: "member-update",
        memberData: memberData
      });

      //
      // Notify success to invoker
      await interaction.editReply('✅ Member update complete! Synced with Google Sheets.');

      // 📝 Public log
      await logUsage('✅ Completed | Synced with Google Sheets');

    } catch (error) {
      console.error("❌ Error with member-update:", error);
      await interaction.editReply("❌ Failed to update members. Check bot permissions and Google Apps Script URL.");
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};