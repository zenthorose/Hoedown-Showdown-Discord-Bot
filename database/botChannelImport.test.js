const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getConfiguredBotChannels,
  importMissingBotChannels,
  listConfiguredChannels
} = require('./botChannelImport');

function getPath(object, path) {
  return path.split('.').reduce((value, part) => value?.[part], object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  const key = parts.pop();
  const parent = parts.reduce((value, part) => value[part] ||= {}, object);
  parent[key] = value;
}

class MemorySettingsCollection {
  constructor(document = null) {
    this.document = document;
  }

  async updateOne(filter, update, options = {}) {
    if (!this.document && options.upsert) {
      this.document = { _id: filter._id };
      for (const [path, value] of Object.entries(update.$setOnInsert || {})) {
        setPath(this.document, path, structuredClone(value));
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }

    if (!this.document || this.document._id !== filter._id) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if ((filter.$or || []).length) {
      const matchesEmpty = filter.$or.some((condition) => {
        const path = Object.keys(condition)[0];
        const expected = condition[path];
        const current = getPath(this.document, path);
        return expected.$exists === false ? current === undefined : current === expected;
      });
      if (!matchesEmpty) return { matchedCount: 0, modifiedCount: 0 };
    }

    for (const [path, value] of Object.entries(update.$set || {})) setPath(this.document, path, value);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

test('configured channels include IDs from config and use env as Team Check fallback', () => {
  const channels = getConfiguredBotChannels({
    LOG_CHANNEL_ID: '12345678901234567',
    OptInChannelID: '12345678901234568',
    roundChannels: { '1': '12345678901234569' },
    teamChannels: { 'Team A': '12345678901234570' }
  }, { TEAM_CHECK_CHANNEL_ID: '12345678901234571' });

  assert.equal(channels.TeamCheckChannelID, '12345678901234571');
  assert.equal(channels.roundChannels['1'], '12345678901234569');
  assert.equal(listConfiguredChannels(channels).length, 5);
});

test('channel import writes missing values and preserves MongoDB values on repeat import', async () => {
  const channels = getConfiguredBotChannels({
    LOG_CHANNEL_ID: '12345678901234567',
    roundChannels: { '1': '12345678901234568' },
    teamChannels: { 'Team A': '12345678901234569' }
  }, {});
  const collection = new MemorySettingsCollection({
    _id: 'global',
    settings: { channels: { LOG_CHANNEL_ID: '12345678901234570' } }
  });

  const first = await importMissingBotChannels(collection, channels);
  assert.equal(getPath(collection.document, 'settings.channels.LOG_CHANNEL_ID'), '12345678901234570');
  assert.equal(getPath(collection.document, 'settings.channels.roundChannels.1'), '12345678901234568');
  assert.equal(first.preserved.includes('channels.LOG_CHANNEL_ID'), true);

  const second = await importMissingBotChannels(collection, channels);
  assert.equal(second.imported.length, 0);
  assert.equal(second.preserved.length, 3);
});
