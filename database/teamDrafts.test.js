const assert = require('node:assert/strict');
const test = require('node:test');
const {
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  createCurrentTeamDraft,
  formatTeamCheckPreview,
  generateTeamGroups,
  inspectTeams,
  recordCurrentDraftReview,
  recordCurrentDraftViewer,
  recordPreviousPairings,
  swapCurrentDraftPlayers
} = require('./teamDrafts');

function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = key.includes('.')
      ? key.split('.').reduce((result, part) => result?.[part], document)
      : document[key];
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(actual);
    if (value && typeof value === 'object' && '$exists' in value) {
      return Object.prototype.hasOwnProperty.call(document, key) === value.$exists;
    }
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

  async replaceOne(filter, replacement, options = {}) {
    const index = this.documents.findIndex((document) => matches(document, filter));
    if (index < 0) {
      if (options.upsert) this.documents.push(replacement);
      return { matchedCount: 0 };
    }
    this.documents[index] = replacement;
    return { matchedCount: 1 };
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

async function createDraft(collections, sourceMessageId = 'message-1', targetRound) {
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
    targetRound,
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

test('team audit rejects East and West on the same team even when Both is present', () => {
  const teams = [{
    name: 'A',
    players: [
      { discordId: '1', name: 'East player', region: 'East' },
      { discordId: '2', name: 'West player', region: 'West' },
      { discordId: '3', name: 'Both player', region: 'Both' }
    ]
  }];
  const audit = inspectTeams(teams, new Set(), new Set());

  assert.deepEqual(audit.regionErrors, ['A']);
});

test('team assignment treats Avoids as hard constraints and reduces previous pairings afterward', () => {
  const players = Array.from({ length: 6 }, (_, index) => ({
    discordId: String(index + 1),
    name: `Player ${index + 1}`,
    region: 'East'
  }));
  const result = generateTeamGroups(players, {
    avoids: new Set(['1|2']),
    previousPairings: new Set(['2|3']),
    random: () => 0
  });

  assert.equal(result.unresolvedAvoids, 0);
  assert.equal(result.unresolvedPrevious, 0);
  assert.ok(result.teams.every((team) =>
    !team.players.some((player) => player.discordId === '1') ||
    !team.players.some((player) => player.discordId === '2')
  ));
});

test('team assignment returns the best teams with Avoid warnings when no Avoid-free assignment exists', () => {
  const players = [
    { discordId: '1', name: 'One', region: 'East' },
    { discordId: '2', name: 'Two', region: 'East' },
    { discordId: '3', name: 'Three', region: 'East' }
  ];

  const result = generateTeamGroups(players, {
    avoids: new Set(['1|2', '1|3', '2|3']),
    random: () => 0
  });

  assert.equal(result.unresolvedAvoids, 3);
  assert.equal(result.finalAudit.avoidConflicts.length, 3);
  assert.match(formatTeamCheckPreview({
    round: 1,
    teams: result.teams,
    checks: { final: result.finalAudit }
  }), /Avoid Pairings Found \(3\)/);
});

test('multi-start assignment eliminates prior pairings for a 130-player roster when possible', () => {
  const players = Array.from({ length: 130 }, (_, index) => ({
    discordId: String(index + 1),
    name: `Player ${index + 1}`,
    region: 'East'
  }));
  const priorTeams = generateTeamGroups(players, { random: () => 0 }).teams;
  const previousPairings = new Set();
  for (const team of priorTeams) {
    const activePlayers = team.players.filter((player) => player.region !== 'Filler');
    for (let left = 0; left < activePlayers.length; left += 1) {
      for (let right = left + 1; right < activePlayers.length; right += 1) {
        previousPairings.add([
          activePlayers[left].discordId,
          activePlayers[right].discordId
        ].sort().join('|'));
      }
    }
  }

  const result = generateTeamGroups(players, { previousPairings, random: () => 0 });

  assert.equal(result.teams.length, 44);
  assert.equal(result.unresolvedAvoids, 0);
  assert.equal(result.unresolvedPrevious, 0);
  assert.equal(result.pairingSearchLimitReached, false);
});

test('a new generation replaces current snapshots and uses the next sequential round', async () => {
  const collections = createCollections();
  const firstDraft = await createDraft(collections);
  assert.equal(firstDraft.round, 1);
  assert.equal(collections.teamCheck.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents.length, 1);
  assert.equal(collections.playersThatReacted.documents[0].players.length, 3);

  await collections.teamCheck.updateOne({ _id: 'current' }, {
    $set: { status: 'approved' }
  });

  await collections.roundsDatabase.collection('Round#01').insertOne({
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

test('generation cannot replace a current draft after approval claims it', async () => {
  const collections = createCollections();
  const originalDraft = await createDraft(collections);
  const findMembers = collections.members.find.bind(collections.members);
  let markLookupStarted;
  let releaseLookup;
  const lookupStarted = new Promise((resolve) => { markLookupStarted = resolve; });
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  collections.members.find = (filter) => {
    const query = findMembers(filter);
    return {
      toArray: async () => {
        markLookupStarted();
        await lookupGate;
        return query.toArray();
      }
    };
  };

  const nextGeneration = createDraft(collections, 'message-2');
  await lookupStarted;
  const approval = await beginCurrentDraftApproval({
    teamCheckCollection: collections.teamCheck,
    roundsDatabase: collections.roundsDatabase,
    round: originalDraft.round
  });
  releaseLookup();

  await assert.rejects(nextGeneration, /draft changed while teams were being generated/);
  const currentDraft = await collections.teamCheck.findOne({ _id: 'current' });
  assert.equal(currentDraft.generationId, originalDraft.generationId);
  assert.equal(currentDraft.status, 'approving');
  assert.equal(approval.roundRecord.generationId, originalDraft.generationId);
  assert.equal(collections.playersThatReacted.documents[0].sourceMessageId, 'message-1');
});

test('a new generation uses the round after the highest populated collection when there is a gap', async () => {
  const collections = createCollections();
  await collections.roundsDatabase.collection('Round#01').insertOne({ _id: 'current', status: 'approved' });
  await collections.roundsDatabase.collection('Round#03').insertOne({ _id: 'current', status: 'approved' });

  const draft = await createDraft(collections);

  assert.equal(draft.round, 4);
});

test('the Rounds action target overrides a pending draft round', async () => {
  const collections = createCollections();
  const pendingDraft = await createDraft(collections);
  assert.equal(pendingDraft.round, 1);
  await collections.roundsDatabase.collection('Round#01').insertOne({
    _id: 'round-selection-test',
    testOnly: true
  });

  const nextDraft = await createDraft(collections, 'message-2', 2);

  assert.equal(nextDraft.round, 2);
  assert.equal(nextDraft.sourceMessageId, 'message-2');
});

test('approval saves round data, records pairings once, and finalizes both snapshots', async () => {
  const collections = createCollections();
  const draft = await createDraft(collections);
  const approval = await beginCurrentDraftApproval({
    teamCheckCollection: collections.teamCheck,
    roundsDatabase: collections.roundsDatabase,
    round: draft.round
  });

  assert.equal(approval.roundCollection, collections.roundsDatabase.collection('Round#01'));
  assert.equal(approval.roundRecord.status, 'approving');
  assert.deepEqual(approval.roundRecord.teams, draft.teams);

  await recordPreviousPairings(collections.previousPairings, draft.teams);
  await recordPreviousPairings(collections.previousPairings, draft.teams);
  assert.equal(collections.previousPairings.documents.length, 3);
  assert.ok(collections.previousPairings.documents.every((entry) => entry.previousPairings.length === 2));
  await collections.teamCheck.updateOne({ _id: 'current' }, {
    $set: { reviewActivity: [{ discordId: '10000000000000004', vote: 'approve' }] }
  });

  await completeCurrentDraftApproval({
    teamCheckCollection: collections.teamCheck,
    roundCollection: approval.roundCollection,
    generationId: draft.generationId
  });
  assert.equal((await approval.roundCollection.findOne({ _id: 'current' })).status, 'approved');
  const completedDraft = await collections.teamCheck.findOne({ _id: 'current' });
  assert.equal(completedDraft.status, 'approved');
  assert.deepEqual(completedDraft.reviewActivity, []);
});

test('draft review tracks multiple viewers and resets marks after a team swap', async () => {
  const teamCheckCollection = new MemoryCollection([{
    _id: 'current',
    generationId: 'generation-1',
    status: 'pending',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    teams: [
      {
        name: 'A',
        players: [
          { discordId: '10000000000000001', name: 'Player 1', region: 'East' },
          { discordId: '10000000000000002', name: 'Player 2', region: 'East' },
          { discordId: '10000000000000003', name: 'Player 3', region: 'East' }
        ]
      },
      {
        name: 'B',
        players: [
          { discordId: '10000000000000004', name: 'Player 4', region: 'East' },
          { discordId: '10000000000000005', name: 'Player 5', region: 'East' },
          { name: 'Filler', region: 'Filler' }
        ]
      }
    ],
    checks: { final: { avoidConflicts: [], previousConflicts: [], regionErrors: [] } },
    reviewActivity: []
  }]);
  const avoidsCollection = new MemoryCollection([{
    _id: '10000000000000001',
    avoids: [{ discordId: '10000000000000004' }]
  }]);
  const previousPairingsCollection = new MemoryCollection();
  const reviewerOne = {
    discordId: '10000000000000006',
    username: 'reviewer-one',
    discordUsername: 'reviewer.one',
    avatarUrl: ''
  };
  const reviewerTwo = {
    discordId: '10000000000000007',
    username: 'reviewer-two',
    discordUsername: 'reviewer.two',
    avatarUrl: ''
  };

  await recordCurrentDraftViewer({
    teamCheckCollection,
    generationId: 'generation-1',
    reviewer: reviewerOne,
    now: () => new Date('2026-03-01T00:01:00.000Z')
  });
  await recordCurrentDraftReview({
    teamCheckCollection,
    generationId: 'generation-1',
    reviewer: reviewerOne,
    vote: 'approve',
    now: () => new Date('2026-03-01T00:02:00.000Z')
  });
  await recordCurrentDraftViewer({
    teamCheckCollection,
    generationId: 'generation-1',
    reviewer: reviewerTwo,
    now: () => new Date('2026-03-01T00:03:00.000Z')
  });

  const updatedDraft = await swapCurrentDraftPlayers({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId: 'generation-1',
    playerDiscordId: '10000000000000001',
    targetTeamName: 'B',
    targetSlotIndex: 2,
    targetDiscordId: '',
    now: () => new Date('2026-03-01T00:04:00.000Z')
  });

  assert.equal(updatedDraft.teams[0].players.length, 3);
  assert.equal(updatedDraft.teams[1].players.length, 3);
  assert.equal(updatedDraft.teams[1].players[2].discordId, '10000000000000001');
  assert.equal(updatedDraft.checks.unresolvedAvoids, 1);
  assert.deepEqual(
    [updatedDraft.checks.final.avoidConflicts[0].playerA,
      updatedDraft.checks.final.avoidConflicts[0].playerB].sort(),
    ['Player 1', 'Player 4']
  );
  assert.deepEqual(updatedDraft.reviewActivity.map((entry) => entry.vote), [null, null]);
});

test('draft adjustment rejects swaps that would mix East and West teams', async () => {
  const teamCheckCollection = new MemoryCollection([{
    _id: 'current',
    generationId: 'generation-region-1',
    status: 'pending',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    teams: [
      {
        name: 'A',
        players: [
          { discordId: '10000000000000001', name: 'East player', region: 'East' },
          { discordId: '10000000000000002', name: 'East player 2', region: 'East' },
          { discordId: '10000000000000003', name: 'East player 3', region: 'East' }
        ]
      },
      {
        name: 'B',
        players: [
          { discordId: '10000000000000004', name: 'West player', region: 'West' },
          { discordId: '10000000000000005', name: 'West player 2', region: 'West' },
          { name: 'Filler', region: 'Filler' }
        ]
      }
    ],
    checks: { final: { avoidConflicts: [], previousConflicts: [], regionErrors: [] } }
  }]);

  await assert.rejects(swapCurrentDraftPlayers({
    teamCheckCollection,
    avoidsCollection: new MemoryCollection(),
    previousPairingsCollection: new MemoryCollection(),
    generationId: 'generation-region-1',
    playerDiscordId: '10000000000000001',
    targetTeamName: 'B',
    targetSlotIndex: 2,
    targetDiscordId: ''
  }), /mix East and West/);
  assert.equal((await teamCheckCollection.findOne({ _id: 'current' })).teams[1].players[2].region, 'Filler');
});
