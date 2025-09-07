const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message-purge')
    .setDescription('Deletes all messages in this channel sent by the bot.'),

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      const messageContent = String(content); // ensure string
      if (replied || interaction.deferred) {
        return interaction.followUp({
          content: messageContent,
          ephemeral: isEphemeral,
        });
      } else {
        replied = true;
        return interaction.reply({
          content: messageContent,
          ephemeral: isEphemeral,
        });
      }
    }

    try {
      // Check permissions using your existing permissions function
      const hasPermission = await checkPermissions(interaction);
      if (!hasPermission) {
        return safeReply('❌ You do not have permission to use this command!', true);
      }

      // Check if bot has Manage Messages
      if (!interaction.channel.permissionsFor(interaction.client.user).has('ManageMessages')) {
        return safeReply("❌ I don't have permission to delete messages in this channel.", true);
      }

      // Defer to avoid timeout
      await interaction.deferReply({ ephemeral: true });

      // Fetch last 100 messages
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(msg => msg.author.bot);

      if (!botMessages.size) {
        return safeReply('✅ No bot messages found to delete.');
      }

      // Bulk delete (ignore errors for messages older than 14 days)
      await interaction.channel.bulkDelete(botMessages, true);

      return safeReply(`✅ Deleted ${botMessages.size} bot messages!`);
    } catch (error) {
      console.error('❌ Error deleting messages:', error);
      return safeReply('❌ Failed to delete bot messages. Make sure messages are not older than 14 days.', true);
    }
  },
};
