const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Swap the positions of up to 5 player pairs in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true))
    // --- First swap set (required) ---
    .addUserOption(option =>
      option.setName('player1a')
        .setDescription('First player of swap #1')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('player2a')
        .setDescription('Second player of swap #1')
        .setRequired(true))
    // --- Extra swap sets (optional) ---
    .addUserOption(option =>
      option.setName('player1b').setDescription('First player of swap #2'))
    .addUserOption(option =>
      option.setName('player2b').setDescription('Second player of swap #2'))
    .addUserOption(option =>
      option.setName('player1c').setDescription('First player of swap #3'))
    .addUserOption(option =>
      option.setName('player2c').setDescription('Second player of swap #3'))
    .addUserOption(option =>
      option.setName('player1d').setDescription('First player of swap #4'))
    .addUserOption(option =>
      option.setName('player2d').setDescription('Second player of swap #4'))
    .addUserOption(option =>
      option.setName('player1e').setDescription('First player of swap #5'))
    .addUserOption(option =>
      option.setName('player2e').setDescription('Second player of swap #5')),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
    }

    const round = interaction.options.getInteger('round');

    // --- Build swaps array ---
    const swapPairs = ['a', 'b', 'c', 'd', 'e'];
    const swaps = [];

    for (const suffix of swapPairs) {
      const p1 = interaction.options.getUser(`player1${suffix}`);
      const p2 = interaction.options.getUser(`player2${suffix}`);
      if (p1 && p2) {
        swaps.push({
          player1: { username: p1.username, id: p1.id },
          player2: { username: p2.username, id: p2.id }
        });
      }
    }

    if (swaps.length === 0) {
      return interaction.reply({ content: "❌ You must specify at least one swap pair.", ephemeral: true });
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/swap** by **${userTag}** (${userId}) in **#${channelName}** for Round #${round}\n` +
            `Swaps: ${swaps.map(s => `${s.player1.username} ↔ ${s.player2.username}`).join(", ")}\n${extra}`
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

      console.log(`Received swap command: round=${round}, swaps=${JSON.stringify(swaps)}`);

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

      // --- Initial Reply ---
      let replyMessage = await interaction.reply({
        content: `🔄 Processing ${swaps.length} swap(s) for Round #${round}...`,
        fetchReply: true
      });

      // --- Send swap data to GAS ---
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const payload = { command: "swap", round, swaps };
      console.log("📤 Sending payload to GAS:", JSON.stringify(payload, null, 2));

      const response = await axios.post(triggerUrl, payload);
      console.log("✅ GAS response:", response.data);

      if (!response.data.success) {
        await replyMessage.edit("❌ Swap request failed.");
        await logUsage("❌ GAS returned failure.");
        return;
      }

      const results = response.data.results || [];
      let successCount = results.filter(r => r.status === "ok").length;
      let failCount = results.filter(r => r.status !== "ok").length;

      const details = results.map((r, i) =>
        `**${i + 1}.** ${r.pair[0]} ↔ ${r.pair[1]} → ${r.status === "ok" ? "✅ Success" : `❌ Failed (${r.reason || "unknown"})`}`
      ).join("\n");

      const finalMessage = `📋 Swap results for Round #${round}:\n${details}\n\n✅ ${successCount} succeeded | ❌ ${failCount} failed`;

      await replyMessage.edit(finalMessage);
      await logUsage(`✅ ${successCount} success | ❌ ${failCount} failed`);

      // Optionally auto-delete after 15s
      setTimeout(async () => {
        try { await replyMessage.delete(); } catch {}
      }, 15000);

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
