const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Swap the positions of two players in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player1')
        .setDescription('The first player to swap')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2')
        .setDescription('The second player to swap')
        .setRequired(true)),

  async execute(interaction) {
    // --- Block DMs ---
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
    }

    const round = interaction.options.getInteger('round');
    const player1 = interaction.options.getUser('player1');
    const player2 = interaction.options.getUser('player2');

    // --- Log helper ---
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/swap** used by **${userTag}** (${userId}) in **#${channelName}** for Round #${round} | Player1: ${player1.tag}, Player2: ${player2.tag} ${extra}`
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

      console.log(`Received swap command: round=${round}, player1=${player1.tag}, player2=${player2.tag}`);

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
          content: `🔄 Processing swap for Round #${round}...`,
          fetchReply: true
        });
      } catch (err) {
        console.error("Error sending processing reply:", err);
      }

      // --- Send swap data to Google Apps Script ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      await axios.post(triggerUrl, {
        command: "swap",
        round: round,
        player1: { username: player1.username, id: player1.id },
        player2: { username: player2.username, id: player2.id }
      });

      console.log("✅ Swap data sent to Google Apps Script.");

      if (replyMessage) {
        await replyMessage.edit(`✅ Swap completed! Players **${player1.username}** and **${player2.username}** have been swapped in Round #${round}.`);
        setTimeout(async () => {
          try { await replyMessage.delete(); } catch (err) { console.error(err); }
        }, 5000);
      }

      await logUsage("✅ Swap completed successfully.");

    } catch (error) {
      console.error("❌ Error in swap command:", error);

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply('❌ Swap failed. Please try again.');
      } else {
        await interaction.reply({ content: '❌ Swap failed. Please try again.', ephemeral: true });
      }

      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};