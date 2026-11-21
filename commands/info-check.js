const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { findMemberProfile } = require('../database/memberListImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info-check')
    .setDescription('See your currently submitted info.'),

  async execute(interaction) {
    const userId = interaction.user.id;

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

    try {
      await interaction.reply({
        content: '🔄 Fetching your info...',
        flags: MessageFlags.Ephemeral
      });
    } catch {
      // Ignore if already acknowledged
    }

    try {
      const database = await connectHoedownInfoDatabase();
      const profile = await findMemberProfile(database, userId);

      if (!profile) {
        await logUsage('❌ Member profile not found in MongoDB');
        return await safeEdit(interaction, '❌ User not found in the Members database.');
      }

      const msg = [
        `✅ Here’s your submitted info:`,
        `**Region:** ${profile.region || 'Not set'}`,
        `**Steam Friend Code:** ${profile.steamId || 'Not set'}`,
        `**Stream Link:** ${profile.streamLink || 'Not set'}`
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