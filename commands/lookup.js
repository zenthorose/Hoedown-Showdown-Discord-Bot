const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Lookup a user\'s Region, Steam Friend Code, and Stream Link')
    .addUserOption(option => option.setName('target').setDescription('The user to look up').setRequired(true)),

  async execute(interaction) {
    const triggerUrl = process.env.Google_Apps_Script_URL;
    const target = interaction.options.getUser('target');

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/lookup** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    if (!triggerUrl) {
      await logUsage("❌ GAS URL missing");
      return await interaction.reply({ content: '❌ Error: Google Apps Script URL is not defined.', flags: MessageFlags.Ephemeral });
    }

    try {
      await interaction.reply({ content: `🔄 Looking up ${target.tag}...`, flags: MessageFlags.Ephemeral });
    } catch {}

    try {
      const response = await axios.post(triggerUrl, {
        command: 'lookup',
        targetId: target.id,
        targetName: target.username
      });

      const data = response.data;

      if (data.error) {
        await logUsage(`❌ Error: ${data.error}`);
        return await safeEdit(interaction, `❌ ${data.error}`);
      }

      const msg = [
        `🔎 Lookup for **${target.tag}**:`,
        `**Region:** ${data.region || 'Not set'}`,
        `**Steam Friend Code:** ${data.steamCode || 'Not set'}`,
        `**Stream Link:** ${data.streamLink || 'Not set'}`
      ].join('\n');

      await safeEdit(interaction, msg);
      await logUsage("✅ Lookup successful");

    } catch (error) {
      console.error("❌ Error in /lookup:", error);
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
