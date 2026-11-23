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
