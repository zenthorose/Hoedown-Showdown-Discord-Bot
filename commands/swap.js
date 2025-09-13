const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Swap the positions of up to 5 pairs of players in a round.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number')
        .setRequired(true)
    )
    // Swap sets
    .addUserOption(o => o.setName('swap1player1').setDescription('First player in swap 1').setRequired(true))
    .addUserOption(o => o.setName('swap1player2').setDescription('Second player in swap 1').setRequired(true))
    .addUserOption(o => o.setName('swap2player1').setDescription('First player in swap 2').setRequired(false))
    .addUserOption(o => o.setName('swap2player2').setDescription('Second player in swap 2').setRequired(false))
    .addUserOption(o => o.setName('swap3player1').setDescription('First player in swap 3').setRequired(false))
    .addUserOption(o => o.setName('swap3player2').setDescription('Second player in swap 3').setRequired(false))
    .addUserOption(o => o.setName('swap4player1').setDescription('First player in swap 4').setRequired(false))
    .addUserOption(o => o.setName('swap4player2').setDescription('Second player in swap 4').setRequired(false))
    .addUserOption(o => o.setName('swap5player1').setDescription('First player in swap 5').setRequired(false))
    .addUserOption(o => o.setName('swap5player2').setDescription('Second player in swap 5').setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ This command can't be used in DMs.", ephemeral: true });
    }

    const round = interaction.options.getInteger('round');

    // Collect all swap sets dynamically
    const swaps = [];
    for (let i = 1; i <= 5; i++) {
      const p1 = interaction.options.getUser(`swap${i}player1`);
      const p2 = interaction.options.getUser(`swap${i}player2`);
      if (p1 && p2) {
        swaps.push({
          player1: { username: p1.username, id: p1.id },
          player2: { username: p2.username, id: p2.id }
        });
      }
    }

    if (swaps.length === 0) {
      return interaction.reply({ content: "❌ You must provide at least one swap.", ephemeral: true });
    }

    // --- Log helper ---
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/swap** used by **${userTag}** (${userId}) in **#${channelName}** for Round #${round}\n` +
            swaps.map((s, i) => `Swap #${i + 1}: ${s.player1.username} ↔ ${s.player2.username}`).join("\n") +
            (extra ? `\n${extra}` : "")
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // Permission check
      const allowedRoles = config.allowedRoles || [];
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));
      if (!hasRequiredRole) {
        await interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
        await logUsage("⚠️ Permission denied.");
        return;
      }

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

      // ✅ Defer reply to avoid timeout
      await interaction.deferReply({ ephemeral: false });

      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      const { data } = await axios.post(triggerUrl, {
        command: "swap",
        round,
        swaps
      });

      // Build message from GAS response
      let resultMsg = "";
      if (data && Array.isArray(data.results)) {
        resultMsg = data.results.map((r, i) => {
          if (r.success) {
            return `✅ Swap #${i + 1}: **${swaps[i].player1.username}** ↔ **${swaps[i].player2.username}**`;
          } else {
            return `❌ Swap #${i + 1} failed: ${r.error || "Unknown error"}`;
          }
        }).join("\n");
      } else {
        resultMsg = `✅ Swap request sent for Round #${round}.\nPairs: ${swaps.map(s => `**${s.player1.username}** ↔ **${s.player2.username}**`).join(', ')}`;
      }

      await interaction.editReply(resultMsg);

      // Auto-delete reply after 8 seconds
      setTimeout(async () => {
        try { await interaction.deleteReply(); } catch (err) { console.error("Failed to delete reply:", err); }
      }, 8000);

      await logUsage("✅ Swap completed successfully.");

    } catch (err) {
      console.error("❌ Error in swap command:", err);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("❌ Swap request failed.");
      } else {
        await interaction.reply({ content: "❌ Swap request failed.", ephemeral: true });
      }

      await logUsage(`❌ Error: ${err.message}`);
    }
  }
};
