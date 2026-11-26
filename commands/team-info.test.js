const assert = require('node:assert/strict');
const test = require('node:test');
const { roundCollectionName } = require('../database/roundCollections');
const { findLatestApprovedRound } = require('./team-info');

function createRoundsDatabase(records) {
  const queriedRounds = [];
  return {
    queriedRounds,
    collection(name) {
      return {
        async findOne(filter) {
          queriedRounds.push(name);
          const record = records.get(name);
          return record?._id === filter._id && record.status === filter.status
            ? record
            : null;
        }
      };
    }
  };
}

test('team-info selects the highest approved round and skips pending snapshots', async () => {
  const latestApproved = {
    _id: 'current',
    round: 14,
    status: 'approved',
    teams: [{ name: 'A', players: [{ name: 'Player One' }] }]
  };
  const database = createRoundsDatabase(new Map([
    [roundCollectionName(16), { _id: 'current', round: 16, status: 'approving' }],
    [roundCollectionName(14), latestApproved],
    [roundCollectionName(12), { _id: 'current', round: 12, status: 'approved' }]
  ]));

  const result = await findLatestApprovedRound(database);

  assert.equal(result.round, 14);
  assert.deepEqual(result.teams, latestApproved.teams);
  assert.deepEqual(database.queriedRounds, [
    roundCollectionName(16),
    roundCollectionName(15),
    roundCollectionName(14)
  ]);
});

test('team-info returns null when no approved round exists', async () => {
  const database = createRoundsDatabase(new Map([
    [roundCollectionName(16), { _id: 'current', round: 16, status: 'approving' }]
  ]));

  assert.equal(await findLatestApprovedRound(database), null);
});
