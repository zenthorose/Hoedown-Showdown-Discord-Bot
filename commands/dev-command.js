const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only utilities (status, list-channels).')
    .addSubcommand(sub => sub.setName('status').setDescription('Show bot/guild status.'))
    .addSubcommand(sub => sub
      .setName('list-channels')
      .setDescription('List voice channels under a category.')
      .addStringOption(opt => opt.setName('category').setDescription('Category name').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('sheet-append')
      .setDescription('Append a mentioned user to the TEST sheet via Apps Script.')
      .addUserOption(opt => opt.setName('target').setDescription('User to append').setRequired(true))
      .addStringOption(opt => opt.setName('script_url').setDescription('Apps Script webapp URL (optional)'))),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const guild = interaction.guild;
    if (!guild) return interaction.editReply('❌ This command must be run in a server.');

    const me = guild.members.me;
    const axios = require('axios');

    try {
      const sub = interaction.options.getSubcommand();

      if (sub === 'status') {
        const perms = me.permissions ? Object.keys(PermissionsBitField.Flags).filter(k => me.permissions.has(PermissionsBitField.Flags[k])) : [];
        const reply = `✅ Bot: ${me.user?.tag || me.id}\n` +
          `🏷️ Guild: ${guild.name} (${guild.id})\n` +
          `🧾 Permissions: ${perms.length ? perms.join(', ') : 'None'}`;
        return interaction.editReply({ content: reply });
      }

      if (sub === 'list-channels') {
        const catName = interaction.options.getString('category') || 'Voice Channels Teams AAA-ZZZ';
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catName);
        if (!category) return interaction.editReply(`❌ Category not found: ${catName}`);

        const voiceChannels = guild.channels.cache
          .filter(ch => ch.parentId === category.id && ch.type === ChannelType.GuildVoice)
          .map(ch => `${ch.name} — ${ch.id}`);

        const content = voiceChannels.length ? voiceChannels.join('\n') : 'No voice channels found under that category.';
        return interaction.editReply({ content: `**Channels under ${catName}:**\n${content}` });
      }

      if (sub === 'sheet-append') {
        const targetUser = interaction.options.getUser('target');
        if (!targetUser) return interaction.editReply('❌ No target user provided.');

        // Try to fetch guild member to get joinedAt, nickname, roles
        let member = null;
        try { member = await guild.members.fetch(targetUser.id); } catch (e) { /* ignore */ }

        const userPayload = {
          id: targetUser.id,
          username: targetUser.username,
          discriminator: targetUser.discriminator,
          tag: targetUser.tag,
          isBot: targetUser.bot,
          avatarURL: targetUser.displayAvatarURL ? targetUser.displayAvatarURL() : null,
          createdAt: targetUser.createdAt ? targetUser.createdAt.toISOString() : null,
          displayName: member ? member.displayName : null,
          nick: member ? member.nickname : null,
          joinedAt: member && member.joinedAt ? member.joinedAt.toISOString() : null,
          roles: member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name) : []
        };

        // Determine script URL
        const scriptUrl = interaction.options.getString('script_url') || config.APP_SCRIPT_URL || config.APS_SCRIPT_URL || config.APPSCRIPT_URL;
        if (!scriptUrl) return interaction.editReply('❌ No Apps Script URL provided and none set in config (option `script_url` or `APP_SCRIPT_URL`).');

        try {
          const resp = await axios.post(scriptUrl, { command: 'append-discord-user', user: userPayload }, { headers: { 'Content-Type': 'application/json' } });
          if (resp && resp.data) {
            return interaction.editReply(`✅ Appended to sheet: ${JSON.stringify(resp.data)}`);
          }
          return interaction.editReply('✅ Posted to script, no response body.');
        } catch (postErr) {
          console.error('Error posting to Apps Script:', postErr?.response?.data || postErr.message || postErr);
          return interaction.editReply(`❌ Failed to post to Apps Script: ${postErr.message}`);
        }
      }

      return interaction.editReply('❌ Unknown subcommand.');

    } catch (err) {
      console.error('❌ dev-command error:', err);
      return interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};