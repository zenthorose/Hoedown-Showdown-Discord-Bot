const assert = require('node:assert/strict');
const test = require('node:test');
const {
  importMemberListRows,
  parseMemberListCsv,
  syncGuildMemberProfiles,
  upsertMemberProfile
} = require('./memberListImport');

function csvBuffer(rows) {
  const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n'), 'utf8');
}

test('parses member profiles with Discord IDs as document IDs', () => {
  const rows = parseMemberListCsv(csvBuffer([
    ['Nickname', 'Username', 'Discord ID', 'Region', 'Steam ID', 'Stream Link', 'Gender'],
    ['Ranch Hand', 'Cowboy.Name', '123456789012345678', 'NA', 'steam-1', 'https://example.test', '']
  ]));
  assert.deepEqual(rows, [{
    _id: '123456789012345678',
    discordId: '123456789012345678',
    username: 'Cowboy.Name',
    nickname: 'Ranch Hand',
    region: 'NA',
    steamId: 'steam-1',
    streamLink: 'https://example.test',
    gender: ''
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

test('upserts all profiles into one Members collection by Discord ID', async () => {
  let writeCollection;
  let writeOperations;
  const database = {
    collection(name) {
      return {
        async bulkWrite(operations) {
          writeCollection = name;
          writeOperations = operations;
          return { upsertedCount: operations.length, matchedCount: 0 };
        }
      };
    }
  };
  const profiles = [
    { _id: '123456789012345678', username: 'first' },
    { _id: '234567890123456789', username: 'second' }
  ];

  const result = await importMemberListRows(database, profiles);
  assert.equal(result.collectionName, 'Members');
  assert.equal(result.profileCount, 2);
  assert.equal(writeCollection, 'Members');
  assert.equal(writeOperations.length, 2);
  assert.equal(writeOperations[0].updateOne.filter._id, '123456789012345678');
  assert.equal(writeOperations[1].updateOne.filter._id, '234567890123456789');
  assert.equal(writeOperations[0].updateOne.upsert, true);
  assert.equal(writeOperations[0].updateOne.update.$set._id, undefined);
});

test('syncs Discord identity fields while defaulting new profiles to Both', async () => {
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
  const profiles = [{
    _id: '123456789012345678',
    discordId: '123456789012345678',
    username: 'Cowboy.Name',
    nickname: 'Ranch Hand'
  }];

  const result = await syncGuildMemberProfiles(database, profiles);
  assert.equal(writeCollection, 'Members');
  assert.equal(result.profileCount, 1);
  assert.equal(writeOperations[0].updateOne.filter._id, '123456789012345678');
  assert.equal(writeOperations[0].updateOne.upsert, true);
  assert.deepEqual(writeOperations[0].updateOne.update, {
    $set: {
      discordId: '123456789012345678',
      username: 'Cowboy.Name',
      nickname: 'Ranch Hand'
    },
    $setOnInsert: { region: 'Both' }
  });
});

test('upserts registration fields by Discord ID without replacing unrelated profile fields', async () => {
  let writeCollection;
  let writeArguments;
  const database = {
    collection(name) {
      return {
        async updateOne(...args) {
          writeCollection = name;
          writeArguments = args;
          return { upsertedCount: 1, matchedCount: 0 };
        }
      };
    }
  };
  const profile = {
    discordId: '123456789012345678',
    username: 'Cowboy.Name',
    nickname: 'Ranch Hand',
    region: 'East',
    steamId: '76561198000000000',
    streamLink: 'https://twitch.tv/cowboy',
    gender: 'unspecified'
  };

  await upsertMemberProfile(database, profile);
  assert.equal(writeCollection, 'Members');
  assert.deepEqual(writeArguments, [
    { _id: profile.discordId },
    { $set: profile },
    { upsert: true }
  ]);
});

test('requires a Discord ID when upserting a member profile', async () => {
  const database = { collection: () => { throw new Error('Should not access the database.'); } };
  await assert.rejects(() => upsertMemberProfile(database, { region: 'East' }), /Discord ID is required/);
});
