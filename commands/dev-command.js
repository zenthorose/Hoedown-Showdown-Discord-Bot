const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only: append a mentioned user to the TEST sheet.')
    .addUserOption(opt => opt.setName('target').setDescription('User to append').setRequired(true))
    .addStringOption(opt => opt.setName('script_url').setDescription('Apps Script webapp URL (optional)')),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const guild = interaction.guild;
    if (!guild) return interaction.editReply('❌ This command must be run in a server.');

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
      avatarURL: (typeof targetUser.displayAvatarURL === 'function') ? targetUser.displayAvatarURL() : null,
      createdAt: targetUser.createdAt ? targetUser.createdAt.toISOString() : null,
      displayName: member ? member.displayName : null,
      nick: member ? member.nickname : null,
      joinedAt: member && member.joinedAt ? member.joinedAt.toISOString() : null,
      roles: member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name) : []
    };

    const scriptUrl = interaction.options.getString('script_url') || process.env.Google_Apps_Script_URL || config.APP_SCRIPT_URL || config.APS_SCRIPT_URL || config.APPSCRIPT_URL;
    if (!scriptUrl) return interaction.editReply('❌ No Apps Script URL provided. Pass `script_url` or set `Google_Apps_Script_URL` environment variable.');

    try {
      const resp = await axios.post(scriptUrl, { command: 'append-discord-user', user: userPayload }, { headers: { 'Content-Type': 'application/json' } });
      if (!resp.data || resp.data.error) {
        const errorMsg = resp.data?.error || 'Unknown backend error.';
        return interaction.editReply(`❌ Backend error: ${errorMsg}`);
      }
      return interaction.editReply(`✅ Appended to sheet via Apps Script.`);
    } catch (postErr) {
      console.error('Error posting to Apps Script:', postErr?.response?.data || postErr.message || postErr);
      return interaction.editReply(`❌ Failed to post to Apps Script: ${postErr.message}`);
    }
  },
};