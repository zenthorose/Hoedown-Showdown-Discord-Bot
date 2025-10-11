const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissions } = require('../permissions'); 
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send or update a bot message with embed, optional images, role mentions, and txt content.')
    .setDefaultMemberPermissions(0) // Manage Messages

    // Optional main options
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The embed description (optional)'))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Choose an embed color (optional)')
        .addChoices(
          { name: 'Red', value: 'Red' },
          { name: 'Blue', value: 'Blue' },
          { name: 'Green', value: 'Green' },
          { name: 'Yellow', value: 'Yellow' },
          { name: 'Purple', value: 'Purple' },
          { name: 'Orange', value: 'Orange' },
          { name: 'Gray', value: 'Gray' }
        ))

    // Optional other options
    .addStringOption(option =>
      option.setName('roles')
        .setDescription('Optional role mentions, comma-separated (e.g., @Mods,@Raiders)'))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Optional embed title'))
    .addStringOption(option =>
      option.setName('channelid')
        .setDescription('Optional target channel ID (defaults to current channel)'))
    .addStringOption(option =>
      option.setName('messageid')
        .setDescription('Optional message ID to edit'))

    // Confirmation required
    .addStringOption(option =>
      option.setName('confirm')
        .setDescription('Type "SEND" exactly to confirm sending this message')
        .setRequired(true))

    // Allow up to 10 image attachments
    .addAttachmentOption(option => option.setName('image1').setDescription('Image 1'))
    .addAttachmentOption(option => option.setName('image2').setDescription('Image 2'))
    .addAttachmentOption(option => option.setName('image3').setDescription('Image 3'))
    .addAttachmentOption(option => option.setName('image4').setDescription('Image 4'))
    .addAttachmentOption(option => option.setName('image5').setDescription('Image 5'))
    .addAttachmentOption(option => option.setName('image6').setDescription('Image 6'))
    .addAttachmentOption(option => option.setName('image7').setDescription('Image 7'))
    .addAttachmentOption(option => option.setName('image8').setDescription('Image 8'))
    .addAttachmentOption(option => option.setName('image9').setDescription('Image 9'))
    .addAttachmentOption(option => option.setName('image10').setDescription('Image 10'))

    // Optional txt file
    .addAttachmentOption(option => option.setName('txtfile').setDescription('Optional .txt file to include')),

  async execute(interaction) {
    console.log(`[message] Command triggered by ${interaction.user.tag}`);

    if (!(await checkPermissions(interaction))) {
      return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
    }

    // --- Confirm phrase ---
    const confirmText = interaction.options.getString('confirm');
    if (!confirmText || confirmText.trim().toUpperCase() !== 'SEND') {
      return interaction.reply({
        content: '❌ You must type "SEND" exactly to send this message!',
        ephemeral: true
      });
    }

    // --- Gather options ---
    let description = interaction.options.getString('description') || '';
    const colorChoice = interaction.options.getString('color') || 'Gray';
    const rolesInput = interaction.options.getString('roles') || '';
    const title = interaction.options.getString('title') || '';
    const channelId = interaction.options.getString('channelid') || '';
    const messageId = interaction.options.getString('messageid') || '';

    const colorMap = {
      Red: '#FF0000',
      Blue: '#0000FF',
      Green: '#00FF00',
      Yellow: '#FFFF00',
      Purple: '#800080',
      Orange: '#FFA500',
      Gray: '#808080'
    };
    const embedColor = colorMap[colorChoice] || '#808080';

    const targetChannel = channelId
      ? await interaction.client.channels.fetch(channelId).catch(() => null)
      : interaction.channel;
    if (!targetChannel)
      return interaction.reply({ content: '❌ Invalid channel ID.', ephemeral: true });

    // --- Append txt file if provided ---
    const txtAttachment = interaction.options.getAttachment('txtfile');
    if (txtAttachment && txtAttachment.contentType === 'text/plain') {
      try {
        const res = await fetch(txtAttachment.url);
        const txtContent = await res.text();
        description = description ? `${description}\n\n${txtContent}` : txtContent;
      } catch (err) {
        console.error('❌ Failed to fetch .txt file:', err);
        return interaction.reply({ content: '❌ Failed to read the uploaded .txt file.', ephemeral: true });
      }
    }

    // --- Build main embed ---
    const mainEmbed = new EmbedBuilder()
      .setDescription(description)
      .setColor(embedColor)
      .setTimestamp();
    if (title) mainEmbed.setTitle(title);

    // --- Build image embeds ---
    const imageEmbeds = [];
    for (let i = 1; i <= 10; i++) {
      const image = interaction.options.getAttachment(`image${i}`);
      if (image) {
        const imgEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle(`Image ${i}`)
          .setImage(image.url);
        imageEmbeds.push(imgEmbed);
      }
    }

    // --- Build role mentions ---
    let content = '';
    if (rolesInput) {
      content = rolesInput.split(',')
        .map(r => r.trim())
        .filter(r => r.length)
        .join(' ');
    }

    const allEmbeds = [mainEmbed, ...imageEmbeds];

    // --- Send or edit ---
    let targetMessage = null;
    if (messageId) {
      targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
      if (!targetMessage)
        return interaction.reply({ content: '❌ Message not found.', ephemeral: true });
      if (!targetMessage.editable)
        return interaction.reply({ content: "❌ I can't edit this message.", ephemeral: true });

      await targetMessage.edit({ content, embeds: allEmbeds });
      console.log(`[message] Edited message ${targetMessage.id}`);
    } else {
      const sent = await targetChannel.send({ content, embeds: allEmbeds });
      console.log(`[message] Sent new message ${sent.id}`);
    }

    await interaction.reply({ content: '✅ Message processed successfully!', ephemeral: true });
  }
};
