const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { findMemberProfile } = require('../database/memberListImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Lookup a user\'s Region, Steam Friend Code, and Stream Link')
    .addUserOption(option => option.setName('target').setDescription('The user to look up').setRequired(true)),

  async execute(interaction) {
    const target = interaction.options.getUser('target');

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/lookup** used by **${userTag}** (looked up: **${target.tag}**) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      await interaction.reply({ content: `🔄 Looking up ${target.tag}...`, flags: MessageFlags.Ephemeral });
    } catch {}

    try {
      const database = await connectHoedownInfoDatabase();
      const profile = await findMemberProfile(database, target.id);

      if (!profile) {
        await logUsage('❌ Member profile not found in MongoDB');
        return await safeEdit(interaction, `❌ ${target.tag} was not found in the Members database.`);
      }

      const msg = [
        `🔎 Lookup for **${target.tag}**:`,
        `**Region:** ${profile.region || 'Not set'}`,
        `**Steam Friend Code:** ${profile.steamId || 'Not set'}`,
        `**Stream Link:** ${profile.streamLink || 'Not set'}`
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
