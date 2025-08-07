const { SlashCommandBuilder } = require('@discordjs/builders');
const { InteractionResponseFlags } = require('discord.js');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands-info')
    .setDescription('Shows a list of available commands'),

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (replied) {
        // If already replied, use followUp instead
        return interaction.followUp({
          content,
          flags: isEphemeral ? InteractionResponseFlags.Ephemeral : undefined,
        });
      } else {
        replied = true;
        return interaction.reply({
          content,
          flags: isEphemeral ? InteractionResponseFlags.Ephemeral : undefined,
        });
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);

      if (!hasPermission) {
        // Only this reply is ephemeral
        return safeReply('❌ You do not have permission to use this command!', true);
      }

      const commands = [
        { name: '/commands-info', description: 'Provides bot information' },
        { name: '/member-update', description: 'Gathers a list of all members of the discord before sending it to the Google Sheets.' },
        { name: '/message-purge', description: 'Deletes all previous messages from the bot in whatever channel the command was entered in.' },
        { name: '/time-slots', description: 'Posts all of the timeslot posts for people to opt in or out of.' },
        { name: '/grab-reactions', description: 'Sends the list of reactions from the selected message to the Google Sheets to begin the team creation.' },
        { name: '/swap', description: 'Used to replace members on teams before official list is posted. Enter Team Set # followed by the person you are replacing lastly who you are replacing them with.' },
        { name: '/approve-teams', description: 'Use this command after the team has been reviewed and everything is good to publish the official Team List to everyone.' },
        { name: '/region-change', description: 'Changes your region to one of the three options "East", "West", or "Both".' },
        { name: '/region-check', description: 'Returns what regions you are currently selected for.' },
        { name: '/register', description: 'Imports the info given for your bot to use.' },
        { name: '/update-info', description: 'Updates the selected info for the bot to use' },
        { name: '/ping', description: 'This keeps the bot alive.' }
      ];

      const commandList = commands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');

      // Public reply
      await safeReply(`\`\`\`\nHere are my commands:\n\n${commandList}\n\`\`\``);

    } catch (error) {
      console.error("❌ Error executing commands-info command:", error);
      try {
        if (replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ There was an error executing this command!',
            flags: InteractionResponseFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: '❌ There was an error executing this command!',
            flags: InteractionResponseFlags.Ephemeral,
          });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  }
};
