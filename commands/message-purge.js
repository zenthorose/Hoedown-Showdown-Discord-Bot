const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID

// Per-feature send toggles for this command
const SENDS = {
  LOGS: true,
  REPLIES: true,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message-purge')
    .setDescription('Deletes all messages in this channel sent by the bot.')
    .setDefaultMemberPermissions(0), // Requires Manage Messages permission

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (!SENDS.REPLIES) {
        try {
          if (replied || interaction.deferred) {
            const res = await interaction.followUp({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          } else {
            const res = await interaction.reply({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          }
        } catch (err) {
          return null;
        }
      }

      const options = { content: String(content) };
      if (isEphemeral) options.flags = 64;
      try {
        if (replied || interaction.deferred) {
          const res = await interaction.followUp(options);
          replied = true;
          return res;
        } else {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        }
      } catch (err) {
        try {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        } catch (err2) {
          return null;
        }
      }
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel && SENDS.LOGS) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `🧹 **/message-purge** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // --- Permission check ---
      const permResult = await checkPermissions(interaction);
      if (typeof permResult === 'string') {
        if (SENDS.LOGS) await logUsage(`❌ Permission denied (${permResult})`);
        if (SENDS.REPLIES) return safeReply(permResult, true);
        return;
      }

      // Ensure bot has Manage Messages permission
      if (!interaction.channel.permissionsFor(interaction.client.user).has('ManageMessages')) {
        await logUsage("❌ Missing Manage Messages permission");
        return safeReply("❌ I don't have permission to delete messages in this channel.", true);
      }

      // Defer reply to avoid interaction timeout
      try {
        if (SENDS.REPLIES) await interaction.deferReply({ flags: 64 });
      } catch (err) {
        console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
      }

      // Fetch last 100 messages
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(msg => msg.author.bot);

      if (botMessages.size === 0) {
        if (SENDS.REPLIES) await interaction.editReply("✅ No bot messages found to delete.");
        if (SENDS.LOGS) await logUsage("✅ No bot messages found");
        return;
      }

      // Bulk delete
      await interaction.channel.bulkDelete(botMessages, true);

      const resultMsg = `✅ Deleted ${botMessages.size} bot messages!`;
      if (SENDS.REPLIES) await interaction.editReply(resultMsg);
      if (SENDS.LOGS) await logUsage(`✅ Deleted ${botMessages.size} bot messages`);

    } catch (error) {
      console.error("❌ Error deleting messages:", error);
      try {
        await safeReply("❌ Failed to delete bot messages. Make sure messages are not older than 14 days.", true);
      } catch (err) {
        console.error("❌ Failed to send error reply:", err);
      }
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};
