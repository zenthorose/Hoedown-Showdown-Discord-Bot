const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_BOT_SETTINGS,
  normalizeStoredBotSettings,
  readBotSettings,
  validateBotSettings
} = require('./botSettings');

test('bot settings use current script defaults when no MongoDB document exists', async () => {
  const collection = { findOne: async () => null };
  assert.deepEqual(await readBotSettings(collection), DEFAULT_BOT_SETTINGS);
});

test('stored bot settings override defaults while allowing newly added flags', () => {
  const settings = normalizeStoredBotSettings({
    approveRound: { ENABLE_DISCORD_POSTING: false }
  });
  assert.equal(settings.approveRound.ENABLE_DISCORD_POSTING, false);
  assert.equal(settings.approveRound.ENABLE_TEAM_CLEANUP, true);
  assert.equal(settings.hoedownReset.ENABLE_LOGGING, false);
});

test('bot settings updates require every supported flag to be boolean', () => {
  const settings = structuredClone(DEFAULT_BOT_SETTINGS);
  settings.approveRound.ENABLE_DISCORD_POSTING = false;
  assert.deepEqual(validateBotSettings(settings), settings);

  settings.hoedownReset.ENABLE_WIPE_OPTIN = 'true';
  assert.throws(() => validateBotSettings(settings), /must be true or false/);
});
