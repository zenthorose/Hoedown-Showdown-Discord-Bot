const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 for LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-message')
    .setDescription('Send or update an embed message.')

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
            .setDescription('Choose a color for the embed')
            .setRequired(false)
            .addChoices(
              { name: 'Red', value: '#ff0000' },
              { name: 'Blue', value: '#0000ff' },
              { name: 'Green', value: '#00ff00' },
              { name: 'Yellow', value: '#ffff00' },
              { name: 'Purple', value: '#800080' },
              { name: 'Gray', value: '#808080' }
            ))
        .addStringOption(option =>
          option.setName('ping')
            .setDescription('Ping everyone?')
            .setRequired(false)
            .addChoices(
              { name: 'Yes', value: 'yes' },
              { name: 'No', value: 'no' }
            ))
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
            .setDescription('Choose a color for the embed')
            .setRequired(false)
            .addChoices(
              { name: 'Red', value: '#ff0000' },
              { name: 'Blue', value: '#0000ff' },
              { name: 'Green', value: '#00ff00' },
              { name: 'Yellow', value: '#ffff00' },
              { name: 'Purple', value: '#800080' },
              { name: 'Gray', value: '#808080' }
            ))
    ),

  async execute(interaction) {
    // --- Helper: log usage ---
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/update-message** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    // --- Permission check ---
    const permResult = await checkPermissions(interaction);
    if (typeof permResult === 'string') {
      await logUsage(`❌ Permission denied (${permResult})`);
      return interaction.reply({ content: permResult, ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'send') {
      const channelId = interaction.options.getString('channelid');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color') || '#444444';
      const ping = interaction.options.getString('ping') || 'no';

      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        await logUsage("❌ Invalid channel ID on send.");
        return interaction.reply({ content: '❌ Invalid channel ID.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      const content = ping === 'yes' ? '@everyone' : null;

      await channel.send({ content, embeds: [embed] });
      await l
