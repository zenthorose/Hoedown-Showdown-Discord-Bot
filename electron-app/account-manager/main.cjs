const { app, BrowserWindow, ipcMain, safeStorage, clipboard, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  inspectWorkspace,
  readPublishedVersions,
  runTask,
  setChannel,
  suggestNextVersion,
  updateVersions
} = require('./release-manager.cjs');

let mainWindow;
let releaseTaskRunning = false;
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const appRoot = path.resolve(__dirname, '..');

function requireTrusted(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted account-manager request.');
  }
}

function validateServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Enter a valid Render service URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('The Render service URL must be HTTPS and contain no credentials or query parameters.');
  }
  return url.origin;
}

function getSourceRoot(settings) {
  if (settings && settings.sourceDirectory) return path.resolve(settings.sourceDirectory);
  if (app.isPackaged) throw new Error('Choose the local app source folder before using Releases.');
  return appRoot;
}

async function loadSettings() {
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read account-manager settings: ${error.message}`);
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.');
  const decrypt = (value) => value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
  return {
    serviceUrl: validateServiceUrl(saved.serviceUrl),
    adminKey: decrypt(saved.encryptedAdminKey),
    sourceDirectory: typeof saved.sourceDirectory === 'string' ? saved.sourceDirectory : '',
    r2: {
      accountId: saved.accountId || '',
      bucketName: saved.bucketName || '',
      accessKeyId: decrypt(saved.encryptedR2AccessKeyId),
      secretAccessKey: decrypt(saved.encryptedR2SecretAccessKey)
    }
  };
}

async function requestAdmin(settings, route, { method = 'GET', body } = {}) {
  if (!settings) throw new Error('Configure the Render service and admin key first.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(new URL(route, `${settings.serviceUrl}/`), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.adminKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Render returned a non-JSON response (HTTP ${response.status}). Verify the service URL and deployment.`);
    }
    if (!response.ok) throw new Error(data.error || `Admin request failed with HTTP ${response.status}.`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function encrypt(value) {
  return value ? safeStorage.encryptString(value).toString('base64') : '';
}

async function saveSettings(input) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.');
  const old = await loadSettings();
  const serviceUrl = validateServiceUrl(input && input.serviceUrl);
  const adminKey = typeof (input && input.adminKey) === 'string' && input.adminKey.trim()
    ? input.adminKey.trim()
    : old && old.adminKey;
  if (!adminKey || adminKey.length < 32) throw new TypeError('Enter the Render admin key (at least 32 characters).');
  const r2Input = input && input.r2 || {};
  const r2 = {
    accountId: r2Input.accountId || old && old.r2.accountId || '',
    bucketName: r2Input.bucketName || old && old.r2.bucketName || '',
    accessKeyId: r2Input.accessKeyId || old && old.r2.accessKeyId || '',
    secretAccessKey: r2Input.secretAccessKey || old && old.r2.secretAccessKey || ''
  };
  if (Object.values(r2).some(Boolean) &&
      (!/^[a-f0-9]{32}$/i.test(r2.accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2.bucketName) ||
       !r2.accessKeyId || !r2.secretAccessKey)) {
    throw new TypeError('Enter a valid R2 account ID, bucket name, and both write credentials.');
  }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify({
    serviceUrl,
    encryptedAdminKey: encrypt(adminKey),
    sourceDirectory: old && old.sourceDirectory || '',
    accountId: r2.accountId,
    bucketName: r2.bucketName,
    encryptedR2AccessKeyId: encrypt(r2.accessKeyId),
    encryptedR2SecretAccessKey: encrypt(r2.secretAccessKey)
  }), 'utf8');
  return { configured: true, serviceUrl, hasR2: Boolean(r2.accessKeyId && r2.secretAccessKey) };
}

