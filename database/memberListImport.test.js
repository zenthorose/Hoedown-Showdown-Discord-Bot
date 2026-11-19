const assert = require('node:assert/strict');
const test = require('node:test');
const { importMemberListRows, parseMemberListCsv } = require('./memberListImport');

function csvBuffer(rows) {
  const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n'), 'utf8');
}

test('parses member profiles into Discord-ID-based collections', () => {
  const rows = parseMemberListCsv(csvBuffer([
    ['Nickname', 'Username', 'Discord ID', 'Region', 'Steam ID', 'Stream Link', 'Gender'],
    ['Ranch Hand', 'Cowboy.Name', '123456789012345678', 'NA', 'steam-1', 'https://example.test', '']
  ]));
  assert.deepEqual(rows, [{
    collectionName: '123456789012345678',
    profile: {
      _id: '123456789012345678',
      discordId: '123456789012345678',
      username: 'Cowboy.Name',
      nickname: 'Ranch Hand',
      region: 'NA',
      steamId: 'steam-1',
      streamLink: 'https://example.test',
      gender: ''
    }
  }]);
});

test('rejects duplicate Discord IDs and missing usernames before import', () => {
  const duplicateIds = csvBuffer([
    ['Username', 'Discord ID'],
    ['first', '123456789012345678'],
    ['second', '123456789012345678']
  ]);
  assert.throws(() => parseMemberListCsv(duplicateIds), /appears more than once/);

  const missingUsername = csvBuffer([
    ['Username', 'Discord ID'],
    ['', '123456789012345678']
  ]);
  assert.throws(() => parseMemberListCsv(missingUsername), /Username is required/);
});

test('upserts each profile into its Discord ID collection', async () => {
  const writes = new Map();
  const database = {
    collection(name) {
      return {
        async bulkWrite(operations) {
          writes.set(name, operations);
          return { upsertedCount: operations.length, matchedCount: 0 };
        }
      };
    }
  };
  const profiles = [
    { collectionName: '123456789012345678', profile: { _id: '123456789012345678', username: 'first' } },
    { collectionName: '234567890123456789', profile: { _id: '234567890123456789', username: 'second' } }
  ];

  const result = await importMemberListRows(database, profiles);
  assert.equal(result.collectionCount, 2);
  assert.equal(result.profileCount, 2);
  assert.deepEqual([...writes.keys()], ['123456789012345678', '234567890123456789']);
  assert.equal(writes.get('123456789012345678')[0].updateOne.filter._id, '123456789012345678');
  assert.equal(writes.get('123456789012345678')[0].updateOne.upsert, true);
  assert.equal(writes.get('123456789012345678')[0].updateOne.update.$set._id, undefined);
});
