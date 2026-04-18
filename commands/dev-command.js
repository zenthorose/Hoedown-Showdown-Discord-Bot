const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only: create/fetch team voice channels AAA..ZZZ and output mapping'),

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
            console.log(`🔒 Set @everyone deny ViewChannel on ${teamKey} (${channelId})`);
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