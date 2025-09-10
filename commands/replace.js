const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replace')
    .setDescription('Replace a player in a round.')
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('removeplayer')
        .setDescription('The player to be removed')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('addplayer')
        .setDescription('The player to be added')
        .setRequired(true)),

  async execute(interaction) {
    // --- Block DMs ---
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
    }

    const round = interaction.options.getInteger('round');
    const removeUser = interaction.options.getUser('removeplayer');
    const addUser = interaction.options.getUser('addplayer');

    // --- Log helper ---
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/replace** used by **${userTag}** (${userId}) in **#${channelName}** for Round #${round} | Removed: ${removeUser.tag}, Added: ${addUser.tag} ${extra}`
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

      console.log(`Received replace command: round=${round}, remove=${removeUser.tag}, add=${addUser.tag}`);

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

      await axios.post(triggerUrl, {
        command: "replace",
        round: round,
        removePlayer: { username: removeUser.username, id: removeUser.id },
        addPlayer: { username: addUser.username, id: addUser.id }
      });

      console.log("✅ Replacement data sent to Google Apps Script.");

      if (replyMessage) {
        await replyMessage.edit(`✅ Replacement completed! Player **${removeUser.username}** has been replaced with **${addUser.username}** in Round #${round}.`);
        setTimeout(async () => {
          try { await replyMessage.delete(); } catch (err) { console.error(err); }
        }, 5000);
      }

      await logUsage("✅ Replacement completed successfully.");

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
