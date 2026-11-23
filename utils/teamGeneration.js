const {
  createCurrentTeamDraft,
  formatTeamCheckPreview,
  saveReactedPlayersSnapshot,
  splitDiscordMessage
} = require('../database/teamDrafts');
const { collectOptInReactors } = require('./optInReactions');

class TeamGenerationError extends Error {
  constructor(message, statusCode = 503, partial = false, round = null) {
    super(message);
    this.name = 'TeamGenerationError';
    this.statusCode = statusCode;
    this.partial = partial;
    this.round = round;
  }
}

let generationRunning = false;

async function clearTeamCheckChannel(channel, now = Date.now) {
  const bulkDeleteCutoff = now() - 14 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  let before;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;

    const oldestMessage = messages.last();
    const recentMessages = messages.filter((message) =>
      Number.isFinite(message.createdTimestamp) &&
      message.createdTimestamp >= bulkDeleteCutoff
    );
    if (recentMessages.size > 1) {
      const deleted = await channel.bulkDelete(recentMessages, true);
      deletedCount += deleted.size;
    } else if (recentMessages.size === 1) {
      await recentMessages.first().delete();
      deletedCount += 1;
    }

    for (const message of messages.values()) {
      if (Number.isFinite(message.createdTimestamp) &&
          message.createdTimestamp >= bulkDeleteCutoff) continue;
      try {
        await message.delete();
        deletedCount += 1;
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }

    before = oldestMessage.id;
    if (messages.size < 100) break;
  }

  return deletedCount;
}

async function generateTeamDraftFromMessage({
  message,
  client,
  botSettings,
  config,
  collections,
  roundsDatabase,
  targetRound
}) {
  if (generationRunning) {
    throw new TeamGenerationError('A team generation is already running. Please wait for it to finish.', 409);
  }
  generationRunning = true;

  try {
    const reactedPlayers = await collectOptInReactors(message);
    await saveReactedPlayersSnapshot({
      playersThatReactedCollection: collections.playersThatReacted,
      reactedPlayers,
      sourceMessageId: message.id
    });

    const teamCheckChannelId = botSettings.channels.TeamCheckChannelID ||
      config.TeamCheckChannelID ||
      process.env.TEAM_CHECK_CHANNEL_ID;
    if (botSettings.grabReactions.ENABLE_TEAM_CHECK_POSTING && !teamCheckChannelId) {
      throw new TeamGenerationError(
        'Set channels.TeamCheckChannelID in bot settings or TeamCheckChannelID in config.json before posting Team Check previews.'
      );
    }

    let draft;
    try {
      draft = await createCurrentTeamDraft({
        reactedPlayers,
        sourceMessageId: message.id,
        membersCollection: collections.members,
        avoidsCollection: collections.avoids,
        previousPairingsCollection: collections.previousPairings,
        playersThatReactedCollection: collections.playersThatReacted,
        teamCheckCollection: collections.teamCheck,
        roundsDatabase,
        previewChannelId: teamCheckChannelId,
        targetRound
      });
    } catch (error) {
      if ([
        'No eligible Discord users reacted to the selected message.',
        'None of the reacted users have a registered profile with a valid region.'
      ].includes(error.message)) {
        throw new TeamGenerationError(error.message, 422);
      }
      throw error;
    }

    let postingStatus = 'disabled';
    if (botSettings.grabReactions.ENABLE_TEAM_CHECK_POSTING) {
      try {
        const teamCheckChannel = await client.channels.fetch(teamCheckChannelId);
        if (!teamCheckChannel || !teamCheckChannel.isTextBased()) {
          throw new Error(`Team Check channel is not a text channel: ${teamCheckChannelId}`);
        }

        await clearTeamCheckChannel(teamCheckChannel);
        const messageIds = [];
        for (const content of splitDiscordMessage(formatTeamCheckPreview(draft))) {
          const posted = await teamCheckChannel.send(content);
          messageIds.push(posted.id);
          const update = await collections.teamCheck.updateOne({
            _id: 'current',
            generationId: draft.generationId
          }, {
            $set: { previewMessageIds: messageIds, previewStatus: 'posting' }
          });
          if (!update.matchedCount) {
            throw new Error('The saved Team Check draft changed while posting its preview.');
          }
        }
        postingStatus = 'posted';
        const update = await collections.teamCheck.updateOne({
          _id: 'current',
          generationId: draft.generationId
        }, {
          $set: { previewStatus: postingStatus }
        });
        if (!update.matchedCount) {
          throw new Error('The saved Team Check draft changed after posting its preview.');
        }
      } catch (error) {
        try {
          const update = await collections.teamCheck.updateOne({
            _id: 'current',
            generationId: draft.generationId
          }, {
            $set: {
              previewStatus: 'failed',
              previewError: String(error.message).slice(0, 1000)
            }
          });
          if (!update.matchedCount) {
            throw new Error('The current draft no longer matches this preview generation.');
          }
        } catch (statusError) {
          throw new TeamGenerationError(
            `Draft for Round #${draft.round} was saved, but preview posting failed (${error.message}) and the failure status could not be recorded (${statusError.message}).`,
            502,
            true,
            draft.round
          );
        }
        throw new TeamGenerationError(
          `Draft for Round #${draft.round} was saved, but Team Check preview posting failed: ${error.message}`,
          502,
          true,
          draft.round
        );
      }
    } else {
      const update = await collections.teamCheck.updateOne({
        _id: 'current',
        generationId: draft.generationId
      }, {
        $set: { previewStatus: postingStatus }
      });
      if (!update.matchedCount) {
        throw new Error('The saved Team Check draft changed before its posting status was recorded.');
      }
    }

    return { draft, postingStatus };
  } finally {
    generationRunning = false;
  }
}

module.exports = {
  TeamGenerationError,
  clearTeamCheckChannel,
  generateTeamDraftFromMessage
};
