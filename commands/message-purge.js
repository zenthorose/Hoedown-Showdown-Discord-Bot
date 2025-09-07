const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message-purge')
    .setDescription('Deletes all messages in this channel sent by the bot.')
    .setDefaultMemberPermissions(0), // Requires Manage Messages permission

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (replied || interaction.deferred) {
        return interaction.followUp({ content: String(content), ephemeral: isEphemeral });
      } else {
        replied = true;
        return interaction.reply({ content: String(content), ephemeral: isEphemeral });
      }
    }

    try {
      // --- Permission check ---
      const permResult = await checkPermissions(interaction);
      if (typeof permResult === 'string') {
        return safeReply(permResult, true); // Send error message if string
      }

      // Ensure bot has Manage Messages permission
      if (!interaction.channel.permissionsFor(interaction.client.user).has('ManageMessages')) {
        return safeReply("❌ I don't have permission to delete messages in this channel.", true);
      }

      // Defer reply to avoid interaction timeout
      await interaction.deferReply({ ephemeral: true });

      // Fetch last 100 messages
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(msg => msg.author.bot);

      if (botMessages.size === 0) {
        return interaction.editReply("✅ No bot messages found to delete.");
      }

      // Bulk delete
      await interaction.channel.bulkDelete(botMessages, true);
      return interaction.editReply(`✅ Deleted ${botMessages.size} bot messages!`);
    } catch (error) {
      console.error("❌ Error deleting messages:", error);
      try {
        await safeReply("❌ Failed to delete bot messages. Make sure messages are not older than 14 days.", true);
      } catch (err) {
        console.error("❌ Failed to send error reply:", err);
      }
    }
  },
};