function exportCsv(events) {
  const fields = ['actor', 'action', 'username', 'at'];
  const cell = (value) => {
    const text = String(value == null ? '' : value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [fields.join(','), ...events.map((event) => fields.map((field) => cell(event[field])).join(','))].join('\r\n');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 720,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#171a16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const indexPath = path.join(__dirname, 'index.html');
  const indexUrl = require('node:url').pathToFileURL(indexPath).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== indexUrl) event.preventDefault();
  });
  mainWindow.loadFile(indexPath);
}

app.whenReady().then(() => {
  ipcMain.handle('admin:get-settings', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    return settings
      ? {
        configured: true,
        serviceUrl: settings.serviceUrl,
        hasR2: Boolean(settings.r2.accessKeyId),
        r2AccountId: settings.r2.accountId,
        r2BucketName: settings.r2.bucketName,
        sourceDirectory: settings.sourceDirectory
      }
      : { configured: false, serviceUrl: '', hasR2: false, sourceDirectory: '' };
  });

  ipcMain.handle('admin:save-settings', async (event, input) => {
    requireTrusted(event);
    return saveSettings(input);
  });

  ipcMain.handle('admin:test-connection', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Save the Render URL and admin key first.');
    const data = await requestAdmin(settings, '/api/admin/users');
    if (!Array.isArray(data.accounts)) throw new Error('Render returned an invalid account list.');
    return { connected: true, accountCount: data.accounts.length };
  });

  ipcMain.handle('admin:list-users', async (event) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/users');
    if (!Array.isArray(data.accounts)) throw new Error('Render returned an invalid account list.');
    return data.accounts;
  });

  ipcMain.handle('admin:create-user', async (event, value) => {
    requireTrusted(event);
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new TypeError('Username is invalid.');
    const data = await requestAdmin(await loadSettings(), '/api/admin/users', {
      method: 'POST',
      body: { username }
    });
    if (data.username !== username || typeof data.password !== 'string') {
      throw new Error('Render returned incomplete account details.');
    }
    return data;
  });

  ipcMain.handle('admin:manage-user', async (event, input) => {
    requireTrusted(event);
    const username = String(input && input.username || '').trim().toLowerCase();
    const action = input && input.action;
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) ||
        !['set-active', 'revoke-sessions', 'reset-password'].includes(action)) {
      throw new TypeError('Invalid account-management action.');
    }
    const data = await requestAdmin(await loadSettings(), `/api/admin/users/${action}`, {
      method: 'POST',
      body: { username, ...(action === 'set-active' ? { active: input.active } : {}) }
    });
    if (data.username !== username) throw new Error('Render returned an unexpected account.');
    return data;
  });

  ipcMain.handle('admin:list-devices', async (event, value) => {
    requireTrusted(event);
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new TypeError('Username is invalid.');
    const data = await requestAdmin(await loadSettings(), `/api/admin/users/${encodeURIComponent(username)}/devices`);
    if (!Array.isArray(data.devices)) throw new Error('Render returned an invalid device list.');
    return data.devices;
  });

  ipcMain.handle('admin:revoke-device', async (event, input) => {
    requireTrusted(event);
    const username = String(input && input.username || '').trim().toLowerCase();
    const deviceId = String(input && input.deviceId || '');
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new TypeError('Username is invalid.');
    const data = await requestAdmin(await loadSettings(), '/api/admin/users/revoke-device', {
      method: 'POST',
      body: { username, deviceId }
    });
    return data;
  });

  ipcMain.handle('admin:list-audit', async (event, filters = {}) => {
    requireTrusted(event);
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      throw new TypeError('Audit filters are invalid.');
    }
    if (filters.search !== undefined && typeof filters.search !== 'string') {
      throw new TypeError('Audit search must be text.');
    }
    const query = new URLSearchParams();
    if (filters.search && filters.search.trim()) query.set('search', filters.search.trim().slice(0, 64));
    for (const field of ['from', 'to']) {
      if (filters[field] !== undefined && typeof filters[field] !== 'string') {
        throw new TypeError('Audit dates must be text.');
      }
      if (filters[field]) query.set(field, filters[field]);
    }
    const data = await requestAdmin(await loadSettings(), `/api/admin/audit?${query}`);
    if (!Array.isArray(data.events)) throw new Error('Render returned invalid audit data.');
    return data;
  });

  ipcMain.handle('admin:save-audit', async (event, events) => {
    requireTrusted(event);
    if (!Array.isArray(events)) throw new TypeError('Audit export data is invalid.');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export admin activity',
      defaultPath: 'admin-activity.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, exportCsv(events), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('admin:copy-text', (event, text) => {
    requireTrusted(event);
    if (typeof text !== 'string') throw new TypeError('Clipboard content must be text.');
    clipboard.writeText(text);
    return { copied: true };
  });

  ipcMain.handle('release:get-info', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    const workspace = await inspectWorkspace(getSourceRoot(settings));
    return {
      ...workspace,
      suggestedDesktop: suggestNextVersion(workspace.channel, workspace.desktopVersion),
      suggestedManager: suggestNextVersion(workspace.channel, workspace.managerVersion)
    };
  });

  ipcMain.handle('release:save-settings', async (event, input) => {
    requireTrusted(event);
    const current = await loadSettings();
    if (!current) throw new Error('Configure the Render service and admin key first.');
    return saveSettings({ serviceUrl: current.serviceUrl, adminKey: current.adminKey, r2: input });
  });

  ipcMain.handle('release:choose-source', async (event) => {
    requireTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Hoedown Showdown app source folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const sourceDirectory = await inspectWorkspace(result.filePaths[0]);
    const current = await loadSettings();
    if (!current) throw new Error('Save the Render service and admin key before selecting a source folder.');
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    saved.sourceDirectory = sourceDirectory.rootDirectory;
    await fs.writeFile(settingsPath(), JSON.stringify(saved), 'utf8');
    return { canceled: false, sourceDirectory: sourceDirectory.rootDirectory };
  });

  ipcMain.handle('release:set-channel', async (event, channel) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Configure the Render service and admin key first.');
    return setChannel(getSourceRoot(settings), channel, settings.serviceUrl);
  });

  ipcMain.handle('release:fetch-versions', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Configure the Render service and admin key first.');
    return readPublishedVersions(
      getSourceRoot(settings),
      settings.r2,
      (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('release:output', text);
      }
    );
  });

  ipcMain.handle('release:update-versions', async (event, input) => {
    requireTrusted(event);
    const settings = await loadSettings();
    return updateVersions(getSourceRoot(settings), input && input.versions, input && input.selections);
  });

  ipcMain.handle('release:run-task', async (event, input) => {
    requireTrusted(event);
    if (releaseTaskRunning) throw new Error('A release task is already running.');
    const task = input && input.task;
    const channel = input && input.channel;
    if (task === 'publish') {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', `Publish ${channel}`],
        defaultId: 0,
        cancelId: 0,
        title: 'Publish app update',
        message: `Publish the built desktop installer to ${channel}?`,
        detail: 'Users on this channel will be offered this release. Confirm the build and version first.'
      });
      if (choice.response !== 1) return { canceled: true };
    }
    const settings = await loadSettings();
    releaseTaskRunning = true;
    try {
      if (['desktop-portable', 'desktop-installer'].includes(task)) {
        if (!settings) throw new Error('Configure the Render service and admin key before building.');
        await setChannel(getSourceRoot(settings), channel, settings.serviceUrl);
      }
      const result = await runTask(
        getSourceRoot(settings),
        task,
        channel,
        settings && settings.r2,
        (text) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('release:output', text);
        }
      );
      return { canceled: false, ...result };
    } finally {
      releaseTaskRunning = false;
    }
  });

  createWindow();
}).catch((error) => {
  console.error('Account manager failed to start:', error);
  app.quit();
});
