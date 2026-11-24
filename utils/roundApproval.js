const config = require('../config.json');
const {
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  recordPreviousPairings,
  splitDiscordMessage
} = require('../database/teamDrafts');

const APPROVAL_FLAGS = [
  'ENABLE_ROUND_CHANNEL_PERMS',
  'ENABLE_TEAM_CLEANUP',
  'ENABLE_VC_RESET',
  'ENABLE_TEAM_POSTING_PERMS',
  'ENABLE_DISCORD_POSTING'
];

let approvalRunning = false;
const roundApprovalListeners = new Set();

function subscribeRoundApprovalUpdates(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('Round approval update listener must be a function.');
  }
  roundApprovalListeners.add(listener);
  return () => roundApprovalListeners.delete(listener);
}

function notifyRoundApprovalUpdated(generationId) {
  for (const listener of roundApprovalListeners) {
    try {
      listener(generationId);
    } catch (error) {
      console.error('Could not notify app clients about round approval:', error);
    }
  }
}

function normalizeApprovalActor(actor = {}) {
  const username = String(actor.username || actor.discordUsername || 'Unknown account').slice(0, 64);
  const discordUsername = String(actor.discordUsername || '').slice(0, 64);
  const avatarUrl = typeof actor.avatarUrl === 'string' &&
    actor.avatarUrl.length <= 512 &&
    /^https:\/\/cdn\.discordapp\.com\//.test(actor.avatarUrl)
    ? actor.avatarUrl
    : '';
  return {
    ...(typeof actor.discordId === 'string' ? { discordId: actor.discordId.slice(0, 20) } : {}),
    username,
    discordUsername,
    avatarUrl
  };
}

async function saveApprovalActivity(teamCheckCollection, generationId, activity) {
  const result = await teamCheckCollection.updateOne({
    _id: 'current',
    generationId
  }, {
    $set: { approvalActivity: activity }
  });
  if (!result.matchedCount) {
    throw approvalError('The current round changed while approval status was being saved.', 409);
  }
  notifyRoundApprovalUpdated(generationId);
  return teamCheckCollection.findOne({ _id: 'current', generationId });
}

function approvalError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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

