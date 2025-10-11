const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch'); // make sure node-fetch is installed
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a message with the contents of an uploaded .txt file.')
    .setDefaultMemberPermissions(0) // Manage Messages
    .addAttachmentOption(option =>
      option.setName('txtfile')
        .setDescription('Upload a .txt file to post')
        .setRequired(true)),

  async execute(interaction) {
    console.log(`[message] Command triggered by ${interaction.user.tag}`);

    if (!(await checkPermissions(interaction))) {
      return interaction.reply({ content: '❌ You do not have permission to use this command!', ephemeral: true });
    }

    const txtAttachment = interaction.options.getAttachment('txtfile');

    if (!txtAttachment || txtAttachment.contentType !== 'text/plain') {
      return interaction.reply({ content: '❌ Please upload a valid .txt file.', ephemeral: true });
    }

    let description = '';
    try {
      const res = await fetch(txtAttachment.url);
      description = await res.text();
    } catch (err) {
      console.error('❌ Failed to fetch .txt file:', err);
      return interaction.reply({ content: '❌ Failed to read the uploaded .txt file.', ephemeral: true });
    }

    // Ensure description is never empty (Discord requires at least title or description)
    if (!description) description = '\u200B';

    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor('#808080') // default gray
      .setTimestamp();

    try {
      await interaction.channel.send({ embeds: [embed] });
      console.log(`[message] Posted message from .txt file by ${interaction.user.tag}`);
      return interaction.reply({ content: '✅ Message sent successfully!', ephemeral: true });
    } catch (err) {
      console.error('❌ Failed to send message:', err);
      return interaction.reply({ content: '❌ Failed to send message.', ephemeral: true });
    }
  }
};
