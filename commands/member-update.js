const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { syncGuildMemberProfiles } = require('../database/memberListImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-update')
    .setDescription('Syncs Discord members to Google Sheets and HoedownInfo.')
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
      await interaction.guild.members.fetch();

      const sortedMembers = interaction.guild.members.cache
        .map((member) => ({
          nickname: member.displayName,
          username: member.user.username,
          discordId: member.user.id
        }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'en', { sensitivity: 'base' }));

      const results = [];

      //
      // ---- PART 1: Sync member names and IDs to Google Sheets ----
      //
      try {
        const triggerUrl = process.env.Google_Apps_Script_URL;
        if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');
        const memberData = [
          ['Nickname', 'Username', 'Discord ID'],
          ...sortedMembers.map(({ nickname, username, discordId }) => [nickname, username, discordId])
        ];
        await axios.post(triggerUrl, {
          command: 'member-update',
          memberData
        });
        results.push(`✅ Google Sheets: synced ${sortedMembers.length} member(s).`);
      } catch (error) {
        console.error('❌ Google Sheets member sync failed:', error);
        results.push(`❌ Google Sheets: ${error.message}`);
      }

      //
      // ---- PART 2: Sync member names and IDs to HoedownInfo.Members ----
      //
      try {
        const database = await connectHoedownInfoDatabase();
        const profiles = sortedMembers.map(({ nickname, username, discordId }) => ({
          _id: discordId,
          discordId,
          username,
          nickname
        }));
        const result = await syncGuildMemberProfiles(database, profiles);
        results.push(
          `✅ MongoDB (${result.collectionName}): synced ${result.profileCount} member(s); ` +
          `${result.insertedCount} inserted, ${result.matchedCount} updated.`
        );
      } catch (error) {
        console.error('❌ MongoDB member sync failed:', error);
        results.push(`❌ MongoDB (HoedownInfo.Members): ${error.message}`);
      }

      const failures = results.filter((result) => result.startsWith('❌'));
      const resultMsg = [
        failures.length === 0 ? '✅ Member update complete!' : '⚠️ Member update partially completed.',
        ...results,
        '- Nickname reset: disabled'
      ].join('\n');
      await interaction.editReply(resultMsg);
      await logUsage(
        failures.length === 0
          ? `✅ Completed | Members synced: ${sortedMembers.length}`
          : `⚠️ Partial failure | ${failures.join(' | ')}`
      );

    } catch (error) {
      console.error("❌ Error with member-update:", error);
      await interaction.editReply("❌ Failed to fetch the Discord member list.");
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};