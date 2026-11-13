const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');

async function runSpreadsheetAccessTest(interaction) {
  const triggerUrl = process.env.Google_Apps_Script_URL;
  if (!triggerUrl) {
    return interaction.editReply('❌ Google Apps Script URL is not defined.');
  }

  const requestId = interaction.id;
  const attempts = 10;
  const startedAt = Date.now();
  let phase = 'POST to Apps Script';

  try {
    console.info('🔎 /dev-command spreadsheet test started:', { requestId, attempts });

    const postResponse = await axios.post(
      triggerUrl,
      { command: 'spreadsheet-test', attempts, requestId },
      {
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 400
      }
    );
    let response = postResponse;

    console.info('🔎 Spreadsheet test POST response:', {
      requestId,
      status: postResponse.status,
      elapsedMs: Date.now() - startedAt,
      redirectHost: postResponse.headers.location
        ? new URL(postResponse.headers.location, triggerUrl).hostname
        : undefined
    });

    if (postResponse.status >= 300 && postResponse.status < 400) {
      const location = postResponse.headers.location;
      if (!location) throw new Error('Apps Script redirect did not include a Location header.');

      const redirectUrl = new URL(location, triggerUrl);
      if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== 'script.googleusercontent.com') {
        throw new Error(`Unexpected Apps Script redirect host: ${redirectUrl.hostname}`);
      }

      phase = 'fetch redirected Apps Script response';
      const redirectStartedAt = Date.now();
      response = await axios.get(redirectUrl.toString(), {
        timeout: 30000,
        maxRedirects: 0
      });

      console.info('🔎 Spreadsheet test redirect response:', {
        requestId,
        status: response.status,
        host: redirectUrl.hostname,
        elapsedMs: Date.now() - redirectStartedAt
      });
    }

    phase = 'validate Apps Script response';
    const result = response.data;

    if (!result || !Array.isArray(result.results)) {
      const keys = result && typeof result === 'object' ? Object.keys(result) : [];
      throw new Error(`Unexpected response shape; received keys: ${keys.join(', ') || typeof result}.`);
    }
    if (result.requestId !== requestId) {
      throw new Error('Response request ID did not match this test.');
    }

    const details = result.results.map(attempt => {
      if (attempt.success) {
        return `#${attempt.attempt} PASS — ${attempt.elapsedMs} ms, rows: ${attempt.lastRow}`;
      }

      const error = String(attempt.error || 'Unknown spreadsheet error').replace(/\s+/g, ' ').slice(0, 100);
      return `#${attempt.attempt} FAIL — ${attempt.elapsedMs} ms: ${error}`;
    });

    const summary =
      `Spreadsheet access test (${result.version ? `GAS v${result.version}, ` : ''}` +
      `${result.successes}/${result.attempts} passed, ${result.elapsedMs} ms total):`;

    await interaction.editReply(`Request ID: ${requestId}\n${summary}\n${details.join('\n')}`);
  } catch (error) {
    console.error('❌ /dev-command spreadsheet test failed:', {
      requestId,
      phase,
      elapsedMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      status: error.response ? error.response.status : undefined,
      responseKeys: error.response && error.response.data && typeof error.response.data === 'object'
        ? Object.keys(error.response.data)
        : undefined
    });

    await interaction.editReply(`❌ Spreadsheet test failed during ${phase}. Request ID: ${requestId}. Check the bot and Apps Script logs.`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only diagnostic and setup tools.')
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Choose a task (defaults to voice-channel setup).')
        .addChoices(
          { name: 'Test spreadsheet access', value: 'spreadsheet-test' },
          { name: 'Create/fetch team voice channels', value: 'voice-channels' }
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    try {
      const action = interaction.options.getString('action');
      if (action === 'spreadsheet-test') {
        return await runSpreadsheetAccessTest(interaction);
      }

      const guild = interaction.guild;
      if (!guild) return interaction.editReply('❌ This command must be run in a server.');

      const me = guild.members.me;
      if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply('❌ Bot requires the Manage Channels permission to create channels.');
      }

      const categoryName = 'Voice Channels Teams AAA-ZZZ';

      // Find or create the category
      let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === categoryName);
      if (!category) {
        category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: 'Creating team voice category' });
      }

      const mapping = {};

      // Create/fetch channels AAA..ZZZ (same-letter triplets)
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const label = letter.repeat(3); // e.g., 'AAA'
        const channelName = `Team ${label}`;

        // Try to find existing channel under the category
        let channel = guild.channels.cache.find(ch => ch.parentId === category.id && ch.name === channelName && ch.type === ChannelType.GuildVoice);

        if (!channel) {
          // Create voice channel
          channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildVoice, parent: category.id, reason: 'Creating team voice channel' });
        }

        mapping[channelName] = channel.id;
      }

      const jsonMapping = JSON.stringify(mapping, null, 2);

      // Apply @everyone permission overwrites: deny view and connect on each VC
      for (const [teamKey, channelId] of Object.entries(mapping)) {
        try {
          const ch = await guild.channels.fetch(channelId);
          if (ch && ch.type === ChannelType.GuildVoice) {
            await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
            console.log(`🔒 Set everyone deny ViewChannel on ${teamKey} (${channelId})`);
          }
        } catch (permErr) {
          console.error(`❌ Failed to set overwrites for ${teamKey} (${channelId}):`, permErr);
        }
      }

      const reply = `✅ Created/found channels under category **${categoryName}**.\n\n` +
        'Copy the following JSON into your `teamChannels` in config.json:\n\n' +
        '```json\n' + jsonMapping + '\n```';

      await interaction.editReply({ content: reply });

    } catch (err) {
      console.error('❌ Error creating/fetching team voice channels:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};