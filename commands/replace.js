const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replace')
    .setDescription('Replace a player or filler in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('removeplayer')
        .setDescription('The player to be removed (Discord user)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('removefiller')
        .setDescription('The filler to be removed (e.g., Filler 1)')
        .setRequired(false))
    .addUserOption(option =>
      option.setName('addplayer')
        .setDescription('The player to be added (Discord user)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('addfiller')
        .setDescription('The filler to be added (e.g., Filler 1)')
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
    }

    const round = interaction.options.getInteger('round');
    const removeUser = interaction.options.getUser('removeplayer');
    const removeFiller = interaction.options.getString('removefiller');
    const addUser = interaction.options.getUser('addplayer');
    const addFiller = interaction.options.getString('addfiller');

    // --- Validation ---
    if (!(removeUser || removeFiller)) {
      return interaction.reply({ content: '❌ You must specify either a player or a filler to remove.', ephemeral: true });
    }
    if (!(addUser || addFiller)) {
      return interaction.reply({ content: '❌ You must specify either a player or a filler to add.', ephemeral: true });
    }

    // --- Build payload for GAS ---
    const payload = {
      command: "replace",
      round,
      removePlayer: removeUser
        ? { username: removeUser.username, id: removeUser.id }
        : { username: removeFiller, id: null, filler: true },
      addPlayer: addUser
        ? { username: addUser.username, id: addUser.id }
        : { username: addFiller, id: null, filler: true }
    };

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/replace** by **${userTag}** (${userId}) in **#${channelName}** for Round #${round} | Removed: ${removeUser?.tag || removeFiller} ➝ Added: ${addUser?.tag || addFiller} ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // --- Permission Check ---
      const allowedRoles = config.allowedRoles || [];
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

      if (!hasRequiredRole) {
        await interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
        await logUsage("⚠️ Permission denied.");
        return;
      }

      console.log(`Received replace command: round=${round}, remove=${removeUser?.tag || removeFiller}, add=${addUser?.tag || addFiller}`);

      // --- Clear old bot messages ---
      try {
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        const botMessages = fetchedMessages.filter(msg => msg.author.bot);
        if (botMessages.size > 0) {
          await interaction.channel.bulkDelete(botMessages, true);
          console.log(`🧹 Deleted ${botMessages.size} bot messages.`);
        }
      } catch (clearError) {
        console.error("❌ Error clearing bot messages:", clearError);
      }

      // --- Acknowledge Command ---
      let replyMessage;
      try {
        replyMessage = await interaction.reply({
          content: `🔄 Processing replacement for Round #${round}...`,
          fetchReply: true
        });
      } catch (err) {
        console.error("Error sending processing reply:", err);
      }

      // --- Send replacement data to Google Apps Script ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const { data } = await axios.post(triggerUrl, payload);

      console.log("✅ GAS response:", data);

      // --- Interpret GAS response ---
      let userMessage;
      let logSuffix;

      switch (data.type) {
        case "success":
          userMessage = `✅ Replacement completed! **${removeUser?.username || removeFiller}** ➝ **${addUser?.username || addFiller}** in Round #${round}.`;
          logSuffix = "✅ Replacement successful.";
          break;
        case "duplicate":
          userMessage = `⚠️ Cannot replace: **${addUser?.username || addFiller}** is already in Round #${round}.`;
          logSuffix = "⚠️ Duplicate detected.";
          break;
        case "player_not_found":
          userMessage = `❌ Player not found in Discord Member List.`;
          if (data.missing?.removeMissing) userMessage += ` Missing remove: **${removeUser?.username || removeFiller}**.`;
          if (data.missing?.addMissing) userMessage += ` Missing add: **${addUser?.username || addFiller}**.`;
          logSuffix = "❌ Player not found in member list.";
          break;
        case "remove_not_found":
          userMessage = `❌ Could not find **${removeUser?.username || removeFiller}** in Round #${round}.`;
          logSuffix = "❌ Remove target not in round.";
          break;
        case "round_missing":
          userMessage = `❌ Round #${round} not found in sheet.`;
          logSuffix = "❌ Round missing.";
          break;
        default:
          userMessage = `❌ Unexpected error.`;
          logSuffix = `❌ Unexpected GAS response: ${JSON.stringify(data)}`;
          break;
      }

      // --- Edit original reply ---
      if (replyMessage) {
        await replyMessage.edit(userMessage);
        setTimeout(async () => {
          try { await replyMessage.delete(); } catch (err) { console.error(err); }
        }, 8000);
      }

      await logUsage(logSuffix);

    } catch (error) {
      console.error("❌ Error in replace command:", error);

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply('❌ Replacement failed. Please try again.');
      } else {
        await interaction.reply({ content: '❌ Replacement failed. Please try again.', ephemeral: true });
      }

      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};