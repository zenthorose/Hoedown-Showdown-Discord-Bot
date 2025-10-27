const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grab-reactions')
    .setDescription('Grabs people that reacted to the message to form teams out of them.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addStringOption(option =>
      option
        .setName('messageid')
        .setDescription('The ID of the message to check reactions for')
        .setRequired(true)
    ),

  async execute(interaction) {
    let replyMessage;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/grab-reactions** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);
      const messageId = interaction.options.getString('messageid');

      // Always log attempt
      await logUsage(`(messageId: ${messageId})`);

      if (!hasPermission) {
        await logUsage("❌ Permission denied");
        return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          ephemeral: true
        });
      }

      replyMessage = await interaction.reply({
        content: '🔄 Grabbing reactions... Please wait.',
        fetchReply: true
      });

      const channelId = config.OptInChannelID;
      if (!channelId) throw new Error('OptInChannelID is not defined in config.json');

      const channel = await interaction.guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased())
        throw new Error(`Invalid or non-text channel: ${channelId}`);

      const message = await channel.messages.fetch(messageId);
      if (!message) throw new Error('Message not found in the specified channel.');

      // --- Collect all unique players from all reactions (with pagination) ---
      const uniquePlayers = new Map();

      for (const [, reaction] of message.reactions.cache) {
        let lastId;
        while (true) {
          const fetched = await reaction.users.fetch({ limit: 100, after: lastId });
          if (fetched.size === 0) break;

          fetched.forEach(user => {
            if (!user.bot && !uniquePlayers.has(user.id)) {
              uniquePlayers.set(user.id, {
                id: user.id,
                name: user.username
              });
            }
          });

          if (fetched.size < 100) break;
          lastId = fetched.last().id;
        }
      }

      console.log(`✅ Unique players collected (${uniquePlayers.size} total):`, Array.from(uniquePlayers.values()));

      // --- Send player list to Google Apps Script ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      await axios.post(triggerUrl, {
        command: 'grab-reactions',
        discordPlayers: Array.from(uniquePlayers.values())
      });

      await logUsage(`✅ Sent ${uniquePlayers.size} players to Google Sheets`);

      if (replyMessage) await replyMessage.delete();

    } catch (error) {
      console.error("❌ Error in grab-reactions:", error);
      await logUsage(`❌ Error: ${error.message}`);

      try {
        await interaction.channel.send("❌ Failed to trigger Google Apps Script.");
      } catch (err) {
        console.error("❌ Failed to notify channel:", err);
      }

      if (replyMessage) {
        try { await replyMessage.delete(); } catch {}
      }
    }
  }
};
