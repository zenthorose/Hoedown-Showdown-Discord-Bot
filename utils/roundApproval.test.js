const assert = require('node:assert/strict');
const test = require('node:test');
const { approveLatestRound } = require('./roundApproval');

class MemoryCollection {
  constructor(documents = []) {
    this.documents = documents;
  }

  async findOne(filter = {}) {
    return this.documents.find((document) =>
      Object.entries(filter).every(([key, value]) =>
        value && typeof value === 'object' && '$in' in value
          ? value.$in.includes(document[key])
          : document[key] === value
      )
    ) || null;
  }

  async insertOne(document) {
    this.documents.push(document);
    return { insertedId: document._id };
  }

  async updateOne(filter, update) {
    const document = this.documents.find((entry) =>
      Object.entries(filter).every(([key, value]) =>
        value && typeof value === 'object' && '$in' in value
          ? value.$in.includes(entry[key])
          : entry[key] === value
      )
    );
    if (!document) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) {
      const parts = path.split('.');
      let target = document;
      while (parts.length > 1) {
        const key = parts.shift();
        target[key] ||= {};
        target = target[key];
      }
      target[parts[0]] = value;
    }
    return { matchedCount: 1 };
  }
}

function createApprovalFixture(settingsOverrides = {}, options = {}) {
  const teamCheckCollection = new MemoryCollection([{
    _id: 'current',
    generationId: 'generation-round-9',
    round: 9,
    status: 'pending',
    teams: [{
      name: 'A',
      players: [
        { discordId: '10000000000000001', name: 'Player 1', region: 'East' },
        { discordId: '10000000000000002', name: 'Player 2', region: 'East' },
        { discordId: '10000000000000003', name: 'Player 3', region: 'East' }
      ]
    }, {
      name: 'B',
      players: [
        { discordId: '10000000000000004', name: 'Player 4', region: 'East' },
        { name: 'Filler #1', region: 'Filler' },
        { name: 'Filler #2', region: 'Filler' }
      ]
    }]
  }]);
  const roundCollections = new Map();
  let sendAttempts = 0;
  const roundsDatabase = {
    collection(name) {
      if (!roundCollections.has(name)) roundCollections.set(name, new MemoryCollection());
      return roundCollections.get(name);
    }
  };
  const postedMessages = [];
  const channelMap = new Map();
  const discordClient = {
    isReady: () => true,
    channels: {
      fetch: async (id) => {
        if (!channelMap.has(id)) {
          channelMap.set(id, {
            isTextBased: () => true,
            send: async (content) => {
              sendAttempts += 1;
              if (options.failFirstSend && sendAttempts === 1) {
                throw new Error('Temporary Discord failure');
              }
              const message = { id: `message-${postedMessages.length + 1}`, content };
              postedMessages.push(message);
              return message;
            }
          });
        }
        return channelMap.get(id);
      }
    }
  };
  const flags = {
    ENABLE_ROUND_CHANNEL_PERMS: false,
    ENABLE_TEAM_CLEANUP: false,
    ENABLE_VC_RESET: false,
    ENABLE_TEAM_POSTING_PERMS: false,
    ENABLE_DISCORD_POSTING: false,
    ...settingsOverrides
  };
  return {
    teamCheckCollection,
    roundsDatabase,
    roundCollections,
    postedMessages,
    discordClient,
    input: {
      teamCheckCollection,
      roundsDatabase,
      previousPairingsCollection: new MemoryCollection(),
      botSettings: {
        approveRound: flags,
        channels: {
          roundChannels: { 9: 'round-channel' },
          teamChannels: { 'Team A': 'team-a', 'Team B': 'team-b' }
        }
      },
      discordClient,
      guild: {
        roles: {
          everyone: { id: 'everyone' },
          cache: { find: () => null }
        }
      }
    },
    options
  };
}

test('approval uses the current draft round and honors disabled action settings', async () => {
  const fixture = createApprovalFixture();
  const result = await approveLatestRound({
    ...fixture.input,
    actor: {
      discordId: '123456789012345678',
      username: 'test.admin',
      discordUsername: 'Test Admin',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/avatar.png'
    }
  });

  assert.equal(result.approved, true);
  assert.equal(result.round, 9);
  assert.equal(fixture.roundCollections.has('Round#09'), true);
  assert.equal((await fixture.teamCheckCollection.findOne({ _id: 'current' })).status, 'approved');
  assert.equal(result.draft.approvalActivity.status, 'sent');
  assert.equal(result.draft.approvalActivity.actor.username, 'test.admin');
  assert.equal(result.draft.approvalActivity.actor.avatarUrl,
    'https://cdn.discordapp.com/avatars/123456789012345678/avatar.png');
  assert.equal(fixture.postedMessages.length, 0);
});

test('approval applies the Discord posting setting and retries incomplete work', async () => {
  const fixture = createApprovalFixture({ ENABLE_DISCORD_POSTING: true }, { failFirstSend: true });

  const incomplete = await approveLatestRound(fixture.input);
  assert.equal(incomplete.approved, false);
  assert.equal(incomplete.round, 9);
  assert.equal(incomplete.draft.status, 'approving');
  assert.equal(incomplete.draft.approvalActivity.status, 'failed');
  assert.equal(fixture.postedMessages.length, 2);

  const retry = await approveLatestRound(fixture.input);
  assert.equal(retry.approved, true);
  assert.equal(retry.draft.status, 'approved');
  assert.equal(fixture.postedMessages.length, 3);
  assert.equal(fixture.postedMessages.some((message) => message.content.includes('Final Teams')), true);
});
