const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_BOT_SETTINGS,
  isGasPostEnabled,
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
  assert.equal(settings.grabReactions.ENABLE_TEAM_CHECK_POSTING, true);
  assert.equal(settings.hoedownReset.ENABLE_LOGGING, false);
});

test('Team Check and approved-round GAS posts use independent bot toggles', () => {
  const settings = structuredClone(DEFAULT_BOT_SETTINGS);
  assert.equal(isGasPostEnabled('team-check-preview', settings), true);
  assert.equal(isGasPostEnabled('approved-round', settings), true);

  settings.grabReactions.ENABLE_TEAM_CHECK_POSTING = false;
  assert.equal(isGasPostEnabled('team-check-preview', settings), false);
  assert.equal(isGasPostEnabled('approved-round', settings), true);

  settings.approveRound.ENABLE_DISCORD_POSTING = false;
  assert.equal(isGasPostEnabled('approved-round', settings), false);
  assert.equal(isGasPostEnabled('unmanaged-message', settings), true);
});

test('bot settings updates require every supported flag to be boolean', () => {
  const settings = structuredClone(DEFAULT_BOT_SETTINGS);
  settings.approveRound.ENABLE_DISCORD_POSTING = false;
  assert.deepEqual(validateBotSettings(settings), settings);

  settings.hoedownReset.ENABLE_WIPE_OPTIN = 'true';
  assert.throws(() => validateBotSettings(settings), /must be true or false/);
});

test('bot channel settings validate channel IDs and round/team keys', () => {
  const settings = structuredClone(DEFAULT_BOT_SETTINGS);
  settings.channels.LOG_CHANNEL_ID = '12345678901234567';
  settings.channels.roundChannels['1'] = '12345678901234568';
  settings.channels.teamChannels['Team A'] = '12345678901234569';
  assert.deepEqual(validateBotSettings(settings).channels, settings.channels);

  settings.channels.roundChannels['17'] = '12345678901234570';
  assert.throws(() => validateBotSettings(settings), /invalid key/);
});
