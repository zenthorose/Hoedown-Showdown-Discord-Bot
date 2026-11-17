const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CHANNELS = new Set(['beta', 'stable']);
const TASKS = new Set(['desktop-portable', 'desktop-installer', 'account-manager', 'publish']);

function validateVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new TypeError('Enter a valid semantic version, such as 0.1.1-beta.1.');
  }
  return value;
}

function validateChannel(channel) {
  if (!CHANNELS.has(channel)) throw new TypeError('Choose beta or stable.');
  return channel;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function inspectWorkspace(root) {
  const rootDirectory = path.resolve(root);
  const desktop = await readJson(path.join(rootDirectory, 'package.json'));
  const manager = await readJson(path.join(rootDirectory, 'account-manager', 'package.json'));
  const config = await readJson(path.join(rootDirectory, 'desktop', 'auth-config.json'));
  if (desktop.name !== 'hoedown-showdown-desktop' ||
      manager.name !== 'hoedown-showdown-account-manager') {
    throw new Error('The selected folder is not the Hoedown Showdown app project.');
  }
  validateVersion(desktop.version);
  validateVersion(manager.version);
  if (!CHANNELS.has(config.updateChannel)) throw new Error('The desktop update channel is invalid.');
  return {
    rootDirectory,
    desktopVersion: desktop.version,
    managerVersion: manager.version,
    channel: config.updateChannel
  };
}

async function setChannel(root, channel, serviceUrl) {
  const workspace = await inspectWorkspace(root);
  validateChannel(channel);
  const configPath = path.join(workspace.rootDirectory, 'desktop', 'auth-config.json');
  const config = await readJson(configPath);
  config.updateChannel = channel;
  if (serviceUrl !== undefined) {
    const url = new URL(serviceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new TypeError('Configure a valid HTTPS Render service URL before building.');
    }
    config.apiBaseUrl = url.origin;
  }
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return channel;
}

function suggestNextVersion(channel, version) {
  validateChannel(channel);
  const match = VERSION_PATTERN.exec(validateVersion(version));
  if (channel === 'stable') return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  const beta = match[4] && /^beta(?:\.(\d+))?$/.exec(match[4]);
  return `${match[1]}.${match[2]}.${match[3]}-beta.${beta ? Number(beta[1] || 0) + 1 : 1}`;
}

async function updateVersions(root, versions, selections = {}) {
  const workspace = await inspectWorkspace(root);
  const updateDesktop = selections.desktop !== false;
  const updateManager = selections.accountManager !== false;
  if (!updateDesktop && !updateManager) throw new TypeError('Select at least one version to update.');
  const files = [];
  const result = { desktopVersion: null, managerVersion: null };
  if (updateDesktop) {
    const version = validateVersion(versions.desktopVersion);
    files.push({ project: '', version, key: 'desktopVersion' });
  }
  if (updateManager) {
    const version = validateVersion(versions.managerVersion);
    files.push({ project: 'account-manager', version, key: 'managerVersion' });
  }
  for (const entry of files) {
    const packagePath = path.join(workspace.rootDirectory, entry.project, 'package.json');
    const lockPath = path.join(workspace.rootDirectory, entry.project, 'package-lock.json');
    const [pkg, lock] = await Promise.all([readJson(packagePath), readJson(lockPath)]);
    if (!lock.packages || !lock.packages['']) throw new Error(`${entry.project || 'Desktop'} lockfile has no root package.`);
    pkg.version = entry.version;
    lock.version = entry.version;
    lock.packages[''].version = entry.version;
    await Promise.all([
      fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8'),
      fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
    ]);
    result[entry.key] = entry.version;
  }
  return result;
}

function runNpm(root, args, onOutput, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => onOutput(String(chunk)));
    child.stderr.on('data', (chunk) => onOutput(String(chunk)));
    child.once('error', (error) => reject(new Error(`Could not start npm: ${error.message}`)));
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`npm ${args.join(' ')} exited with code ${code}.`)));
  });
}

async function ensureDependency(dependencyPath, root, args, label, onOutput) {
  try {
    await fs.access(dependencyPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    onOutput(`${label} are missing; installing from the lockfile…\n`);
    await runNpm(root, args, onOutput);
  }
}

function runNpmForJson(root, args, onOutput, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 32768) {
        child.kill();
        reject(new Error('The published-version response was too large.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      onOutput(text);
    });
    child.once('error', (error) => reject(new Error(`Could not start npm: ${error.message}`)));
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Could not read published versions: ${stderr.trim() || `npm exited with code ${code}.`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error('The published-version command returned invalid JSON.'));
      }
    });
  });
}

