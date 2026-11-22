const assert = require('node:assert/strict');
const test = require('node:test');
const {
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  createCurrentTeamDraft,
  generateTeamGroups,
  recordPreviousPairings
} = require('./teamDrafts');

function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = key.includes('.')
      ? key.split('.').reduce((result, part) => result?.[part], document)
      : document[key];
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(actual);
    if (key.includes('.') && key.endsWith('.discordId') && Array.isArray(document[key.split('.')[0]])) {
      return document[key.split('.')[0]].some((entry) => entry.discordId === value);
    }
    return actual === value;
  });
}

function setPath(document, path, value) {
  const parts = path.split('.');
  let target = document;
  while (parts.length > 1) {
    const part = parts.shift();
    target[part] ||= {};
    target = target[part];
  }
  target[parts[0]] = value;
}

class MemoryCollection {
  constructor(documents = []) {
    this.documents = documents;
  }

  async findOne(filter = {}) {
    return this.documents.find((document) => matches(document, filter)) || null;
  }

  find(filter = {}) {
    return { toArray: async () => this.documents.filter((document) => matches(document, filter)) };
  }

  async replaceOne(filter, replacement) {
    const index = this.documents.findIndex((document) => matches(document, filter));
    if (index < 0) this.documents.push(replacement);
    else this.documents[index] = replacement;
    return { matchedCount: index < 0 ? 0 : 1 };
  }

  async insertOne(document) {
    if (this.documents.some((entry) => entry._id === document._id)) {
      const error = new Error('Duplicate _id');
      error.code = 11000;
      throw error;
    }
    this.documents.push(document);
    return { insertedId: document._id };
  }

  async updateOne(filter, update, options = {}) {
    let document = this.documents.find((entry) => matches(entry, filter));
    if (!document && options.upsert) {
      document = { _id: filter._id };
      this.documents.push(document);
    }
    if (!document) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) setPath(document, path, value);
    for (const [path, value] of Object.entries(update.$addToSet || {})) {
      const parts = path.split('.');
      const key = parts.pop();
      const parent = parts.reduce((result, part) => result[part], document);
      parent[key] ||= [];
      const target = parent[key];
      if (!target.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) target.push(value);
    }
    return { matchedCount: 1 };
  }
}

function createCollections() {
  const rounds = new Map();
  return {
    members: new MemoryCollection([
      { _id: '10000000000000001', username: 'one', nickname: 'One', region: 'East' },
      { _id: '10000000000000002', username: 'two', nickname: 'Two', region: 'East' },
      { _id: '10000000000000003', username: 'three', nickname: 'Three', region: 'East' }
    ]),
    avoids: new MemoryCollection(),
    previousPairings: new MemoryCollection(),
    playersThatReacted: new MemoryCollection(),
    teamCheck: new MemoryCollection(),
    roundsDatabase: {
      collection(name) {
        if (!rounds.has(name)) rounds.set(name, new MemoryCollection());
        return rounds.get(name);
      }
    }
  };
}

async function createDraft(collections, sourceMessageId = 'message-1') {
  return createCurrentTeamDraft({
    reactedPlayers: [
      { id: '10000000000000001', name: 'one' },
      { id: '10000000000000002', name: 'two' },
      { id: '10000000000000003', name: 'three' }
    ],
    sourceMessageId,
    membersCollection: collections.members,
    avoidsCollection: collections.avoids,
    previousPairingsCollection: collections.previousPairings,
    playersThatReactedCollection: collections.playersThatReacted,
    teamCheckCollection: collections.teamCheck,
    roundsDatabase: collections.roundsDatabase,
    random: () => 0
  });
}

test('team generation fills teams to three without mixing East and West', () => {
  const result = generateTeamGroups([
    { discordId: '1', name: 'East player', region: 'East' },
    { discordId: '2', name: 'West player', region: 'West' },
    { discordId: '3', name: 'Both player', region: 'Both' }
  ], { random: () => 0 });

  assert.ok(result.teams.length > 0);
  for (const team of result.teams) {
    assert.equal(team.players.length, 3);
    const regions = new Set(team.players.map((player) => player.region));
    assert.ok(!(regions.has('East') && regions.has('West')));
  }
});

test('a new generation replaces current snapshots and uses the next unfilled round', async () => {
  const collections = createCollections();
  const firstDraft = await createDraft(collections);
  assert.equal(firstDraft.round, 1);
  assert.equal(collections.teamCheck.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents[0].players.length, 3);

  await collections.teamCheck.updateOne({ _id: 'current' }, {
    $set: { status: 'approved' }
  });
  await collections.roundsDatabase.collection('Round 1').insertOne({
    _id: 'current',
    generationId: firstDraft.generationId,
    status: 'approved',
    nextTeamIndex: firstDraft.nextTeamIndex,
    teams: firstDraft.teams
  });

  const secondDraft = await createDraft(collections, 'message-2');
  assert.equal(secondDraft.round, 2);
  assert.notEqual(secondDraft.generationId, firstDraft.generationId);
  assert.equal(collections.teamCheck.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents[0].sourceMessageId, 'message-2');
});

test('approval saves round data, records pairings once, and finalizes both snapshots', async () => {
  const collections = createCollections();
  const draft = await createDraft(collections);
  const approval = await beginCurrentDraftApproval({
    teamCheckCollection: collections.teamCheck,
    roundsDatabase: collections.roundsDatabase,
    round: draft.round
  });

  assert.equal(approval.roundRecord.status, 'approving');
  assert.deepEqual(approval.roundRecord.teams, draft.teams);

  await recordPreviousPairings(collections.previousPairings, draft.teams);
  await recordPreviousPairings(collections.previousPairings, draft.teams);
  assert.equal(collections.previousPairings.documents.length, 3);
  assert.ok(collections.previousPairings.documents.every((entry) => entry.previousPairings.length === 2));

  await completeCurrentDraftApproval({
    teamCheckCollection: collections.teamCheck,
    roundCollection: approval.roundCollection,
    generationId: draft.generationId
  });
  assert.equal((await approval.roundCollection.findOne({ _id: 'current' })).status, 'approved');
  assert.equal((await collections.teamCheck.findOne({ _id: 'current' })).status, 'approved');
});
