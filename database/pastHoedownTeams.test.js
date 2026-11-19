const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findPastHoedownTeams,
  importPastHoedownTeamsRows,
  parsePastHoedownEventCsv,
  parsePastHoedownTeamsCsv
} = require('./pastHoedownTeams');

function csvBuffer(rows) {
  const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n'), 'utf8');
}

const csvRows = [
  ['Event ID', 'Event Name', 'Round', 'Team', 'Discord ID', 'Name'],
  ['2025-10-25', '10/25/2025 Hoedown', '1', 'A', '123456789012345678', 'Player One'],
  ['2025-10-25', '10/25/2025 Hoedown', '1', 'A', '234567890123456789', 'Player Two'],
  ['2025-10-25', '10/25/2025 Hoedown', '2', 'B', '123456789012345678', 'Player One']
];

test('groups historical team members into one document per event, round, and team', () => {
  assert.deepEqual(parsePastHoedownTeamsCsv(csvBuffer(csvRows)), [
    {
      _id: '2025-10-25:1:A',
      eventId: '2025-10-25',
      eventName: '10/25/2025 Hoedown',
      round: 1,
      team: 'A',
      members: [
        { discordId: '123456789012345678', name: 'Player One' },
        { discordId: '234567890123456789', name: 'Player Two' }
      ]
    },
    {
      _id: '2025-10-25:2:B',
      eventId: '2025-10-25',
      eventName: '10/25/2025 Hoedown',
      round: 2,
      team: 'B',
      members: [{ discordId: '123456789012345678', name: 'Player One' }]
    }
  ]);
});

test('rejects invalid IDs and inconsistent names before writing', () => {
  assert.throws(
    () => parsePastHoedownTeamsCsv(csvBuffer([
      csvRows[0],
      ['2025-10-25', '10/25/2025 Hoedown', '1', 'A', 'not-an-id', 'Player One']
    ])),
    /Discord ID must be/
  );
  assert.throws(
    () => parsePastHoedownTeamsCsv(csvBuffer([
      ...csvRows.slice(0, 3),
      ['2025-10-25', '10/25/2025 Hoedown', '1', 'A', '123456789012345678', 'Different Name']
    ])),
    /inconsistent names/
  );
});

test('imports Round columns from event-sheet CSV and ignores unrelated columns', () => {
  const members = [
    { _id: '123456789012345678', username: 'alice', region: 'East' },
    { _id: '234567890123456789', username: 'bob', region: 'West' }
  ];
  const teams = parsePastHoedownEventCsv(csvBuffer([
    ['Reacted Users', 'Current Round', 'Round #1', 'Round #2', 'Previous Pairings Ends at 2317'],
    ['ignored-user', 'Team A', 'Team A', 'Team B', ''],
    ['first-player', 'alice (East)', 'alice (East)', 'bob (West)', ''],
    ['second-player', 'bob (West)', 'Filler #1 (Filler)', '', '']
  ]), '2025-10-25', '10/25/2025 Hoedown', members);

  assert.deepEqual(teams, [
    {
      _id: '2025-10-25:1:A',
      eventId: '2025-10-25',
      eventName: '10/25/2025 Hoedown',
      round: 1,
      team: 'A',
      members: [
        { discordId: '123456789012345678', name: 'alice (East)' },
        { name: 'Filler #1 (Filler)' }
      ]
    },
    {
      _id: '2025-10-25:2:B',
      eventId: '2025-10-25',
      eventName: '10/25/2025 Hoedown',
      round: 2,
      team: 'B',
      members: [{ discordId: '234567890123456789', name: 'bob (West)' }]
    }
  ]);
});

test('upserts team snapshots by composite event, round, and team ID', async () => {
  let writeCollection;
  let writeOperations;
  const database = {
    collection(name) {
      return {
        async bulkWrite(operations) {
          writeCollection = name;
          writeOperations = operations;
          return { upsertedCount: 1, matchedCount: 1 };
        }
      };
    }
  };
  const teams = parsePastHoedownTeamsCsv(csvBuffer(csvRows));

  const result = await importPastHoedownTeamsRows(database, teams);
  assert.equal(writeCollection, 'PastHoedownTeams');
  assert.equal(result.teamCount, 2);
  assert.equal(result.memberCount, 3);
  assert.equal(writeOperations[0].updateOne.filter._id, '2025-10-25:1:A');
  assert.equal(writeOperations[0].updateOne.upsert, true);
  assert.deepEqual(writeOperations[0].updateOne.update.$set.members, teams[0].members);
});

test('queries teams for an event using the member Discord ID', async () => {
  let query;
  let sort;
  const expected = [{ round: 1, team: 'A' }];
  const database = {
    collection(name) {
      assert.equal(name, 'PastHoedownTeams');
      return {
        find(filter) {
          query = filter;
          return {
            sort(order) {
              sort = order;
              return { async toArray() { return expected; } };
            }
          };
        }
      };
    }
  };

  const result = await findPastHoedownTeams(database, '2025-10-25', '123456789012345678');
  assert.deepEqual(query, {
    eventId: '2025-10-25',
    'members.discordId': '123456789012345678'
  });
  assert.deepEqual(sort, { round: 1, team: 1 });
  assert.equal(result, expected);
});