async function readPublishedVersions(root, credentials, onOutput = () => {}) {
  if (!credentials || !credentials.accountId || !credentials.bucketName ||
      !credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error('Configure the Cloudflare R2 credentials first.');
  }
  const workspace = await inspectWorkspace(root);
  await ensureDependency(
    path.join(workspace.rootDirectory, 'auth-service', 'node_modules', '@aws-sdk', 'client-s3', 'package.json'),
    workspace.rootDirectory,
    ['--prefix', 'auth-service', 'ci'],
    'Update publisher dependencies',
    onOutput
  );
  const versions = await runNpmForJson(
    workspace.rootDirectory,
    ['--prefix', 'auth-service', 'run', '--silent', 'read-update-versions'],
    onOutput,
    {
      R2_ACCOUNT_ID: credentials.accountId,
      R2_BUCKET_NAME: credentials.bucketName,
      R2_WRITE_ACCESS_KEY_ID: credentials.accessKeyId,
      R2_WRITE_SECRET_ACCESS_KEY: credentials.secretAccessKey
    }
  );
  if (!versions || (versions.beta !== null && typeof versions.beta !== 'string') ||
      (versions.stable !== null && typeof versions.stable !== 'string')) {
    throw new Error('R2 returned invalid published-version data.');
  }
  return {
    beta: versions.beta,
    stable: versions.stable,
    suggestedDesktopBeta: versions.beta
      ? suggestNextVersion('beta', versions.beta)
      : suggestNextVersion('beta', workspace.desktopVersion),
    suggestedDesktopStable: versions.stable
      ? suggestNextVersion('stable', versions.stable)
      : suggestNextVersion('stable', workspace.desktopVersion),
    suggestedManagerBeta: suggestNextVersion('beta', workspace.managerVersion),
    suggestedManagerStable: suggestNextVersion('stable', workspace.managerVersion)
  };
}

async function runTask(root, task, channel, credentials, onOutput = () => {}) {
  if (process.platform !== 'win32') throw new Error('Windows app releases must be built on Windows.');
  if (!TASKS.has(task)) throw new TypeError('Choose a supported release task.');
  const workspace = await inspectWorkspace(root);
  const base = workspace.rootDirectory;
  if (task === 'desktop-portable' || task === 'desktop-installer') {
    validateChannel(channel);
    await setChannel(base, channel);
    await ensureDependency(
      path.join(base, 'node_modules', 'electron-builder', 'package.json'),
      base,
      ['ci'],
      'Desktop app dependencies',
      onOutput
    );
    await runNpm(base, ['run', task === 'desktop-portable' ? 'build:portable' : 'build:win'], onOutput);
  } else if (task === 'account-manager') {
    await ensureDependency(
      path.join(base, 'account-manager', 'node_modules', 'electron-builder', 'package.json'),
      base,
      ['--prefix', 'account-manager', 'ci'],
      'Account manager dependencies',
      onOutput
    );
    await runNpm(base, ['--prefix', 'account-manager', 'run', 'build:win'], onOutput);
  } else {
    validateChannel(channel);
    const versionMatch = VERSION_PATTERN.exec(workspace.desktopVersion);
    if ((channel === 'stable' && versionMatch[4]) || (channel === 'beta' && !versionMatch[4])) {
      throw new Error(`Desktop version ${workspace.desktopVersion} does not match the ${channel} channel.`);
    }
    if (workspace.channel !== channel) throw new Error(`Build the app for the ${channel} channel before publishing.`);
    if (!credentials || !credentials.accountId || !credentials.bucketName ||
        !credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new Error('Configure the Cloudflare R2 publishing credentials first.');
    }
    await ensureDependency(
      path.join(base, 'auth-service', 'node_modules', '@aws-sdk', 'client-s3', 'package.json'),
      base,
      ['--prefix', 'auth-service', 'ci'],
      'Update publisher dependencies',
      onOutput
    );
    await runNpm(base, ['--prefix', 'auth-service', 'run', 'publish-update', '--', channel], onOutput, {
      R2_ACCOUNT_ID: credentials.accountId,
      R2_BUCKET_NAME: credentials.bucketName,
      R2_WRITE_ACCESS_KEY_ID: credentials.accessKeyId,
      R2_WRITE_SECRET_ACCESS_KEY: credentials.secretAccessKey
    });
  }
  return { task, desktopVersion: workspace.desktopVersion, managerVersion: workspace.managerVersion };
}

module.exports = {
  inspectWorkspace,
  readPublishedVersions,
  runTask,
  setChannel,
  suggestNextVersion,
  updateVersions,
  validateChannel,
  validateVersion
};
