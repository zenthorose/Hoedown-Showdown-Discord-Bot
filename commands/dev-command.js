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

        // Determine script URL (optional). If provided, post to Apps Script; otherwise try direct Sheets API via service account.
        const scriptUrl = interaction.options.getString('script_url') || config.APP_SCRIPT_URL || config.APS_SCRIPT_URL || config.APPSCRIPT_URL;
        // Build single-line summary
        const parts = [];
        if (userPayload.id) parts.push(`id:${userPayload.id}`);
        if (userPayload.username) parts.push(`username:${userPayload.username}`);
        if (userPayload.discriminator) parts.push(`disc:${userPayload.discriminator}`);
        if (userPayload.tag) parts.push(`tag:${userPayload.tag}`);
        if (userPayload.displayName) parts.push(`display:${userPayload.displayName}`);
        if (userPayload.nick) parts.push(`nick:${userPayload.nick}`);
        if (userPayload.isBot !== undefined) parts.push(`bot:${userPayload.isBot}`);
        if (userPayload.avatarURL) parts.push(`avatar:${userPayload.avatarURL}`);
        if (userPayload.createdAt) parts.push(`created:${userPayload.createdAt}`);
        if (userPayload.joinedAt) parts.push(`joined:${userPayload.joinedAt}`);
        if (userPayload.roles && userPayload.roles.length) parts.push(`roles:${userPayload.roles.join('|')}`);
        const line = parts.join(' | ');

        if (scriptUrl) {
          try {
            const resp = await axios.post(scriptUrl, { command: 'append-discord-user', user: userPayload }, { headers: { 'Content-Type': 'application/json' } });
            if (resp && resp.data) {
              return interaction.editReply(`✅ Appended via Apps Script: ${JSON.stringify(resp.data)}`);
            }
            return interaction.editReply('✅ Posted to Apps Script, no response body.');
          } catch (postErr) {
            console.error('Error posting to Apps Script:', postErr?.response?.data || postErr.message || postErr);
            return interaction.editReply(`❌ Failed to post to Apps Script: ${postErr.message}`);
          }
        }

        // No script URL — try direct Google Sheets API using service account credentials
        const spreadsheetId = config.SPREADSHEET_ID;
        if (!spreadsheetId) return interaction.editReply('❌ No spreadsheet ID configured in `config.SPREADSHEET_ID`.');

        try {
          const { google } = require('googleapis');
          let credentials = null;
          if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
          } else if (config.GOOGLE_SERVICE_ACCOUNT_FILE) {
            const fs = require('fs');
            credentials = JSON.parse(fs.readFileSync(config.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
          } else if (config.GOOGLE_SERVICE_ACCOUNT) {
            credentials = config.GOOGLE_SERVICE_ACCOUNT;
          }

          if (!credentials || !credentials.client_email || !credentials.private_key) {
            return interaction.editReply('❌ No Google service account credentials found. Set `GOOGLE_SERVICE_ACCOUNT_JSON` env or `GOOGLE_SERVICE_ACCOUNT_FILE` in config.');
          }

          const jwtClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
          );

          await jwtClient.authorize();
          const sheets = google.sheets({ version: 'v4', auth: jwtClient });

          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'TEST!A:A',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [[line]] }
          });

          return interaction.editReply(`✅ Appended to spreadsheet (sheet: TEST).`);
        } catch (apiErr) {
          console.error('Sheets API error:', apiErr?.response || apiErr.message || apiErr);
          return interaction.editReply(`❌ Failed to append via Sheets API: ${apiErr.message || apiErr}`);
        }
      }

      return interaction.editReply('❌ Unknown subcommand.');

    } catch (err) {
      console.error('❌ dev-command error:', err);
      return interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};