async function approveLatestRound({
  teamCheckCollection,
  roundsDatabase,
  previousPairingsCollection,
  botSettings,
  discordClient,
  guild,
  generationId,
  actor
}) {
  if (approvalRunning) {
    throw approvalError('A round approval is already running. Please wait for it to finish.', 409);
  }
  approvalRunning = true;
  let changedGenerationId = '';
  try {
    if (!discordClient || !discordClient.isReady() || !guild) {
      throw approvalError('The Discord bot is not ready to approve a round.', 503);
    }
    if (!teamCheckCollection || !roundsDatabase || !previousPairingsCollection) {
      throw approvalError('Round approval is not configured.', 503);
    }
    const settings = botSettings?.approveRound;
    if (!settings || APPROVAL_FLAGS.some((flag) => typeof settings[flag] !== 'boolean')) {
      throw approvalError('Round approval settings are unavailable or invalid.', 503);
    }
    const currentDraft = await teamCheckCollection.findOne({ _id: 'current' });
    if (!currentDraft || !['pending', 'approving', 'approved'].includes(currentDraft.status)) {
      throw approvalError('There is no pending round to approve.', 404);
    }
    if (generationId && currentDraft.generationId !== generationId) {
      throw approvalError('The current round changed. Reload the preview and try again.', 409);
    }
    changedGenerationId = currentDraft.generationId;
    const approvalActor = normalizeApprovalActor(actor);
    await saveApprovalActivity(teamCheckCollection, changedGenerationId, {
      status: 'sending',
      actor: approvalActor,
      startedAt: new Date()
    });
    const round = currentDraft.round;
    if (!Number.isInteger(round) || round < 1 || round > 16) {
      throw approvalError('The pending draft has an invalid round number.', 409);
    }

    const channels = {
      ...config,
      ...botSettings.channels,
      roundChannels: { ...config.roundChannels, ...botSettings.channels?.roundChannels },
      teamChannels: { ...config.teamChannels, ...botSettings.channels?.teamChannels }
    };
    const approval = await beginCurrentDraftApproval({
      teamCheckCollection,
      roundsDatabase,
      round,
      generationId: currentDraft.generationId
    });
    const { draft, roundCollection } = approval;

    await recordPreviousPairings(previousPairingsCollection, draft.teams);

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
        const channel = await discordClient.channels.fetch(roundChannelId);
        if (!channel) throw new Error(`Failed to fetch channel for Round #${round}.`);
        await channel.permissionOverwrites.edit(guild.roles.everyone, {
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

    for (const [teamKey, channelId] of Object.entries(channels.teamChannels || {})) {
      if (!settings.ENABLE_TEAM_CLEANUP && !settings.ENABLE_VC_RESET) break;
      if (cleanupProgress[teamKey]) continue;
      try {
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel) throw new Error(`Could not fetch ${teamKey} (${channelId}).`);

        if (channel.isTextBased() && settings.ENABLE_TEAM_CLEANUP) {
          let messages;
          do {
            messages = await channel.messages.fetch({ limit: 50 });
            if (messages.size > 0) await channel.bulkDelete(messages, true);
          } while (messages.size >= 2);
        }

        if (channel.type === 2 && settings.ENABLE_VC_RESET) {
          const everyoneId = guild.roles.everyone.id;
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
          const roundChannel = await discordClient.channels.fetch(roundPostChannelId);
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
        failures.push(`No channel mapping found for ${teamKey}.`);
        continue;
      }

      try {
        const teamChannel = await discordClient.channels.fetch(teamChannelId);
        if (!teamChannel) throw new Error(`Could not fetch ${teamKey} (${teamChannelId}).`);

        if (settings.ENABLE_DISCORD_POSTING && !teamMessageIds[team.name]) {
          const sent = await teamChannel.send(formatTeamChannelMessage(team, round));
          teamMessageIds[team.name] = sent.id;
          await roundCollection.updateOne({ _id: 'current', generationId: draft.generationId }, {
            $set: { [`discordPosts.teamMessageIds.${team.name}`]: sent.id }
          });
        }

        if (settings.ENABLE_TEAM_POSTING_PERMS) {
          const fillInRole = guild.roles.cache.find(
            (role) => role.name.toLowerCase() === 'fill in'
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

    if (failures.length) {
      const failedDraft = await saveApprovalActivity(teamCheckCollection, draft.generationId, {
        status: 'failed',
        actor: approvalActor,
        startedAt: (await teamCheckCollection.findOne({
          _id: 'current',
          generationId: draft.generationId
        }))?.approvalActivity?.startedAt || new Date(),
        completedAt: new Date(),
        error: failures.join(' ').slice(0, 1000)
      });
      return {
        approved: false,
        round,
        warnings,
        failures,
        draft: failedDraft
      };
    }

    await completeCurrentDraftApproval({
      teamCheckCollection,
      roundCollection,
      generationId: draft.generationId
    });
    const completedDraft = await saveApprovalActivity(teamCheckCollection, draft.generationId, {
      status: 'sent',
      actor: approvalActor,
      startedAt: (await teamCheckCollection.findOne({
        _id: 'current',
        generationId: draft.generationId
      }))?.approvalActivity?.startedAt || new Date(),
      completedAt: new Date()
    });
    return {
      approved: true,
      round,
      warnings,
      draft: completedDraft
    };
  } catch (error) {
    if (changedGenerationId) {
      try {
        const existing = await teamCheckCollection.findOne({
          _id: 'current',
          generationId: changedGenerationId
        });
        if (existing?.approvalActivity?.status === 'sending') {
          await saveApprovalActivity(teamCheckCollection, changedGenerationId, {
            ...existing.approvalActivity,
            status: 'failed',
            completedAt: new Date(),
            error: String(error.message || 'Approval failed.').slice(0, 1000)
          });
        }
      } catch (statusError) {
        console.error('Could not save failed round approval status:', statusError);
      }
    }
    throw error;
  } finally {
    approvalRunning = false;
  }
}

module.exports = { approveLatestRound, subscribeRoundApprovalUpdates };
