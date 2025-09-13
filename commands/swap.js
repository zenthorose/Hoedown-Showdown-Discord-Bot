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
    // --- Swap #1 (required) ---
    .addUserOption(option =>
      option.setName('swap1player1')
        .setDescription('First player in swap 1')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('swap1player2')
        .setDescription('Second player in swap 1')
        .setRequired(true)
    )
    // --- Swap #2 (optional) ---
    .addUserOption(option =>
      option.setName('swap2player1')
        .setDescription('First player in swap 2')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('swap2player2')
        .setDescription('Second player in swap 2')
        .setRequired(false)
    )
    // --- Swap #3 (optional) ---
    .addUserOption(option =>
      option.setName('swap3player1')
        .setDescription('First player in swap 3')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('swap3player2')
        .setDescription('Second player in swap 3')
        .setRequired(false)
    )
    // --- Swap #4 (optional) ---
    .addUserOption(option =>
      option.setName('swap4player1')
        .setDescription('First player in swap 4')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('swap4player2')
        .setDescription('Second player in swap 4')
        .setRequired(false)
    )
    // --- Swap #5 (optional) ---
    .addUserOption(option =>
      option.setName('swap5player1')
        .setDescription('First player in swap 5')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('swap5player2')
        .setDescription('Second player in swap 5')
        .setRequired(false)
    ),

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

    // Permission check
    const allowedRoles = config.allowedRoles || [];
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));
    if (!hasRequiredRole) {
      return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
    }

    // Send to GAS
    try {
      const triggerUrl = process.env.Google_Apps_Script_URL;
      if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

      await axios.post(triggerUrl, {
        command: "swap",
        round,
        swaps
      });

      await interaction.reply(
        `✅ Swap request sent for Round #${round}.\nPairs: ${swaps.map(s => `**${s.player1.username}** ↔ **${s.player2.username}**`).join(', ')}`
      );

    } catch (err) {
      console.error("❌ Error sending swap request:", err);
      await interaction.reply({ content: "❌ Swap request failed.", ephemeral: true });
    }
  }
};
