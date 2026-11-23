const assert = require('node:assert/strict');
const test = require('node:test');
const { TeamGenerationError, generateTeamDraftFromMessage } = require('./teamGeneration');

test('stores captured reactors before profile validation can fail', async () => {
  const discordId = '12345678901234567';
  const users = new Map([[discordId, {
    id: discordId,
    username: 'reacted-user',
    bot: false
  }]]);
  let savedSnapshot;
  const emptyCollection = {
    findOne: async () => null,
    find: () => ({ toArray: async () => [] })
  };
  const collections = {
    members: emptyCollection,
    avoids: emptyCollection,
    previousPairings: emptyCollection,
    teamCheck: emptyCollection,
    playersThatReacted: {
      replaceOne: async (_filter, replacement) => {
        savedSnapshot = replacement;
        return { matchedCount: 0, upsertedCount: 1 };
      }
    }
  };

  await assert.rejects(generateTeamDraftFromMessage({
    message: {
      id: 'source-message',
      reactions: {
        cache: new Map([['👍', {
          users: { fetch: async () => users }
        }]])
      }
    },
    botSettings: {
      channels: {},
      grabReactions: { ENABLE_TEAM_CHECK_POSTING: false }
    },
    config: {},
    collections,
    roundsDatabase: { collection: () => emptyCollection }
  }), (error) => {
    assert.ok(error instanceof TeamGenerationError);
    assert.equal(error.statusCode, 422);
    return true;
  });

  assert.equal(savedSnapshot._id, 'current');
  assert.equal(savedSnapshot.sourceMessageId, 'source-message');
  assert.equal(savedSnapshot.captureStatus, 'captured');
  assert.deepEqual(savedSnapshot.players, [{
    discordId,
    username: 'reacted-user',
    name: 'reacted-user'
  }]);
});

test('posts the best available draft with Avoid warnings when no Avoid-free assignment exists', async () => {
  const players = ['10000000000000001', '10000000000000002', '10000000000000003'];
  const users = new Map(players.map((id, index) => [id, {
    id,
    username: `player-${index + 1}`,
    bot: false
  }]));
  const memberDocuments = players.map((id, index) => ({
    _id: id,
    username: `player-${index + 1}`,
    nickname: `Player ${index + 1}`,
    region: 'East'
  }));
  const avoidDocuments = players.slice(0, -1).map((id, index) => ({
    _id: id,
    avoids: players.slice(index + 1).map((discordId) => ({ discordId }))
  }));
  const emptyCollection = {
    findOne: async () => null,
    find: () => ({ toArray: async () => [] })
  };
  let currentDraft = null;
  const teamCheckCollection = {
    findOne: async () => currentDraft,
    insertOne: async (draft) => {
      currentDraft = draft;
      return { insertedId: draft._id };
    },
    updateOne: async (filter, update) => {
      if (!currentDraft || currentDraft.generationId !== filter.generationId ||
          (filter.status && currentDraft.status !== filter.status)) {
        return { matchedCount: 0 };
      }
      Object.assign(currentDraft, update.$set);
      return { matchedCount: 1 };
    }
  };
  const previewMessages = [];
  const collections = {
    members: {
      find: () => ({ toArray: async () => memberDocuments })
    },
    avoids: {
      find: () => ({ toArray: async () => avoidDocuments })
    },
    previousPairings: emptyCollection,
    teamCheck: teamCheckCollection,
    playersThatReacted: { replaceOne: async () => ({ matchedCount: 0, upsertedCount: 1 }) }
  };

  const result = await generateTeamDraftFromMessage({
    message: {
      id: 'avoid-search-limit',
      reactions: {
        cache: new Map([['👍', {
          users: { fetch: async () => users }
        }]])
      }
    },
    client: {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async (content) => {
            previewMessages.push(content);
            return { id: `preview-${previewMessages.length}` };
          }
        })
      }
    },
    botSettings: {
      channels: { TeamCheckChannelID: 'team-check-channel' },
      grabReactions: { ENABLE_TEAM_CHECK_POSTING: true }
    },
    config: {},
    collections,
    roundsDatabase: { collection: () => emptyCollection }
  });

  assert.equal(result.draft.status, 'pending');
  assert.equal(result.draft.checks.unresolvedAvoids, 3);
  assert.equal(result.postingStatus, 'posted');
  assert.equal(currentDraft.previewStatus, 'posted');
  assert.match(previewMessages.join('\n'), /Avoid Pairings Found \(3\)/);
  assert.match(previewMessages.join('\n'), /Player 1 × Player 2/);
});
