const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const axios = require('axios');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info-check')
    .setDescription('See your currently submitted info.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const triggerUrl = process.env.Google_Apps_Script_URL;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/info-check** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    if (!triggerUrl) {
      await logUsage("❌ GAS URL missing");
      return await interaction.reply({
        content: '❌ Error: Google Apps Script URL is not defined.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      await interaction.reply({
        content: '🔄 Fetching your info...',
        flags: MessageFlags.Ephemeral
      });
    } catch {
      // Ignore if already acknowledged
    }

    try {
      const response = await axios.post(triggerUrl, {
        command: 'info-check',
        userId
      });

      const data = response.data;

      if (data.error) {
        await logUsage(`❌ Error: ${data.error}`);
        return await safeEdit(interaction, `❌ ${data.error}`);
      }

      const msg = [
        `✅ Here’s your submitted info:`,
        `**Region:** ${data.region || 'Not set'}`,
        `**Steam Code:** ${data.steamCode || 'Not set'}`,
        `**Stream Link:** ${data.streamLink || 'Not set'}`
      ].join('\n');

      await safeEdit(interaction, msg);
      await logUsage("✅ Info fetched successfully");

    } catch (error) {
      console.error("❌ Error in /info-check:", error);
      await safeEdit(interaction, '⚠️ Error fetching info. Please try again later.');
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
