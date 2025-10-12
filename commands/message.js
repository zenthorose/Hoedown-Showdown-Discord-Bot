const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch'); // make sure node-fetch is installed
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Post the contents of an uploaded .txt file directly into the channel.')
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

    // Check that the file is a .txt
    if (!txtAttachment || !txtAttachment.name.toLowerCase().endsWith('.txt')) {
      return interaction.reply({ content: '❌ Please upload a valid .txt file.', ephemeral: true });
    }

    let fileContent = '';
    try {
      const res = await fetch(txtAttachment.url);
      fileContent = await res.text();
    } catch (err) {
      console.error('❌ Failed to fetch .txt file:', err);
      return interaction.reply({ content: '❌ Failed to read the uploaded .txt file.', ephemeral: true });
    }

    if (!fileContent) fileContent = '\u200B'; // empty messages aren't allowed

    try {
      await interaction.channel.send(fileContent);
      console.log(`[message] Posted message from .txt file by ${interaction.user.tag}`);
      return interaction.reply({ content: '✅ Message sent successfully!', ephemeral: true });
    } catch (err) {
      console.error('❌ Failed to send message:', err);
      return interaction.reply({ content: '❌ Failed to send message.', ephemeral: true });
    }
  }
};
