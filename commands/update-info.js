const { SlashCommandBuilder } = require('@discordjs/builders');
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-info')
    .setDescription('Update your registration info using a form'),

  async execute(interaction) {
    const member = interaction.member;

    // --- Check Registered role ---
    const registeredRole = interaction.guild.roles.cache.find(r => r.name === 'Registered');
    if (!registeredRole || !member.roles.cache.has(registeredRole.id)) {
      return interaction.reply({
        content: '❌ You must be registered to use this command. Use `/register` first.',
        ephemeral: true
      });
    }

    // --- Log usage ---
    async function logUsage(extra = '') {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || 'DM/Unknown';
          await logChannel.send(`📝 **/update-info** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error('❌ Failed to log usage:', err);
      }
    }

    // --- Show modal ---
    const modal = new ModalBuilder()
      .setCustomId('updateInfoModal')
      .setTitle('Update Your Info');

    // Region select menu
    const regionSelect = new StringSelectMenuBuilder()
      .setCustomId('region')
      .setPlaceholder('Select your region (optional)')
      .addOptions(
        { label: 'East', value: 'East' },
        { label: 'West', value: 'West' },
        { label: 'Both', value: 'Both' }
      );

    const regionRow = new ActionRowBuilder().addComponents(regionSelect);

    // Steam ID input
    const steamInput = new TextInputBuilder()
      .setCustomId('steamid')
      .setLabel('Steam ID (numbers only)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter your Steam ID')
      .setRequired(false);

    const steamRow = new ActionRowBuilder().addComponents(steamInput);

    // Stream link input
    const streamInput = new TextInputBuilder()
      .setCustomId('streamlink')
      .setLabel('Stream Link')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Twitch, Kick, YouTube, or TikTok link')
      .setRequired(false);

    const streamRow = new ActionRowBuilder().addComponents(streamInput);

    modal.addComponents(regionRow, steamRow, streamRow);

    await interaction.showModal(modal);
  }
};

// --- Handle modal submissions ---
module.exports.handleModalSubmit = async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== 'updateInfoModal') return;

  const member = interaction.member;
  const triggerUrl = process.env.Google_Apps_Script_URL;
  if (!triggerUrl) {
    return interaction.reply({ content: '❌ Google Apps Script URL not set.', ephemeral: true });
  }

  // Get values
  const region = interaction.fields.getTextInputValue('region');
  const steamId = interaction.fields.getTextInputValue('steamid');
  const streamLink = interaction.fields.getTextInputValue('streamlink');

  // --- Validate Steam ID ---
  if (steamId && !/^\d+$/.test(steamId)) {
    await logModalUsage(interaction, '❌ Invalid Steam ID');
    return interaction.reply({ content: '❌ Invalid Steam ID. Must only contain numbers.', ephemeral: true });
  }

  // --- Validate stream link ---
  if (streamLink && !/^https?:\/\/(www\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be|tiktok\.com)\/[a-zA-Z0-9_\-/?=&#%.]+$/i.test(streamLink)) {
    await logModalUsage(interaction, '❌ Invalid stream link');
    return interaction.reply({ content: '❌ Invalid stream link. Must be Twitch, Kick, YouTube, or TikTok.', ephemeral: true });
  }

  // --- Update region roles ---
  if (region) {
    const allRegionRoles = ['East', 'West', 'Both'];
    for (const roleName of allRegionRoles) {
      const role = interaction.guild.roles.cache.find(r => r.name === roleName);
      if (role && member.roles.cache.has(role.id)) await member.roles.remove(role);
    }
    const newRole = interaction.guild.roles.cache.find(r => r.name === region);
    if (newRole) await member.roles.add(newRole);
  }

  // --- Prepare updates for Google Sheets ---
  const updates = [];
  if (region) updates.push(['region', region]);
  if (steamId) updates.push(['steamid', steamId]);
  if (streamLink) updates.push(['streamlink', streamLink]);

  try {
    for (const [infoType, newValue] of updates) {
      await axios.post(triggerUrl, {
        command: 'update',
        updateData: [[member.user.id, infoType, newValue]]
      });
    }
    await logModalUsage(interaction, `✅ Updated ${updates.map(u => u[0]).join(', ')}`);
    await interaction.reply({ content: '✅ Your info has been updated!', ephemeral: true });
  } catch (err) {
    console.error(err);
    await logModalUsage(interaction, `❌ Failed update: ${err.message}`);
    await interaction.reply({ content: '❌ Failed to update your info.', ephemeral: true });
  }
};

// --- Logging helper ---
async function logModalUsage(interaction, extra = '') {
  try {
    const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
    if (logChannel) {
      const userTag = interaction.user.tag;
      const userId = interaction.user.id;
      const channelName = interaction.channel?.name || 'DM/Unknown';
      await logChannel.send(`📝 **/update-info modal** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`);
    }
  } catch (err) {
    console.error('❌ Failed to log modal usage:', err);
  }
}
