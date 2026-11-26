const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { splitDiscordMessage } = require('../database/teamDrafts');

function getAvoidPairs(documents, selectedUserId = '') {
  const pairs = [];
  for (const document of documents) {
    const sourceId = String(document._id || '');
    const sourceName = String(document.name || sourceId).trim();
    for (const relation of Array.isArray(document.avoids) ? document.avoids : []) {
      const targetId = String(relation.discordId || relation.id || '');
      if (!targetId || (selectedUserId && sourceId !== selectedUserId &&
          targetId !== selectedUserId)) continue;
      const targetName = String(relation.name || targetId).trim();
      if (sourceName && targetName) pairs.push([sourceName, targetName]);
    }
  }
  return pairs;
}

function formatAvoidListMessages(pairs, selectedUser) {
  const list = pairs
    .map((pair, index) => `**${index + 1}.** 🛑 ${pair[0]} =/ ${pair[1]}`)
    .join('\n');
  const title = selectedUser
    ? `📋 Avoid List for **${selectedUser.username}** (showing ${pairs.length}):`
    : `📋 Avoid List (showing ${pairs.length}):`;
  return splitDiscordMessage(`${title}\n${list}`, 1900);
}

module.exports = {
  getAvoidPairs,
  formatAvoidListMessages,
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
        if (logChannel) {
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
        await logUsage("❌ Permission denied");
        return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          flags: 64
        });
      }

      const selectedUser = interaction.options.getUser('player');

      // --- Defer reply to avoid Unknown interaction errors ---
      try {
        await interaction.deferReply({ flags: 64 });
        replyDeferred = true;
      } catch (err) {
        // If defer fails, we'll continue and attempt to reply later
        console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
        replyDeferred = false;
      }

      const database = await connectHoedownInfoDatabase();
      const selectedUserId = selectedUser ? String(selectedUser.id) : '';
      const filter = selectedUserId
        ? { $or: [{ _id: selectedUserId }, { 'avoids.discordId': selectedUserId }] }
        : {};
      const documents = await database.collection('Avoids').find(filter, {
        projection: { _id: 1, name: 1, avoids: 1 }
      }).toArray();
      const pairs = getAvoidPairs(documents, selectedUserId);
      if (pairs.length === 0) {
        const noResultMsg = selectedUser
          ? `✅ No avoid pairs found for **${selectedUser.username}**.`
          : "✅ Avoid list is currently empty.";
        await interaction.editReply(noResultMsg);
        return;
      }

      const messages = formatAvoidListMessages(pairs, selectedUser);
      await interaction.editReply(messages[0]);
      for (const message of messages.slice(1)) {
        await interaction.followUp({ content: message, flags: 64 });
      }
      await logUsage(`→ Returned ${pairs.length} pairs${selectedUser ? ` for ${selectedUser.username}` : ""}`);

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