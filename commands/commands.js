const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json'); // 👈 make sure LOG_CHANNEL_ID is inside config.json

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Shows a list of commands')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
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

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/commands** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (logError) {
        console.error("❌ Failed to send log message:", logError);
      }
    }

    try {
      const type = interaction.options.getString('type');
      const hasPermission = await checkPermissions(interaction);

      // Always log the attempt
      await logUsage(`(type: ${type})`);

      if (!hasPermission) {
        await logUsage("❌ Permission denied");
        return safeReply('❌ You do not have permission to view command lists!', true);
      }

      // Command lists
      const generalCommands = [
        { name: '/info-check', description: 'See what info you’ve submitted.' },
        { name: '/register', description: 'Register your information for the first time.' },
        { name: '/update-info', description: 'Update your registered information.' },
      ];

      const adminCommands = [
        { name: '/commands', description: 'Provides bot command information for general or admin commands.' },
        { name: '/message', description: 'Will let you send/edit a message from the bot in an embeded format with the provided channel and message ID’s.' },
        { name: '/ping', description: 'Keeps the bot alive.' },
        { name: '/member-update', description: 'Syncs members and names with Google Sheets.' },
        { name: '/message-purge', description: 'Deletes bot messages from the current channel.' },
        { name: '/time-slots', description: 'Posts timeslot messages for opt-in into the opt-in channel.' },
        { name: '/grab-reactions', description: 'Start’s the team creation process. Will post the review list into the team-check channel.' },
        { name: '/replace', description: 'You must enter the Round #, the person to remove from the list and then person to add that isn’t on the list.' },
        { name: '/swap', description: 'Swap’s the postion of 2-10 people on the list.' },
        { name: '/approve-round', description: 'Publishes the final Team List to the correct round channel and @’s everyone for that round.' },
        { name: '/avoid', description: 'Let’s you add up to 5 people to the avoid list.' },
        { name: '/unavoid', description: 'Let’s you remove an avoided pair from the bot.' },
        { name: '/avoid-list', description: 'This allows you to pull the entire avoid list or just the list of a user if you add the name.' },
      ];

      let commandList;

      if (type === 'general') {
        commandList = generalCommands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');
        await logUsage("✅ Returned general commands");
        return safeReply(`\`\`\`\nHere are the general commands:\n\n${commandList}\n\`\`\``);
      }

      if (type === 'admin') {
        commandList = adminCommands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');
        await logUsage("✅ Returned admin commands");
        return safeReply(`\`\`\`\nHere are the admin commands:\n\n${commandList}\n\`\`\``);
      }

    } catch (error) {
      console.error("❌ Error executing /commands:", error);
      await logUsage("❌ Unexpected error");
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
