const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a new embed or update an existing one.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission

    // --- SEND SUBCOMMAND ---
    .addSubcommand(sub =>
      sub
        .setName('send')
        .setDescription('Send a new embed to a channel')
        .addStringOption(option =>
          option.setName('channelid')
            .setDescription('The ID of the channel to send the message to')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('title')
            .setDescription('The title of the embed')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('The description of the embed')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('color')
            .setDescription('Hex color (e.g. #ff0000)')
            .setRequired(false))
    )

    // --- EDIT SUBCOMMAND ---
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edit an existing embed sent by the bot')
        .addStringOption(option =>
          option.setName('channelid')
            .setDescription('The ID of the channel containing the message')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('messageid')
            .setDescription('The ID of the message to edit')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('title')
            .setDescription('New title for the embed')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('New description for the embed')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('color')
            .setDescription('Hex color (e.g. #00ff00)')
            .setRequired(false))
    ),

  async execute(interaction) {
    // --- Permission check ---
    const permResult = await checkPermissions(interaction);
    if (typeof permResult === 'string') {
      return interaction.reply({ content: permResult, ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'send') {
      const channelId = interaction.options.getString('channelid');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color') || '#444444';

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: '❌ Invalid channel ID.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      return interaction.reply({ content: '✅ Embed sent successfully!', ephemeral: true });
    }

    if (subcommand === 'edit') {
      const channelId = interaction.options.getString('channelid');
      const messageId = interaction.options.getString('messageid');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color') || '#444444';

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: '❌ Invalid channel ID.', ephemeral: true });
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        return interaction.reply({ content: '❌ Message not found.', ephemeral: true });
      }

      if (!message.editable) {
        return interaction.reply({ content: "❌ I can't edit this message.", ephemeral: true });
      }

      const newEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      await message.edit({ embeds: [newEmbed] });
      return interaction.reply({ content: '✅ Message updated successfully!', ephemeral: true });
    }
  }
};
