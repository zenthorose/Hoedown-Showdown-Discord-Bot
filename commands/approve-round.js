const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-round')
    .setDescription('Approves a round for use.')
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number to approve')
        .setRequired(true)
    ),

  async execute(interaction) {
    let replyMessage;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/approve-round** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (logError) {
        console.error("❌ Failed to send log message:", logError);
      }
    }

    try {
      // --- Unified permission check ---
      const hasPermission = await checkPermissions(interaction);
      await logUsage(); // always log usage attempt

      if (!hasPermission) {
        return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          ephemeral: true
        });
      }

      const round = interaction.options.getInteger('round');

      // --- Validate input manually (1–16 only) ---
      if (isNaN(round) || round < 1 || round > 16) {
        await logUsage("(❌ Invalid round input)");
        return interaction.reply({
          content: '❌ Invalid round number. Please enter a number between 1 and 16.',
          ephemeral: true
        });
      }

      console.log(`✅ Received approve-round command for Round #${round}`);
      await logUsage(`(Round: ${round})`);

      // --- Clear previous bot messages in the channel ---
      try {
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        const botMessages = fetchedMessages.filter(msg => msg.author.bot);
        if (botMessages.size > 0) {
          await interaction.channel.bulkDelete(botMessages, true);
          console.log(`Deleted ${botMessages.size} previous bot messages.`);
        }
      } catch (clearError) {
        console.error("❌ Error clearing bot messages:", clearError);
      }

      // --- Send "processing" message ---
      replyMessage = await interaction.reply({
        content: `🔄 Processing approval for Round #${round}...`,
        fetchReply: true
      });

      // --- Send approval request to Google Apps Script ---
      try {
        const triggerUrl = process.env.Google_Apps_Script_URL;
        if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

        const response = await axios.post(triggerUrl, { command: "approve-round", round });
        console.log("✅ Google Apps Script responded:", response.data);

        const { success, reason } = response.data;

        let logMessage;
        let displayMessage;

        if (success) {
          displayMessage = `✅ Round #${round} approved successfully!`;
          logMessage = `✅ Round #${round} has been approved.`;
        } else {
          switch (reason) {
            case "not_found":
              displayMessage = `❌ Round #${round} can't be found.`;
              logMessage = displayMessage;
              break;
            case "no_data":
              displayMessage = `❌ Round #${round} has no team data.`;
              logMessage = displayMessage;
              break;
            case "discord_error":
              displayMessage = `❌ Error posting Round #${round} to Discord.`;
              logMessage = displayMessage;
              break;
            default:
              displayMessage = `❌ Unknown error occurred while approving Round #${round}.`;
              logMessage = displayMessage;
              break;
          }
        }

        // --- Log outcome ---
        await logUsage(`→ ${logMessage}`);

        // --- Update reply & delete after 5s ---
        if (replyMessage) {
          await replyMessage.edit(displayMessage);
          setTimeout(async () => {
            try { await replyMessage.delete(); } catch (err) { console.error(err); }
          }, 5000);
        }

      } catch (gasError) {
        console.error("❌ Error triggering Google Apps Script:", gasError);

        if (replyMessage) {
          await replyMessage.edit(`❌ There was an error triggering the Apps Script.`);
          setTimeout(async () => {
            try { await replyMessage.delete(); } catch (err) { console.error(err); }
          }, 5000);
        }

        await logUsage(`❌ Error with Google Apps Script: ${gasError.message}`);
      }

    } catch (error) {
      console.error("❌ Unexpected error:", error);
      await logUsage("❌ Unexpected error occurred");
      return interaction.reply({
        content: "❌ An unexpected error occurred.",
        ephemeral: true
      });
    }
  },
};
