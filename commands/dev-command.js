const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-perms')
    .setDescription('Enable or disable all permissions for @everyone on a channel.')
    .addStringOption(opt =>
      opt.setName('channel_id')
        .setDescription('ID of the channel to modify permissions')
        .setRequired(true))
    .addBooleanOption(opt =>
      opt.setName('enable')
        .setDescription('Set permissions ON (true) or OFF (false)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Permission check
    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const channelId = interaction.options.getString('channel_id');
    const enable = interaction.options.getBoolean('enable');

    try {
      const guild = interaction.guild;
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return interaction.editReply(`❌ Channel ID ${channelId} not found.`);

      const everyoneRole = guild.roles.everyone;

      // Set all available permissions
      const allPerms = Object.values(PermissionsBitField.Flags);
      const permOverwrite = {};
      for (const perm of allPerms) {
        permOverwrite[perm] = enable;
      }

      await channel.permissionOverwrites.edit(everyoneRole, permOverwrite);
      await interaction.editReply(`✅ Permissions for @everyone in <#${channelId}> have been ${enable ? 'enabled' : 'disabled'}.`);

    } catch (err) {
      console.error('❌ Error setting permissions:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};
