const assert = require('node:assert/strict');
const test = require('node:test');
const {
  estimateBuildDuration,
  getBuildDurationSamples,
  isBuildTask,
  recordBuildDuration
} = require('../build-timing.cjs');

test('keeps build timing histories separate for each build type', () => {
  const history = recordBuildDuration(
    { 'desktop-portable': [12000] },
    'account-manager',
    45000
  );

  assert.equal(isBuildTask('account-manager'), true);
  assert.equal(isBuildTask('publish'), false);
  assert.deepEqual(history, {
    'desktop-portable': [12000],
    'account-manager': [45000]
  });
  assert.equal(estimateBuildDuration(history, 'account-manager'), 45000);
  assert.equal(estimateBuildDuration(history, 'desktop-installer'), null);
});

test('estimates the median of recent valid successful builds', () => {
  const history = {
    'desktop-installer': [60000, 30000, 45000, -1, '120000', 24000]
  };

  assert.deepEqual(getBuildDurationSamples(history, 'desktop-installer'), [60000, 30000, 45000, 24000]);
  assert.equal(estimateBuildDuration(history, 'desktop-installer'), 37500);
});

test('retains only the five most recent durations and rejects invalid records', () => {
  const history = { 'desktop-portable': [1000, 2000, 3000, 4000, 5000] };

  assert.deepEqual(
    recordBuildDuration(history, 'desktop-portable', 6000)['desktop-portable'],
    [2000, 3000, 4000, 5000, 6000]
  );
  assert.throws(() => recordBuildDuration(history, 'publish', 6000), /supported build task/);
  assert.throws(() => recordBuildDuration(history, 'desktop-portable', 0), /positive value/);
});
