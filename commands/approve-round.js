const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { getBotSettings } = require('../database/botSettings');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const {
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  recordPreviousPairings,
  splitDiscordMessage
} = require('../database/teamDrafts');

let approvalRunning = false;

function escapeDiscordMarkdown(value) {
  return String(value).replace(/([\\_*~`|>])/g, '\\$1');
}

function formatFinalRoundMessage(draft) {
  let message = `**Round #${draft.round} – Final Teams**\n\n`;
  for (const team of draft.teams) {
    message += `__**Team ${team.name}**__\n`;
    for (const player of team.players) {
      message += player.discordId
        ? `<@${player.discordId}>\n`
        : `${escapeDiscordMarkdown(player.name)}\n`;
    }
    message += '\n';
  }
  return message.trim();
}

function formatTeamChannelMessage(team, round) {
  let message = `📋 **Team ${team.name} for Round #${round}:**\n\n`;
  for (const player of team.players) {
    message += `- ${escapeDiscordMarkdown(player.name || 'Unknown')} | Steam: ${player.steamId || 'N/A'} | Stream: ${player.streamLink || 'N/A'}\n`;
  }
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-round')
    .setDescription('Approves a round for use.')
    .setDefaultMemberPermissions(0)
    .addIntegerOption(option =>
      option.setName('round')
        .setDescription('The round number to approve (1–16)')
        .setRequired(true)
    ),

  async execute(interaction) {
    let channels = config;
    let botSettingsPromise;
    const loadBotSettings = () => {
      if (!botSettingsPromise) botSettingsPromise = getBotSettings();
      return botSettingsPromise;
    };

    async function logUsage(extra = '') {
      try {
        const settings = await loadBotSettings();
        channels = {
          ...config,
          ...settings.channels,
          roundChannels: { ...config.roundChannels, ...settings.channels.roundChannels },
          teamChannels: { ...config.teamChannels, ...settings.channels.teamChannels }
        };
      } catch (error) {
        console.error('Could not load bot channels for /approve-round logging:', error);
      }
      try {
        const logChannel = await interaction.client.channels.fetch(channels.LOG_CHANNEL_ID || config.LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `📝 **/approve-round** used by **${interaction.user.tag}** in **#${interaction.channel?.name || 'Unknown'}** ${extra}`
          );
        }
      } catch (error) {
        console.error('Failed to log /approve-round:', error);
      }
    }

    if (approvalRunning) {
      return interaction.reply({
        content: '❌ A round approval is already running. Please wait for it to finish.',
        ephemeral: true
      });
    }

    approvalRunning = true;
    try {
      await logUsage();
      await interaction.deferReply({ ephemeral: true });

      if (!(await checkPermissions(interaction))) {
        return interaction.editReply('❌ You do not have permission to use this command!');
      }

      const round = interaction.options.getInteger('round');
      if (!Number.isInteger(round) || round < 1 || round > 16) {
        await logUsage('(invalid round input)');
        return interaction.editReply('❌ Invalid round number. Please enter a number between 1 and 16.');
      }

      await logUsage(`(Round: ${round})`);
      const botSettings = await loadBotSettings();
      channels = { ...channels, ...botSettings.channels };
      const settings = botSettings.approveRound;
      const { collections, databases } = await connectHoedownInfo();
      const approval = await beginCurrentDraftApproval({
        teamCheckCollection: collections.teamCheck,
        roundsDatabase: databases.rounds,
        round
      });
      const { draft, roundCollection } = approval;

      await recordPreviousPairings(collections.previousPairings, draft.teams);

      const failures = [];
      const warnings = [];
      const roundChannelId = channels.roundChannels?.[round] || config.roundChannels?.[round];
      const roundPostChannelId = roundChannelId ||
        channels.TeamCheckChannelID ||
        config.TeamCheckChannelID ||
        process.env.TEAM_CHECK_CHANNEL_ID;

      if (settings.ENABLE_ROUND_CHANNEL_PERMS) {
        try {
          if (!roundChannelId) throw new Error(`No channel ID configured for Round #${round}.`);
          const channel = await interaction.client.channels.fetch(roundChannelId);
          if (!channel) throw new Error(`Failed to fetch channel for Round #${round}.`);
          await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            ViewChannel: true,
            SendMessages: false
          });
        } catch (error) {
          console.error(`Failed to update permissions for Round #${round}:`, error);
          warnings.push(`Round channel permissions: ${error.message}`);
        }
      }

      const roundRecord = await roundCollection.findOne({ _id: 'current' });
      const discordPosts = roundRecord.discordPosts || { roundMessageIds: [], teamMessageIds: {} };
      const roundMessageIds = [...(discordPosts.roundMessageIds || [])];
      const teamMessageIds = { ...(discordPosts.teamMessageIds || {}) };
      const cleanupProgress = { ...(roundRecord.cleanupProgress || {}) };

      for (const [teamKey, channelId] of Object.entries(channels.teamChannels || config.teamChannels || {})) {
        if (!settings.ENABLE_TEAM_CLEANUP && !settings.ENABLE_VC_RESET) break;
        if (cleanupProgress[teamKey]) continue;
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (!channel) throw new Error(`Could not fetch ${teamKey} (${channelId}).`);

          if (channel.isTextBased()) {
            if (settings.ENABLE_TEAM_CLEANUP) {
              let messages;
              do {
                messages = await channel.messages.fetch({ limit: 50 });
                if (messages.size > 0) await channel.bulkDelete(messages, true);
              } while (messages.size >= 2);
            }
          }

          if (channel.type === 2 && settings.ENABLE_VC_RESET) {
            const everyoneId = interaction.guild.roles.everyone.id;
            for (const overwrite of channel.permissionOverwrites.cache.values()) {
              if (overwrite.id !== everyoneId) await overwrite.delete();
            }
          }

          cleanupProgress[teamKey] = true;
          await roundCollection.updateOne({ _id: 'current', generationId: draft.generationId }, {
            $set: { [`cleanupProgress.${teamKey}`]: true }
          });
        } catch (error) {
          console.error(`Failed to reset ${teamKey} (${channelId}):`, error);
          failures.push(`${teamKey} cleanup/voice reset: ${error.message}`);
        }
      }

      if (settings.ENABLE_DISCORD_POSTING) {
        if (!roundPostChannelId) {
          failures.push(`No destination channel configured for Round #${round}.`);
        } else {
          try {
            const roundChannel = await interaction.client.channels.fetch(roundPostChannelId);
            if (!roundChannel || !roundChannel.isTextBased()) {
              throw new Error(`Configured Round #${round} channel is not a text channel.`);
            }
            const chunks = splitDiscordMessage(formatFinalRoundMessage(draft));
            for (let index = 0; index < chunks.length; index += 1) {
              if (roundMessageIds[index]) continue;
              const sent = await roundChannel.send(chunks[index]);
              roundMessageIds[index] = sent.id;
              await roundCollection.updateOne({ _id: 'current', generationId: draft.generationId }, {
                $set: { 'discordPosts.roundMessageIds': roundMessageIds }
              });
            }
          } catch (error) {
            console.error(`Failed to post the final roster for Round #${round}:`, error);
            failures.push(`Round #${round} final roster: ${error.message}`);
          }
        }
      }

      for (const team of draft.teams) {
        if (!settings.ENABLE_DISCORD_POSTING && !settings.ENABLE_TEAM_POSTING_PERMS) continue;
        const teamKey = `Team ${team.name}`;
        const teamChannelId = channels.teamChannels?.[teamKey] || config.teamChannels?.[teamKey];
        if (!teamChannelId) {
          if (settings.ENABLE_DISCORD_POSTING || settings.ENABLE_TEAM_POSTING_PERMS) {
            failures.push(`No channel mapping found for ${teamKey}.`);
          }
          continue;
        }

        try {
          const teamChannel = await interaction.client.channels.fetch(teamChannelId);
          if (!teamChannel) throw new Error(`Could not fetch ${teamKey} (${teamChannelId}).`);

          if (settings.ENABLE_DISCORD_POSTING && !teamMessageIds[team.name]) {
            const sent = await teamChannel.send(formatTeamChannelMessage(team, round));
            teamMessageIds[team.name] = sent.id;
            await roundCollection.updateOne({ _id: 'current', generationId: draft.generationId }, {
              $set: { [`discordPosts.teamMessageIds.${team.name}`]: sent.id }
            });
          }

          if (settings.ENABLE_TEAM_POSTING_PERMS) {
            const fillInRole = interaction.guild.roles.cache.find(
              role => role.name.toLowerCase() === 'fill in'
            );
            for (const player of team.players) {
              if (!player.discordId) continue;
              try {
                await teamChannel.permissionOverwrites.edit(player.discordId, {
                  ViewChannel: true,
                  SendMessages: true,
                  ReadMessageHistory: true,
                  Connect: true,
                  Speak: true
                });
              } catch (error) {
                console.error(`Failed to set permissions for ${player.name} in ${teamKey}:`, error);
                warnings.push(`${teamKey} permissions for ${player.name}: ${error.message}`);
              }
            }
            if (fillInRole) {
              try {
                await teamChannel.permissionOverwrites.edit(fillInRole.id, {
                  ViewChannel: true,
                  SendMessages: true,
                  ReadMessageHistory: true,
                  Connect: true,
                  Speak: true
                });
              } catch (error) {
                console.error(`Failed to set Fill In permissions in ${teamKey}:`, error);
                warnings.push(`${teamKey} Fill In permissions: ${error.message}`);
              }
            }
          }
        } catch (error) {
          console.error(`Failed to process ${teamKey}:`, error);
          failures.push(`${teamKey}: ${error.message}`);
        }
      }

      if (failures.length > 0) {
        const message = `Approval is incomplete and can be retried. ${failures.join(' ')}`;
        await logUsage(`❌ Round #${round} approval incomplete: ${failures.join('; ')}`);
        return interaction.editReply(`❌ ${message}`);
      }

      await completeCurrentDraftApproval({
        teamCheckCollection: collections.teamCheck,
        roundCollection,
        generationId: draft.generationId
      });

      const result = [
        `✅ Round #${round} approved successfully.`,
        warnings.length ? `⚠️ Completed with warnings: ${warnings.join(' ')}` : ''
      ].filter(Boolean).join('\n');
      await logUsage(`✅ Round #${round} approved.${warnings.length ? ` Warnings: ${warnings.join('; ')}` : ''}`);
      await interaction.editReply(result);
      setTimeout(async () => {
        try { await interaction.deleteReply(); } catch (error) {
          console.error('Failed to delete /approve-round response:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('Unexpected error in /approve-round:', error);
      await logUsage(`❌ Approval failed: ${error.message}`);
      const message = `❌ Could not approve Round #${interaction.options.getInteger('round')}: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply(message);
        } catch (notifyError) {
          console.error('Failed to notify /approve-round caller:', notifyError);
        }
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    } finally {
      approvalRunning = false;
    }
  }
};
