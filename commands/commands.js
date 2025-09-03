const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Shows a list of commands')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Choose which commands to view')
        .setRequired(true)
        .addChoices(
          { name: 'General', value: 'general' },
          { name: 'Admin', value: 'admin' }
        )
    ),

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (replied) {
        return interaction.followUp({
          content,
          ephemeral: isEphemeral,
        });
      } else {
        replied = true;
        return interaction.reply({
          content,
          ephemeral: isEphemeral,
        });
      }
    }

    try {
      const type = interaction.options.getString('type');
      const hasPermission = await checkPermissions(interaction);

      if (!hasPermission) {
        return safeReply('❌ You do not have permission to view command lists!', true);
      }

      // Command lists
      const generalCommands = [
        { name: '/info-check', description: 'See what info you’ve submitted.' },
        { name: '/register', description: 'Register your information with the bot.' },
        { name: '/update-info', description: 'Update your registered information.' },
      ];

      const adminCommands = [
        { name: '/commands', description: 'Provides bot information (this list).' },
        { name: '/ping', description: 'Keeps the bot alive.' },
        { name: '/member-update', description: 'Syncs members with Google Sheets.' },
        { name: '/message-purge', description: 'Deletes bot messages from the current channel.' },
        { name: '/time-slots', description: 'Posts timeslot messages for opt-in/out.' },
        { name: '/grab-reactions', description: 'Collects reactions for team creation.' },
        { name: '/swap', description: 'Swap team members before posting.' },
        { name: '/approve-teams', description: 'Publishes the final Team List.' },
      ];

      let commandList;

      if (type === 'general') {
        commandList = generalCommands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');
        return safeReply(`\`\`\`\nHere are the general commands:\n\n${commandList}\n\`\`\``);
      }

      if (type === 'admin') {
        commandList = adminCommands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');
        return safeReply(`\`\`\`\nHere are the admin commands:\n\n${commandList}\n\`\`\``);
      }

    } catch (error) {
      console.error("❌ Error executing /commands:", error);
      try {
        if (replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ There was an error executing this command!',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: '❌ There was an error executing this command!',
            ephemeral: true,
          });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  }
};
