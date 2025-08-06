const { SlashCommandBuilder } = require('@discordjs/builders');
const { InteractionResponseFlags } = require('discord.js');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commands-info')
    .setDescription('Shows a list of available commands'),

  async execute(interaction) {
    const startTime = Date.now();
    let replied = false;

    // Helper to safely reply or follow-up and log
    async function safeReply(content, isEphemeral = false) {
      const elapsed = Date.now() - startTime;
      console.log(`⏱ Attempting reply after ${elapsed}ms. Replied before? ${replied}`);

      if (replied) {
        console.warn('⚠️ Interaction already replied to, attempting followUp instead');
        try {
          await interaction.followUp({
            content,
            flags: isEphemeral ? InteractionResponseFlags.Ephemeral : undefined,
          });
          console.log('✅ Follow-up successful');
        } catch (err) {
          console.error('❌ Error sending follow-up:', err);
        }
      } else {
        try {
          await interaction.reply({
            content,
            flags: isEphemeral ? InteractionResponseFlags.Ephemeral : undefined,
          });
          replied = true;
          console.log('✅ Reply successful');
        } catch (err) {
          console.error('❌ Error sending reply:', err);
          throw err; // rethrow to catch block
        }
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);

      if (!hasPermission) {
        await safeReply('❌ You do not have permission to use this command!', true);
        return;
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
        { name: '/ping', description: 'This keeps the bot alive.' }
      ];

      const commandList = commands.map(cmd => `"${cmd.name}" - ${cmd.description}`).join('\n');

      await safeReply(`\`\`\`\nHere are my commands:\n\n${commandList}\n\`\`\``);

    } catch (error) {
      console.error("❌ Error executing commands-info command:", error);

      try {
        if (replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ There was an error executing this command!',
            flags: InteractionResponseFlags.Ephemeral,
          });
          console.log('✅ Error follow-up sent');
        } else {
          await interaction.reply({
            content: '❌ There was an error executing this command!',
            flags: InteractionResponseFlags.Ephemeral,
          });
          console.log('✅ Error reply sent');
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  }
};
