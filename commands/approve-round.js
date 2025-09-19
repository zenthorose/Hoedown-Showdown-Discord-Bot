const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-round')
    .setDescription('Approves a round for use.')
    .setDefaultMemberPermissions(0) // Requires Manage Messages permission
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number to approve (1–16)')
        .setRequired(true)
    ),

  async execute(interaction) {
    let replyMessage;

    // --- Helper: log command usage + outcomes ---
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
      // --- Step 0: Permission check ---
      const hasPermission = await checkPermissions(interaction);
      await logUsage(); // always log attempt

      if (!hasPermission) {
        return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          ephemeral: true
        });
      }

      const round = interaction.options.getInteger('round');

      // --- Step 0.5: Input validation ---
      if (isNaN(round) || round < 1 || round > 16) {
        await logUsage("(❌ Invalid round input)");
        return interaction.reply({
          content: '❌ Invalid round number. Please enter a number between 1 and 16.',
          ephemeral: true
        });
      }

      console.log(`✅ Received approve-round command for Round #${round}`);
      await logUsage(`(Round: ${round})`);

      // --- Step 1: Processing reply ---
      replyMessage = await interaction.reply({
        content: `🔄 Processing approval for Round #${round}...`,
        fetchReply: true
      });

      // --- Step 2: Update channel permissions ---
      try {
        const channelId = config.roundChannels[round];
        if (!channelId) throw new Error(`Round channel ID not found for round ${round}.`);

        const channel = await interaction.client.channels.fetch(channelId);
        if (!channel) throw new Error(`Failed to fetch channel for Round #${round}.`);

        // Uncomment when ready
        // await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        //   ViewChannel: true,
        // });

        // console.log(`✅ Set @everyone permissions to view Round #${round} channel.`);
      } catch (permError) {
        console.error(`❌ Failed to update permissions for Round #${round}:`, permError);
        await logUsage(`❌ Failed to update permissions for Round #${round}`);
      }

      // --- Step 3: Trigger GAS ---
      try {
        const triggerUrl = process.env.Google_Apps_Script_URL;
        if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');

        const response = await axios.post(triggerUrl, { command: "approve-round", round });

        console.log("✅ Step 3: Google Apps Script responded:", response.data);

        const { success, reason, teams } = response.data;

        // --- Step 3a: Debug log for teams ---
        if (teams && typeof teams === 'object') {
          const teamKeys = Object.keys(teams);
          console.log(`📋 Step 3a: Teams object detected. Groups: ${teamKeys.join(', ')}`);
          console.log("📋 Step 3a: Teams content:", JSON.stringify(teams, null, 2));
        } else {
          console.log("⚠️ Step 3a: No teams data found in GAS response.");
        }

        let logMessage;
        let displayMessage;

        // --- Step 4: Process GAS response ---
        if (success) {
          displayMessage = `✅ Round #${round} approved successfully!`;
          logMessage = `✅ Round #${round} has been approved.`;

          // --- Step 4a: Log teams to Discord channel ---
          if (teams && typeof teams === 'object' && Object.keys(teams).length > 0) {
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
            if (logChannel) {
              let teamOutput = `📋 **Teams for Round #${round}:**\n`;

              for (const [teamName, players] of Object.entries(teams)) {
                const playerList = players.map(p => p?.name || "Unknown").join(', ');
                teamOutput += `**${teamName}:** ${playerList}\n`;
              }

              await logChannel.send(teamOutput);
            }
          }
        } else {
          switch (reason) {
            case "not_found":
              displayMessage = `❌ Round #${round} can't be found.`; break;
            case "no_data":
              displayMessage = `❌ Round #${round} has no team data.`; break;
            case "discord_error":
              displayMessage = `❌ Error posting Round #${round} to Discord.`; break;
            default:
              displayMessage = `❌ Unknown error occurred while approving Round #${round}.`; break;
          }
          logMessage = displayMessage;
        }

        // --- Step 5: Log outcome ---
        await logUsage(`→ ${logMessage}`);

        // --- Step 6: Update reply & delete after 5s ---
        if (replyMessage) {
          await replyMessage.edit(displayMessage);
          setTimeout(async () => {
            try { await replyMessage.delete(); } catch (err) { console.error(err); }
          }, 5000);
        }

      } catch (gasError) {
        console.error("❌ Step 3: Error triggering Google Apps Script:", gasError);

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
