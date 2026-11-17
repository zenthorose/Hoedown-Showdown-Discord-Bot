const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  inspectWorkspace,
  setChannel,
  suggestNextVersion,
  updateVersions,
  validateVersion
} = require('../release-manager.cjs');

async function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hoedown-release-'));
  await writeJson(root, 'package.json', {
    name: 'hoedown-showdown-desktop',
    version: '0.1.0-beta.1'
  });
  await writeJson(root, 'package-lock.json', {
    name: 'hoedown-showdown-desktop',
    version: '0.1.0-beta.1',
    lockfileVersion: 3,
    packages: { '': { name: 'hoedown-showdown-desktop', version: '0.1.0-beta.1' } }
  });
  await writeJson(root, 'account-manager/package.json', {
    name: 'hoedown-showdown-account-manager',
    version: '0.1.0-beta.1'
  });
  await writeJson(root, 'account-manager/package-lock.json', {
    name: 'hoedown-showdown-account-manager',
    version: '0.1.0-beta.1',
    lockfileVersion: 3,
    packages: { '': { name: 'hoedown-showdown-account-manager', version: '0.1.0-beta.1' } }
  });
  await writeJson(root, 'desktop/auth-config.json', {
    apiBaseUrl: '',
    updateChannel: 'beta'
  });
  return root;
}

test('validates release versions and suggests channel-appropriate increments', () => {
  assert.equal(validateVersion('0.1.1-beta.1'), '0.1.1-beta.1');
  assert.throws(() => validateVersion('../package.json'), /semantic version/);
  assert.equal(suggestNextVersion('beta', '0.1.1-beta.2'), '0.1.1-beta.3');
  assert.equal(suggestNextVersion('stable', '0.1.1-beta.2'), '0.1.2');
});

test('checks project identity and sets the selected channel and Render URL', async (t) => {
  const root = await workspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await inspectWorkspace(root)).channel, 'beta');
  await setChannel(root, 'stable', 'https://auth.example.onrender.com');
  const config = JSON.parse(await fs.readFile(path.join(root, 'desktop/auth-config.json'), 'utf8'));
  assert.equal(config.updateChannel, 'stable');
  assert.equal(config.apiBaseUrl, 'https://auth.example.onrender.com');
  await assert.rejects(setChannel(root, 'beta', 'http://example.test'), /HTTPS/);
});

test('updates only selected package and lock versions', async (t) => {
  const root = await workspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await updateVersions(root, {
    desktopVersion: '0.1.1-beta.1',
    managerVersion: '0.1.1-beta.1'
  }, { desktop: true, accountManager: false });
  assert.deepEqual(result, { desktopVersion: '0.1.1-beta.1', managerVersion: null });
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, '0.1.1-beta.1');
  assert.equal(lock.packages[''].version, '0.1.1-beta.1');
});
