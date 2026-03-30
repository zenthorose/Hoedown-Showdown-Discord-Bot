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
          flags: 64
        });
      }

      const round = interaction.options.getInteger('round');

      // --- Step 0.5: Input validation ---
      if (isNaN(round) || round < 1 || round > 16) {
        await logUsage("(❌ Invalid round input)");
        return interaction.reply({
          content: '❌ Invalid round number. Please enter a number between 1 and 16.',
          flags: 64
        });
      }

      console.log(`✅ Received approve-round command for Round #${round}`);
      await logUsage(`(Round: ${round})`);

      // --- Step 1: Processing reply ---
      replyMessage = await interaction.reply({
        content: `🔄 Processing approval for Round #${round}...`,
        fetchReply: true
      });

      // --- Step 2: Update round channel permissions (optional global perms) ---
      try {
        const channelId = config.roundChannels[round];
        if (!channelId) throw new Error(`Round channel ID not found for round ${round}.`);

        const channel = await interaction.client.channels.fetch(channelId);
        if (!channel) throw new Error(`Failed to fetch channel for Round #${round}.`);

        // Example: uncomment if you want @everyone to see the round channel
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          ViewChannel: true,
          SendMessages: false,
        });
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

          // --- Step 4a: Clear old messages & reset VC perms ---
          for (const [teamKey, channelId] of Object.entries(config.teamChannels)) {
            try {
              const channel = await interaction.client.channels.fetch(channelId);

              // Clear messages if it's a text channel
              if (channel?.isTextBased()) {
                let messages;
                do {
                  messages = await channel.messages.fetch({ limit: 50 });
                  if (messages.size > 0) {
                    await channel.bulkDelete(messages, true);
                    console.log(`🧹 Cleared ${messages.size} messages from ${teamKey}`);
                  }
                } while (messages.size >= 2);
              }

              // Reset VC perms if it's a voice channel
              if (channel?.type === 2) { // 2 = GuildVoice
                const allowedIds = [interaction.guild.roles.everyone.id]; // keep @everyone
                for (const overwrite of channel.permissionOverwrites.cache.values()) {
                  if (!allowedIds.includes(overwrite.id)) {
                    await overwrite.delete().catch(err =>
                      console.error(`❌ Failed to remove overwrite in VC ${teamKey}:`, err)
                    );
                  }
                }
                console.log(`🔄 Reset permission overwrites in VC ${teamKey}`);
              }
            } catch (err) {
              console.error(`❌ Failed to reset ${teamKey} (${channelId}):`, err);
            }
          }

          // --- Step 4b: Send each team to its proper channel + set perms ---
          if (teams && typeof teams === 'object' && Object.keys(teams).length > 0) {
            for (const [teamName, players] of Object.entries(teams)) {
              let teamOutput = `📋 **Team ${teamName} for Round #${round}:**\n\n`;

              for (const player of players) {
                const name = player?.name || "Unknown";
                const steamId = player?.steamId || "N/A";
                const streamLink = player?.streamLink || "N/A";
                teamOutput += `- ${name} | Steam: ${steamId} | Stream: ${streamLink}\n`;
              }

              const teamKey = `Team ${teamName}`;
              const teamChannelId = config.teamChannels?.[teamKey];

              if (teamChannelId) {
                try {
                  const teamChannel = await interaction.client.channels.fetch(teamChannelId);
                  if (teamChannel) {
                    // Send the team message
                    await teamChannel.send(teamOutput);
                    console.log(`✅ Sent team ${teamKey} output to channel ${teamChannelId}`);

                    // --- 🔹 NEW: Fetch the "Fill In" role ---
                    const fillInRole = interaction.guild.roles.cache.find(
                      role => role.name.toLowerCase() === "fill in"
                    );

                    if (!fillInRole) {
                      console.warn(`⚠️ "Fill In" role not found in guild. Skipping role permission assignment.`);
                    }

                    // Grant perms to each player
                    for (const player of players) {
                      if (!player?.discordId) {
                        console.warn(`⚠️ No Discord ID for ${player?.name}, skipping perms.`);
                        continue;
                      }
                      try {
                        await teamChannel.permissionOverwrites.edit(player.discordId, {
                          ViewChannel: true,
                          SendMessages: true,
                          ReadMessageHistory: true,
                          Connect: true,
                          Speak: true,
                        });
                        console.log(`🔑 Granted access to ${player.name} (${player.discordId}) in ${teamKey}`);
                      } catch (permErr) {
                        console.error(`❌ Failed to set perms for ${player.name} in ${teamKey}:`, permErr);
                      }
                    }

                    // --- 🔹 NEW: Also grant same perms to "Fill In" role ---
                    if (fillInRole) {
                      try {
                        await teamChannel.permissionOverwrites.edit(fillInRole.id, {
                          ViewChannel: true,
                          SendMessages: true,
                          ReadMessageHistory: true,
                          Connect: true,
                          Speak: true,
                        });
                        console.log(`🎭 Granted "Fill In" role access to ${teamKey}`);
                      } catch (fillErr) {
                        console.error(`❌ Failed to set perms for "Fill In" role in ${teamKey}:`, fillErr);
                      }
                    }

                  } else {
                    console.warn(`⚠️ Could not fetch channel for ${teamKey} (${teamChannelId})`);
                  }
                } catch (err) {
                  console.error(`❌ Failed to send team output for ${teamKey}:`, err);
                }
              } else {
                console.warn(`⚠️ No channel mapping found for ${teamKey} in config.teamChannels`);
              }
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
        flags: 64
      });
    }
  },
};
