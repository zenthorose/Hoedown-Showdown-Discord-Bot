const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissions } = require('../permissions'); // Permissions check function
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send or update a bot message with embed and optional ping.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages

    // Required options first
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The embed description')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Choose an embed color')
        .setRequired(true)
        .addChoices(
          { name: 'Red', value: 'Red' },
          { name: 'Blue', value: 'Blue' },
          { name: 'Green', value: 'Green' },
          { name: 'Yellow', value: 'Yellow' },
          { name: 'Purple', value: 'Purple' },
          { name: 'Orange', value: 'Orange' },
          { name: 'Gray', value: 'Gray' }
        ))
    .addStringOption(option =>
      option.setName('pingeveryone')
        .setDescription('Should I @everyone outside the embed?')
        .setRequired(true)
        .addChoices(
          { name: 'Yes', value: 'yes' },
          { name: 'No', value: 'no' }
        ))

    // Optional options last
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Optional embed title')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('channelid')
        .setDescription('Optional target channel ID (defaults to current channel)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('messageid')
        .setDescription('Optional message ID to edit (defaults to last bot message in the channel)')
        .setRequired(false)),

  async execute(interaction) {
    console.log(`[message] Command triggered by ${interaction.user.tag}`);

    // Check permissions
    const hasPermission = await checkPermissions(interaction);
    if (!hasPermission) {
      console.log(`[message] Permission denied for ${interaction.user.tag}`);
      return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
    }

    // Fetch options
    const description = interaction.options.getString('description');
    const colorChoice = interaction.options.getString('color');
    const pingEveryone = interaction.options.getString('pingeveryone');
    const title = interaction.options.getString('title');
    const channelId = interaction.options.getString('channelid');
    const messageId = interaction.options.getString('messageid');

    console.log(`[message] Options received: channelId=${channelId}, messageId=${messageId}, title=${title}, color=${colorChoice}, pingEveryone=${pingEveryone}`);

    // Color map
    const colorMap = {
      Red: '#FF0000',
      Blue: '#0000FF',
      Green: '#00FF00',
      Yellow: '#FFFF00',
      Purple: '#800080',
      Orange: '#FFA500',
      Gray: '#808080'
    };
    const embedColor = colorMap[colorChoice] || '#444444';

    // Determine target channel
    const targetChannel = channelId
      ? await interaction.client.channels.fetch(channelId).catch(() => null)
      : interaction.channel;

    if (!targetChannel) return interaction.reply({ content: 'Invalid channel ID.', ephemeral: true });

    let targetMessage;

    if (messageId) {
      // Fetch specific message
      targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
      if (!targetMessage) return interaction.reply({ content: 'Message not found.', ephemeral: true });
      if (!targetMessage.editable) return interaction.reply({ content: "I can't edit this message.", ephemeral: true });
    } else {
      // Fetch last bot message
      const messages = await targetChannel.messages.fetch({ limit: 50 });
      targetMessage = messages.filter(m => m.author.id === interaction.client.user.id).first();
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor(embedColor)
      .setTimestamp();

    if (title) embed.setTitle(title);

    // Content for ping
    const content = pingEveryone === 'yes' ? '@everyone' : '';

    // Edit or send message
    if (targetMessage) {
      await targetMessage.edit({ content, embeds: [embed] });
      console.log(`[message] Edited message ${targetMessage.id} in ${targetChannel.id}`);
    } else {
      await targetChannel.send({ content, embeds: [embed] });
      console.log(`[message] Sent new message in ${targetChannel.id}`);
    }

    await interaction.reply({ content: '✅ Message processed successfully!', ephemeral: true });

    // Logging to log channel
    try {
      const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
      if (logChannel) {
        const action = targetMessage ? 'edited' : 'sent';
        await logChannel.send(`📝 **/message** used by **${interaction.user.tag}**: ${action} in <#${targetChannel.id}>${targetMessage ? ` (Message ID: ${targetMessage.id})` : ''}`);
      }
    } catch (err) {
      console.error('❌ Failed to log message usage:', err);
    }
  }
};
