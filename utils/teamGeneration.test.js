const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TeamGenerationError,
  clearTeamCheckChannel,
  generateTeamDraftFromMessage
} = require('./teamGeneration');

function messageCollection(messages) {
  return {
    size: messages.length,
    first: () => messages[0],
    last: () => messages[messages.length - 1],
    filter: (predicate) => messageCollection(messages.filter(predicate)),
    values: () => messages.values()
  };
}

test('clears recent and old messages from the Team Check channel', async () => {
  const now = Date.now();
  const recentMessages = Array.from({ length: 100 }, (_, index) => ({
    id: `recent-${index}`,
    createdTimestamp: now - 1000,
    delete: async () => {}
  }));
  let olderMessageDeleted = false;
  const olderMessage = {
    id: 'older-message',
    createdTimestamp: now - 15 * 24 * 60 * 60 * 1000,
    delete: async () => { olderMessageDeleted = true; }
  };
  const fetchCalls = [];
  let bulkDeletedCount = 0;
  const channel = {
    messages: {
      fetch: async (options) => {
        fetchCalls.push(options);
        return options.before
          ? messageCollection([olderMessage])
          : messageCollection(recentMessages);
      }
    },
    bulkDelete: async (messages, filterOld) => {
      assert.equal(filterOld, true);
      bulkDeletedCount += messages.size;
      return messages;
    }
  };

  const deletedCount = await clearTeamCheckChannel(channel, () => now);

  assert.equal(deletedCount, 101);
  assert.equal(bulkDeletedCount, 100);
  assert.equal(olderMessageDeleted, true);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].before, 'recent-99');
});

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
          messages: { fetch: async () => messageCollection([]) },
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
  assert.match(previewMessages.join('\n'), /Player 1 × Player 2|Player 2 × Player 1/);
});
