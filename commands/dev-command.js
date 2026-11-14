const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only: hide existing team voice channels from @everyone'),

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
        return interaction.editReply('❌ Bot requires the Manage Channels permission to update channel permissions.');
      }

      const teamChannels = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildVoice && /^Team [A-Z]{1,3}$/.test(channel.name)
      );

      if (teamChannels.size === 0) {
        return interaction.editReply('❌ No existing team voice channels found with names like "Team A" through "Team ZZZ".');
      }

      let updatedCount = 0;
      let failedCount = 0;
      for (const channel of teamChannels.values()) {
        try {
          await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
          updatedCount++;
          console.log(`🔒 Set everyone deny ViewChannel on ${channel.name} (${channel.id})`);
        } catch (permErr) {
          failedCount++;
          console.error(`❌ Failed to set ViewChannel deny on ${channel.name} (${channel.id}):`, permErr);
        }
      }

      const status = failedCount === 0 ? '✅' : updatedCount === 0 ? '❌' : '⚠️';
      const reply = `${status} Set @everyone's View Channel permission to deny on ${updatedCount} of ${teamChannels.size} matching team voice channels.` +
        (failedCount > 0 ? `\n${failedCount} channel(s) failed; see bot logs for details.` : '');
      await interaction.editReply({ content: reply });

    } catch (err) {
      console.error('❌ Error updating team voice channel permissions:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};