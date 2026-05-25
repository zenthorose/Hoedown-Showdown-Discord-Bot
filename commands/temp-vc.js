const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temp-vc')
    .setDescription('Grant up to 3 users access to a configured voice channel temporarily')
    .addStringOption(opt => opt.setName('vc').setDescription('The VC key or name (from config)').setRequired(true))
    .addUserOption(opt => opt.setName('user1').setDescription('First user to grant'))
    .addUserOption(opt => opt.setName('user2').setDescription('Second user to grant'))
    .addUserOption(opt => opt.setName('user3').setDescription('Third user to grant')),

  async execute(interaction) {
    try {
      await interaction.reply({ content: '🔄 Processing...', flags: MessageFlags.Ephemeral });
    } catch {}

    const hasPermission = await checkPermissions(interaction);
    if (!hasPermission) return interaction.editReply({ content: '❌ You do not have permission to use this command.' });

    const vcKey = interaction.options.getString('vc').trim();
    const users = [
      interaction.options.getUser('user1'),
      interaction.options.getUser('user2'),
      interaction.options.getUser('user3')
    ].filter(Boolean);

    // Try config mappings first (case-insensitive)
    let channelId = null;
    const teamChannels = config.teamChannels || {};
    const roundChannels = config.roundChannels || {};

    const findKeyIgnoreCase = (obj, key) => {
      const lower = String(key).toLowerCase();
      return Object.keys(obj).find(k => k.toLowerCase() === lower);
    };

    let foundKey = findKeyIgnoreCase(teamChannels, vcKey);
    if (foundKey) channelId = teamChannels[foundKey];
    else {
      foundKey = findKeyIgnoreCase(roundChannels, vcKey);
      if (foundKey) channelId = roundChannels[foundKey];
    }

    // If not found in config, try to find a channel by name in the guild
    let channel = null;
    try {
      if (channelId) channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        // Try name match
        const nameLower = vcKey.toLowerCase();
        channel = interaction.guild.channels.cache.find(ch => ch.name?.toLowerCase() === nameLower) || null;
      }
    } catch (err) {
      console.error('❌ Error fetching channel for /temp-vc:', err);
    }

    if (!channel) return interaction.editReply({ content: `❌ Voice channel not found for "${vcKey}".` });

    // Grant permissions similar to approved-round (View, Send, Read, Connect, Speak)
    const perms = {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      Connect: true,
      Speak: true,
    };

    const granted = [];
    for (const u of users) {
      try {
        await channel.permissionOverwrites.edit(u.id, perms);
        granted.push(u.tag);
      } catch (err) {
        console.error(`❌ Failed to set perms for ${u.tag} on ${channel.id}:`, err);
      }
    }

    // Log to configured log channel
    try {
      const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
      if (logChannel) {
        await logChannel.send(`📝 **/temp-vc** used by **${interaction.user.tag}** -> VC: **${channel.name}** (${channel.id}) | Granted: ${granted.length ? granted.join(', ') : 'None'}`);
      }
    } catch (err) {
      console.error('❌ Failed to send /temp-vc log:', err);
    }

    return interaction.editReply({ content: `✅ Granted access to ${granted.length} user(s) on **${channel.name}**.` });
  }
};
