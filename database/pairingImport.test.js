const assert = require('node:assert/strict');
const test = require('node:test');
const { importPairingRows, parseAvoidsCsv, parsePreviousPairingsCsv } = require('./pairingImport');

function csvBuffer(rows) {
  const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n'), 'utf8');
}

const sourceRows = [
  ['431892857453019148', '507683691586387979', 'zachary_zlt', 'heavymetalqueenie'],
  ['431892857453019148', '133606854910541824', 'zachary_zlt', 'mr_jam_jar'],
  ['839304775706345472', '246050147824435201', '.yharet', 'nerfthedoctor']
];

test('groups Avoids by the first Discord ID and preserves the matching names', () => {
  assert.deepEqual(parseAvoidsCsv(csvBuffer(sourceRows)), [
    {
      _id: '431892857453019148',
      name: 'zachary_zlt',
      avoids: [
        { discordId: '507683691586387979', name: 'heavymetalqueenie' },
        { discordId: '133606854910541824', name: 'mr_jam_jar' }
      ]
    },
    {
      _id: '839304775706345472',
      name: '.yharet',
      avoids: [{ discordId: '246050147824435201', name: 'nerfthedoctor' }]
    }
  ]);
});

test('parses headered PreviousPairings CSV into the same left-ID grouping', () => {
  assert.deepEqual(parsePreviousPairingsCsv(csvBuffer([
    ['Left Discord ID', 'Right Discord ID', 'Left Name', 'Right Name'],
    ...sourceRows.slice(0, 2)
  ])), [
    {
      _id: '431892857453019148',
      name: 'zachary_zlt',
      previousPairings: [
        { discordId: '507683691586387979', name: 'heavymetalqueenie' },
        { discordId: '133606854910541824', name: 'mr_jam_jar' }
      ]
    },
    {
      _id: '507683691586387979',
      name: 'heavymetalqueenie',
      previousPairings: [{ discordId: '431892857453019148', name: 'zachary_zlt' }]
    },
    {
      _id: '133606854910541824',
      name: 'mr_jam_jar',
      previousPairings: [{ discordId: '431892857453019148', name: 'zachary_zlt' }]
    }
  ]);
});

test('does not duplicate PreviousPairings when both directions are present in the CSV', () => {
  const documents = parsePreviousPairingsCsv(csvBuffer([
    sourceRows[0],
    [
      sourceRows[0][1],
      sourceRows[0][0],
      sourceRows[0][3],
      sourceRows[0][2]
    ]
  ]));
  assert.equal(documents.length, 2);
  assert.deepEqual(documents[0].previousPairings, [
    { discordId: sourceRows[0][1], name: sourceRows[0][3] }
  ]);
  assert.deepEqual(documents[1].previousPairings, [
    { discordId: sourceRows[0][0], name: sourceRows[0][2] }
  ]);
});

test('rejects invalid IDs and inconsistent names before database writes', () => {
  assert.throws(
    () => parseAvoidsCsv(csvBuffer([['bad-id', '507683691586387979', 'first', 'second']])),
    /left Discord ID must be/
  );
  assert.throws(
    () => parseAvoidsCsv(csvBuffer([
      sourceRows[0],
      ['431892857453019148', '133606854910541824', 'different-name', 'other']
    ])),
    /inconsistent names/
  );
});

test('directs wide event-sheet exports to the Past Hoedown Teams import', () => {
  const eventSheetCsv = csvBuffer([
    ['Reacted Users', 'Current Round', 'Round #1', 'Round #2', 'Previous Pairings Ends at 2317'],
    ['player', 'Team A', 'Team A', 'Team B', '']
  ]);
  assert.throws(
    () => parsePreviousPairingsCsv(eventSheetCsv),
    /For event-sheet exports, use the past-hoedown-teams subcommand/
  );
});

test('upserts only uploaded left-ID documents into the requested collection', async () => {
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
  const documents = parseAvoidsCsv(csvBuffer(sourceRows));

  const result = await importPairingRows(database, documents, 'Avoids');
  assert.equal(writeCollection, 'Avoids');
  assert.equal(result.documentCount, 2);
  assert.equal(result.relationshipCount, 3);
  assert.equal(writeOperations.length, 2);
  assert.equal(writeOperations[0].updateOne.filter._id, '431892857453019148');
  assert.equal(writeOperations[0].updateOne.upsert, true);
  assert.deepEqual(writeOperations[0].updateOne.update.$set.avoids, documents[0].avoids);
});
