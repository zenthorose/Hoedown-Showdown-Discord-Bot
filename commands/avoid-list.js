const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

// Per-feature send toggles for this command
const SENDS = {
  LOGS: true,
  REPLIES: true,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avoid-list')
    .setDescription('View the current avoid pairings.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages
    .addUserOption(option =>
      option.setName('player')
        .setDescription('Filter avoid pairs by this player')
    ),

  async execute(interaction) {
    let replyDeferred = false;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel && SENDS.LOGS) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`📝 **/avoid-list** used by **${userTag}** in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);
      await logUsage();

      if (!hasPermission) {
        if (SENDS.LOGS) await logUsage("❌ Permission denied");
        if (SENDS.REPLIES) return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          flags: 64
        });
        return;
      }

      const selectedUser = interaction.options.getUser('player');
      const payload = { command: 'avoid-list' };
      if (selectedUser) payload.userId = selectedUser.id;

      console.log('📤 Sending avoid-list request to GAS:', JSON.stringify(payload, null, 2));

      // --- Defer reply to avoid Unknown interaction errors ---
      try {
        await interaction.deferReply({ flags: 64 });
        replyDeferred = true;
      } catch (err) {
        // If defer fails, we'll continue and attempt to reply later
        console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
        replyDeferred = false;
      }

      // --- Trigger the GAS avoid-list function ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const response = await axios.post(triggerUrl, payload);
      console.log("✅ GAS response:", response.data);

      if (!response.data.success) {
        if (SENDS.LOGS) await logUsage("❌ GAS error");
        if (SENDS.REPLIES) await interaction.editReply("❌ Failed to fetch avoid list.");
        return;
      }

      const pairs = response.data.pairs || [];
      if (pairs.length === 0) {
        const noResultMsg = selectedUser
          ? `✅ No avoid pairs found for **${selectedUser.username}**.`
          : "✅ Avoid list is currently empty.";
        if (SENDS.REPLIES) await interaction.editReply(noResultMsg);
        return;
      }

      const list = pairs
        .map((p, i) => `**${i + 1}.** 🛑 ${p[0]} =/ ${p[1]}`)
        .join("\n");

      const title = selectedUser
        ? `📋 Avoid List for **${selectedUser.username}** (showing ${pairs.length}):`
        : `📋 Avoid List (showing ${pairs.length}):`;

      const finalMessage = `${title}\n${list}`;
      if (SENDS.REPLIES) await interaction.editReply(finalMessage);
      if (SENDS.LOGS) await logUsage(`→ Returned ${pairs.length} pairs${selectedUser ? ` for ${selectedUser.username}` : ""}`);

      // Optional: delete reply after 10 seconds (to keep things tidy)
      //setTimeout(async () => {
      //  try { await interaction.deleteReply(); } catch { }
      //}, 10000);

    } catch (error) {
      console.error("❌ Error executing /avoid-list:", error);
      await logUsage(`❌ Error: ${error.message}`);

      try {
        if (interaction.deferred || interaction.replied || replyDeferred) {
          await interaction.editReply("❌ There was an error executing this command. Please try again.");
        } else {
          await interaction.reply({ content: "❌ There was an error executing this command. Please try again.", flags: 64 });
        }
      } catch (err) {
        console.error("❌ Failed to send error message:", err);
      }
    }
  }
};