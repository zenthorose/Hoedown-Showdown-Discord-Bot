const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProfileStore } = require('./profile-store.cjs');

async function withTemporaryDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hoedown-profile-test-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('migrates the existing encrypted session into a default profile', async () => {
  await withTemporaryDirectory(async (directory) => {
    const legacySession = path.join(directory, 'session.json');
    const encryptedSession = JSON.stringify({ encryptedToken: 'encrypted-test-token' });
    await fs.writeFile(legacySession, encryptedSession, 'utf8');
    const profiles = createProfileStore(directory);

    await profiles.migrateLegacySession();

    assert.deepEqual(await profiles.listProfiles(), [{ id: 'default', username: 'Saved account' }]);
    assert.equal(await fs.readFile(profiles.sessionPath('default'), 'utf8'), encryptedSession);
    await assert.rejects(fs.access(legacySession), { code: 'ENOENT' });
  });
});

test('creates isolated profile sessions and persists account names', async () => {
  await withTemporaryDirectory(async (directory) => {
    const profiles = createProfileStore(directory);
    const first = await profiles.createProfile();
    const second = await profiles.createProfile();
    const avatarUrl = 'https://cdn.discordapp.com/avatars/123456789012345678/avatar.png';
    await profiles.updateAccount(first.id, 'first.account', avatarUrl);

    assert.notEqual(profiles.sessionPath(first.id), profiles.sessionPath(second.id));
    assert.deepEqual(await profiles.listProfiles(), [
      { ...second, username: '' },
      { ...first, username: 'first.account', avatarUrl }
    ]);
    await assert.rejects(
      profiles.updateAccount(first.id, 'first.account', 'https://example.test/avatar.png'),
      /account profile is invalid/
    );
    assert.throws(() => profiles.sessionPath('..'), /Invalid app profile ID/);
  });
});

test('deletes only the selected local profile', async () => {
  await withTemporaryDirectory(async (directory) => {
    const profiles = createProfileStore(directory);
    const first = await profiles.createProfile();
    const second = await profiles.createProfile();
    await fs.writeFile(profiles.sessionPath(first.id), 'first-profile-session', 'utf8');
    await fs.writeFile(profiles.sessionPath(second.id), 'second-profile-session', 'utf8');

    assert.equal(await profiles.deleteProfile(first.id), true);
    assert.equal(await profiles.readProfile(first.id), null);
    assert.equal(await fs.readFile(profiles.sessionPath(second.id), 'utf8'), 'second-profile-session');
    assert.deepEqual(await profiles.listProfiles(), [second]);
  });
});

