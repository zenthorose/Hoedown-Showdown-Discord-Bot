const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('past-teams')
    .setDescription('Lookup your past teams for a selected event')
    .addStringOption(option =>
      option.setName('event').setDescription('Choose an event').setRequired(true)
        .addChoices(
          { name: '10/25/2025 Hoedown', value: '10/25/2025 Hoedown' },
          { name: '5/23/2026 Hoedown', value: '5/23/2026 Hoedown' }
        )
    ),

  async execute(interaction) {
    const triggerUrl = process.env.Google_Apps_Script_URL;
    const eventName = interaction.options.getString('event');

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`📝 **/past-teams** used by **${userTag}** (event: **${eventName}**) in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    if (!triggerUrl) {
      await logUsage("❌ GAS URL missing");
      return await interaction.reply({ content: '❌ Error: Google Apps Script URL is not defined.', flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({ content: `🔄 Searching your past teams for **${eventName}**...`, flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      const response = await axios.post(triggerUrl, {
        command: 'past-teams',
        eventSheetName: eventName,
        userId: interaction.user.id
      });

      const data = response.data;
      if (data.error) {
        await logUsage(`❌ Error: ${data.error}`);
        return await safeEdit(interaction, `❌ ${data.error}`);
      }

      if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
        await logUsage('✅ No past teams found');
        return await safeEdit(interaction, `No past teams found for **${eventName}**.`);
      }

      const lines = data.results.map(r => {
        return `**Round #${r.round} — Team ${r.team}**\n${r.members.join('\n')}`;
      });

      const msg = ['Here are your past teams for **${eventName}**:\n'].concat(lines).join('\n\n');

      await safeEdit(interaction, msg);
      await logUsage('✅ past-teams successful');

    } catch (error) {
      console.error('❌ Error in /past-teams:', error);
      await safeEdit(interaction, '⚠️ Error fetching past teams. Please try again later.');
      await logUsage(`❌ Error: ${error.message}`);
    }

    async function safeEdit(interaction, content) {
      try {
        await interaction.editReply({ content });
      } catch {
        try {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } catch {}
      }
    }
  }
};
