const { app, BrowserWindow, ipcMain, safeStorage, clipboard, dialog, shell } = require('electron');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
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
let replacementCsvSelection = null;
const MAX_REPLACEMENT_CSV_BYTES = 10 * 1024 * 1024;
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
    adminSessionToken: decrypt(saved.encryptedAdminSessionToken),
    adminSessionExpiresAt: typeof saved.adminSessionExpiresAt === 'string'
      ? saved.adminSessionExpiresAt
      : '',
    deviceId: typeof saved.adminDeviceId === 'string' && saved.adminDeviceId
      ? saved.adminDeviceId
      : crypto.randomUUID(),
    sourceDirectory: typeof saved.sourceDirectory === 'string' ? saved.sourceDirectory : '',
    r2: {
      accountId: saved.accountId || '',
      bucketName: saved.bucketName || '',
      accessKeyId: decrypt(saved.encryptedR2AccessKeyId),
      secretAccessKey: decrypt(saved.encryptedR2SecretAccessKey)
    }
  };
}

async function requestAdmin(settings, route, { method = 'GET', body, rawBody, timeoutMs = 20000 } = {}) {
  if (!settings) throw new Error('Configure the Render service URL first.');
  if (!settings.adminSessionToken) throw new Error('Sign in with your passkey before using Admin.');
  if (settings.adminSessionExpiresAt &&
      new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
    throw new Error('Your Admin session expired. Sign in with your passkey again.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const hasBody = body !== undefined || rawBody !== undefined;
  try {
    const response = await fetch(new URL(route, `${settings.serviceUrl}/`), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.adminSessionToken}`,
        ...(hasBody ? {
          'Content-Type': rawBody === undefined ? 'application/json' : 'text/csv'
        } : {})
      },
      body: rawBody !== undefined
        ? rawBody
        : body === undefined ? undefined : JSON.stringify(body),
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

async function downloadDatabaseExport(settings, filePath) {
  if (!settings) throw new Error('Configure the Render service URL first.');
  if (!settings.adminSessionToken) throw new Error('Sign in with your passkey before using Admin.');
  if (settings.adminSessionExpiresAt &&
      new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
    throw new Error('Your Admin session expired. Sign in with your passkey again.');
  }

  const temporaryFilePath = `${filePath}.${crypto.randomUUID()}.partial`;
  try {
    const response = await fetch(new URL('/api/admin/database-export', `${settings.serviceUrl}/`), {
      headers: {
        Accept: 'application/gzip',
        Authorization: `Bearer ${settings.adminSessionToken}`
      }
    });
    if (!response.ok) {
      let message = `Admin database export failed with HTTP ${response.status}.`;
      try {
        const data = await response.json();
        if (typeof data.error === 'string' && data.error) message = data.error;
      } catch {
        message = `Render returned a non-JSON response (HTTP ${response.status}). Verify the service URL and deployment.`;
      }
      throw new Error(message);
    }
    if ((response.headers.get('content-type') || '').split(';', 1)[0].trim() !== 'application/gzip') {
      throw new Error('Render returned an unexpected database export format.');
    }
    if (!response.body) throw new Error('Render returned an empty database export response.');

    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporaryFilePath, { flags: 'wx', mode: 0o600 })
    );
    await fs.rename(temporaryFilePath, filePath);
    return path.basename(filePath);
  } catch (error) {
    try {
      await fs.rm(temporaryFilePath, { force: true });
    } catch (cleanupError) {
      console.error('Could not remove incomplete database export file:', cleanupError);
    }
    throw error;
  }
}

async function restoreDatabaseExport(settings, filePath) {
  if (!settings) throw new Error('Configure the Render service URL first.');
  if (!settings.adminSessionToken) throw new Error('Sign in with your passkey before using Admin.');
  if (settings.adminSessionExpiresAt &&
      new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
    throw new Error('Your Admin session expired. Sign in with your passkey again.');
  }

  const fileStats = await fs.stat(filePath);
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error('Choose a non-empty database export file.');
  }
  const response = await fetch(new URL('/api/admin/database-restore', `${settings.serviceUrl}/`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${settings.adminSessionToken}`,
      'Content-Length': String(fileStats.size),
      'Content-Type': 'application/gzip',
      'X-Admin-Database-Restore-Confirmation': 'replace-all-configured-databases'
    },
    body: createReadStream(filePath),
    duplex: 'half'
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Render returned a non-JSON response (HTTP ${response.status}). Verify the service URL and deployment.`);
  }
  if (!response.ok) {
    throw new Error(
      data && typeof data.error === 'string' && data.error
        ? data.error
        : `Database restore failed with HTTP ${response.status}.`
    );
  }
  if (!Array.isArray(data.databases) ||
      data.databases.some((database) => typeof database !== 'string') ||
      !Number.isInteger(data.collectionCount) ||
      !Number.isInteger(data.viewCount) ||
      !Number.isInteger(data.documentCount) ||
      !Number.isInteger(data.cleanupWarningCount) ||
      typeof data.auditLogged !== 'boolean') {
    throw new Error('Render returned invalid database restore results.');
  }
  return data;
}

function encrypt(value) {
  return value ? safeStorage.encryptString(value).toString('base64') : '';
}

async function saveAdminSession(token, expiresAt, { clearBootstrapKey = false, deviceId } = {}) {
  const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  saved.encryptedAdminSessionToken = encrypt(token);
  saved.adminSessionExpiresAt = expiresAt;
  if (typeof deviceId === 'string') saved.adminDeviceId = deviceId;
  if (clearBootstrapKey) saved.encryptedAdminKey = '';
  await fs.writeFile(settingsPath(), JSON.stringify(saved), 'utf8');
}

function openPasskeyCallback(state) {
  let resolveCallback;
  let rejectCallback;
  const result = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    if (request.method !== 'GET' || url.pathname !== '/admin-passkey-callback' ||
        url.searchParams.get('state') !== state || typeof code !== 'string' ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(code)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid Admin sign-in callback.');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8'
    });
    response.end('<!doctype html><meta charset="utf-8"><title>Admin</title><p>Passkey verified. You can return to Hoedown Showdown Account Manager.</p>');
    resolveCallback(code);
  });
  const timeout = setTimeout(() => rejectCallback(new Error('Passkey sign-in timed out. Try again.')), 5 * 60 * 1000);
  server.once('close', () => clearTimeout(timeout));
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}/admin-passkey-callback`);
    });
  });
  return {
    ready,
    result,
    close: () => !server.listening
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      })
  };
}

async function runPasskeyFlow(settings, mode) {
  if (!settings) throw new Error('Save the Render service URL first.');
  if (mode === 'enroll' && (!settings.adminKey || settings.adminKey.length < 32)) {
    throw new Error('Enter the one-time Admin enrollment key from Render before enrolling your first passkey.');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const callback = openPasskeyCallback(state);
  let callbackUrl;
  try {
    callbackUrl = await callback.ready;
    const device = {
      redirectUri: callbackUrl,
      state,
      deviceId: settings.deviceId,
      deviceName: os.hostname(),
      platform: process.platform
    };
    let ticket = '';
    if (mode === 'enroll') {
      const response = await fetch(new URL('/api/admin/passkeys/bootstrap', `${settings.serviceUrl}/`), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.adminKey}`
        },
        body: JSON.stringify(device)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Passkey enrollment failed with HTTP ${response.status}.`);
      if (typeof data.ticket !== 'string' || !data.ticket) throw new Error('Render returned an invalid enrollment ticket.');
      ticket = data.ticket;
    }
    const fragment = new URLSearchParams({
      action: mode,
      redirectUri: callbackUrl,
      state,
      deviceId: settings.deviceId,
      deviceName: os.hostname(),
      platform: process.platform,
      ...(ticket ? { ticket } : {})
    });
    await shell.openExternal(`${settings.serviceUrl}/admin/passkeys#${fragment.toString()}`);
    const code = await callback.result;
    const response = await fetch(new URL('/api/admin/passkeys/exchange', `${settings.serviceUrl}/`), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Passkey session exchange failed with HTTP ${response.status}.`);
    if (typeof data.token !== 'string' || typeof data.expiresAt !== 'string') {
      throw new Error('Render returned an invalid Admin session.');
    }
    await saveAdminSession(data.token, data.expiresAt, {
      clearBootstrapKey: mode === 'enroll',
      deviceId: settings.deviceId
    });
    return { signedIn: true, expiresAt: data.expiresAt, enrolled: mode === 'enroll' };
  } finally {
    await callback.close();
  }
}

async function saveSettings(input) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.');
  const old = await loadSettings();
  const serviceUrl = validateServiceUrl(input && input.serviceUrl);
  const serviceChanged = old && old.serviceUrl !== serviceUrl;
  const adminKey = typeof (input && input.adminKey) === 'string' && input.adminKey.trim()
    ? input.adminKey.trim()
    : serviceChanged ? '' : old && old.adminKey;
  if (adminKey && adminKey.length < 32) {
    throw new TypeError('The initial enrollment key must be at least 32 characters.');
  }
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
    encryptedAdminSessionToken: serviceChanged ? '' : encrypt(old && old.adminSessionToken),
    adminSessionExpiresAt: serviceChanged ? '' : old && old.adminSessionExpiresAt || '',
    adminDeviceId: old && old.deviceId || crypto.randomUUID(),
    sourceDirectory: old && old.sourceDirectory || '',
    accountId: r2.accountId,
    bucketName: r2.bucketName,
    encryptedR2AccessKeyId: encrypt(r2.accessKeyId),
    encryptedR2SecretAccessKey: encrypt(r2.secretAccessKey)
  }), 'utf8');
  return {
    configured: true,
    serviceUrl,
    hasR2: Boolean(r2.accessKeyId && r2.secretAccessKey),
    hasAdminSession: !serviceChanged && Boolean(old && old.adminSessionToken),
    hasBootstrapKey: Boolean(adminKey)
  };
}

function exportCsv(events) {
  const fields = ['actor', 'action', 'username', 'at', 'details'];
  const cell = (value) => {
    const text = String(value == null ? '' : value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [
    fields.join(','),
    ...events.map((event) => fields.map((field) => {
      if (field === 'at' && event.at) {
        const date = new Date(event.at);
        return cell(Number.isNaN(date.getTime())
          ? event.at
          : date.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }));
      }
      return cell(field === 'details' && event.details
        ? JSON.stringify(event.details)
        : event[field]);
    }).join(','))
  ].join('\r\n');
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
    const hasAdminSession = Boolean(settings && settings.adminSessionToken &&
      (!settings.adminSessionExpiresAt || new Date(settings.adminSessionExpiresAt).getTime() > Date.now()));
    return settings
      ? {
        configured: true,
        serviceUrl: settings.serviceUrl,
        hasR2: Boolean(settings.r2.accessKeyId),
        hasAdminSession,
        adminSessionExpiresAt: settings.adminSessionExpiresAt,
        hasBootstrapKey: Boolean(settings.adminKey),
        r2AccountId: settings.r2.accountId,
        r2BucketName: settings.r2.bucketName,
        sourceDirectory: settings.sourceDirectory
      }
      : {
        configured: false,
        serviceUrl: '',
        hasR2: false,
        hasAdminSession: false,
        hasBootstrapKey: false,
        sourceDirectory: ''
      };
  });

  ipcMain.handle('admin:save-settings', async (event, input) => {
    requireTrusted(event);
    return saveSettings(input);
  });

  ipcMain.handle('admin:test-connection', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Save the Render service URL first.');
    const data = await requestAdmin(settings, '/api/admin/users');
    if (!Array.isArray(data.accounts)) throw new Error('Render returned an invalid account list.');
    return { connected: true, accountCount: data.accounts.length };
  });

  ipcMain.handle('admin:enroll-passkey', async (event) => {
    requireTrusted(event);
    return runPasskeyFlow(await loadSettings(), 'enroll');
  });

  ipcMain.handle('admin:sign-in-passkey', async (event) => {
    requireTrusted(event);
    return runPasskeyFlow(await loadSettings(), 'login');
  });

  ipcMain.handle('admin:add-passkey', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings || !settings.adminSessionToken) {
      throw new Error('Sign in with your passkey before adding another credential.');
    }
    if (settings.adminSessionExpiresAt &&
        new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
      throw new Error('Your Admin session expired. Sign in with your passkey again.');
    }
    const response = await fetch(new URL('/api/admin/passkeys/credentials/ticket', `${settings.serviceUrl}/`), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.adminSessionToken}`
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Could not create a passkey ticket (HTTP ${response.status}).`);
    if (typeof data.ticket !== 'string' || !data.ticket) throw new Error('Render returned an invalid passkey ticket.');
    const fragment = new URLSearchParams({ action: 'register', ticket: data.ticket });
    await shell.openExternal(`${settings.serviceUrl}/admin/passkeys#${fragment.toString()}`);
    return { opened: true };
  });

  ipcMain.handle('admin:sign-out', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Configure the Render service URL first.');
    let revocationError = null;
    try {
      const data = await requestAdmin(settings, '/api/admin/sessions');
      const currentSession = Array.isArray(data.sessions)
        ? data.sessions.find((session) => session.isCurrent)
        : null;
      if (!currentSession || typeof currentSession.id !== 'string') {
        throw new Error("Render could not identify this computer's Admin session.");
      }
      await requestAdmin(
        settings,
        `/api/admin/sessions/${encodeURIComponent(currentSession.id)}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      revocationError = error;
    }
    await saveAdminSession('', '');
    if (revocationError) {
      throw new Error(`Signed out locally, but Render could not revoke the server session: ${revocationError.message}`);
    }
    return { signedOut: true };
  });

  ipcMain.handle('admin:list-sessions', async (event) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/sessions');
    if (!Array.isArray(data.sessions)) throw new Error('Render returned an invalid Admin session list.');
    return data;
  });

  ipcMain.handle('admin:revoke-session', async (event, sessionId) => {
    requireTrusted(event);
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{24}$/i.test(sessionId)) {
      throw new TypeError('Choose a valid Admin session.');
    }
    return requestAdmin(await loadSettings(), `/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE'
    });
  });

  ipcMain.handle('admin:list-users', async (event) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/users');
    if (!Array.isArray(data.accounts)) throw new Error('Render returned an invalid account list.');
    return data.accounts;
  });

  ipcMain.handle('admin:list-backups', async (event) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/backups');
    if (!Array.isArray(data.databases) || !Array.isArray(data.sources) || !Array.isArray(data.backups)) {
      throw new Error('Render returned invalid collection backup data.');
    }
    return data;
  });

  ipcMain.handle('admin:get-replacement-options', async (event, target) => {
    requireTrusted(event);
    if (!target || typeof target.database !== 'string' ||
        typeof target.collection !== 'string' || !target.database || !target.collection) {
      throw new TypeError('Choose a valid target collection.');
    }
    const query = new URLSearchParams({
      database: target.database,
      collection: target.collection
    });
    const data = await requestAdmin(
      await loadSettings(),
      `/api/admin/collections/replace-options?${query}`
    );
    if (!Array.isArray(data.backups) || typeof data.csvSupported !== 'boolean' ||
        !Array.isArray(data.events)) {
      throw new Error('Render returned invalid replacement options.');
    }
    return data;
  });

  ipcMain.handle('admin:choose-replacement-csv', async (event) => {
    requireTrusted(event);
    const choice = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'CSV files', extensions: ['csv'] }]
    });
    if (choice.canceled || !choice.filePaths.length) return { canceled: true };
    const filePath = choice.filePaths[0];
    if (path.extname(filePath).toLowerCase() !== '.csv') throw new TypeError('Choose a .csv file.');
    const fileStats = await fs.stat(filePath);
    if (!fileStats.isFile() || fileStats.size === 0) throw new TypeError('Choose a non-empty CSV file.');
    if (fileStats.size > MAX_REPLACEMENT_CSV_BYTES) {
      throw new TypeError('CSV files must be 10 MB or smaller.');
    }
    replacementCsvSelection = {
      token: crypto.randomUUID(),
      filePath,
      fileName: path.basename(filePath)
    };
    return {
      canceled: false,
      token: replacementCsvSelection.token,
      fileName: replacementCsvSelection.fileName,
      size: fileStats.size
    };
  });

  ipcMain.handle('admin:replace-from-backup', async (event, input) => {
    requireTrusted(event);
    if (!input || typeof input.database !== 'string' || typeof input.collection !== 'string' ||
        typeof input.backupCollection !== 'string' ||
        !input.database || !input.collection || !input.backupCollection) {
      throw new TypeError('Choose a target collection and an eligible backup snapshot.');
    }
    const data = await requestAdmin(await loadSettings(), '/api/admin/collections/replace-backup', {
      method: 'POST',
      body: {
        database: input.database,
        collection: input.collection,
        backupCollection: input.backupCollection
      },
      timeoutMs: 300000
    });
    if (!Number.isInteger(data.documentCount) || !Number.isInteger(data.indexCount)) {
      throw new Error('Render returned invalid collection replacement results.');
    }
    return data;
  });

  ipcMain.handle('admin:replace-from-csv', async (event, input) => {
    requireTrusted(event);
    if (!input || typeof input.database !== 'string' || typeof input.collection !== 'string' ||
        typeof input.csvToken !== 'string' || !input.database || !input.collection ||
        !replacementCsvSelection || input.csvToken !== replacementCsvSelection.token) {
      throw new TypeError('Choose the CSV file and target collection again.');
    }
    if (!['normalized', 'event-sheet'].includes(input.format)) {
      throw new TypeError('Choose a supported CSV format.');
    }
    if (input.eventId !== undefined && typeof input.eventId !== 'string') {
      throw new TypeError('The selected Hoedown event is invalid.');
    }
    const fileStats = await fs.stat(replacementCsvSelection.filePath);
    if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_REPLACEMENT_CSV_BYTES) {
      throw new TypeError('The selected CSV file is empty or exceeds the 10 MB limit.');
    }
    const fileContents = await fs.readFile(replacementCsvSelection.filePath);
    const query = new URLSearchParams({
      database: input.database,
      collection: input.collection,
      format: input.format
    });
    if (input.eventId) query.set('eventId', input.eventId);
    const data = await requestAdmin(
      await loadSettings(),
      `/api/admin/collections/replace-csv?${query}`,
      { method: 'POST', rawBody: fileContents, timeoutMs: 300000 }
    );
    if (!Number.isInteger(data.documentCount) || !Number.isInteger(data.indexCount)) {
      throw new Error('Render returned invalid CSV replacement results.');
    }
    replacementCsvSelection = null;
    return data;
  });

  ipcMain.handle('admin:create-backups', async (event, collections) => {
    requireTrusted(event);
    if (!Array.isArray(collections) || collections.length < 1 || collections.length > 25 ||
        collections.some((item) => !item || typeof item.database !== 'string' ||
          typeof item.collection !== 'string' || !item.database || !item.collection)) {
      throw new TypeError('Select between 1 and 25 valid collections to back up.');
    }
    const data = await requestAdmin(await loadSettings(), '/api/admin/backups', {
      method: 'POST',
      body: { collections },
      timeoutMs: 300000
    });
    if (!Array.isArray(data.results) ||
        data.results.some((result) => typeof result.success !== 'boolean')) {
      throw new Error('Render returned invalid collection backup results.');
    }
    return data;
  });

  ipcMain.handle('admin:download-database-export', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings || !settings.adminSessionToken) {
      throw new Error('Sign in with your passkey before using Admin.');
    }
    if (settings.adminSessionExpiresAt &&
        new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
      throw new Error('Your Admin session expired. Sign in with your passkey again.');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Download full database export',
      defaultPath: `hoedown-database-export-${timestamp}.jsonl.gz`,
      filters: [{ name: 'Gzip-compressed database export', extensions: ['gz'] }]
    });
    if (choice.canceled) return { canceled: true };
    if (typeof choice.filePath !== 'string' || !choice.filePath) {
      throw new Error('Choose a destination for the database export.');
    }
    if (!choice.filePath.toLowerCase().endsWith('.gz')) {
      throw new TypeError('Save the database export with the .gz extension.');
    }

    const fileName = await downloadDatabaseExport(settings, choice.filePath);
    return { canceled: false, fileName };
  });

  ipcMain.handle('admin:restore-database-export', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings || !settings.adminSessionToken) {
      throw new Error('Sign in with your passkey before using Admin.');
    }
    if (settings.adminSessionExpiresAt &&
        new Date(settings.adminSessionExpiresAt).getTime() <= Date.now()) {
      throw new Error('Your Admin session expired. Sign in with your passkey again.');
    }

    const choice = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a full database export to restore',
      properties: ['openFile'],
      filters: [{ name: 'Hoedown database export', extensions: ['gz'] }]
    });
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    const filePath = choice.filePaths[0];
    if (!filePath.toLowerCase().endsWith('.jsonl.gz')) {
      throw new TypeError('Choose a .jsonl.gz database export file.');
    }

    const result = await restoreDatabaseExport(settings, filePath);
    return {
      ...result,
      canceled: false,
      fileName: path.basename(filePath)
    };
  });

  ipcMain.handle('admin:wipe-collections', async (event, collections) => {
    requireTrusted(event);
    if (!Array.isArray(collections) || collections.length < 1 || collections.length > 25 ||
        collections.some((item) => !item || typeof item.database !== 'string' ||
          typeof item.collection !== 'string' || !item.database || !item.collection)) {
      throw new TypeError('Select between 1 and 25 valid collections to wipe.');
    }
    const data = await requestAdmin(await loadSettings(), '/api/admin/collections/wipe', {
      method: 'POST',
      body: { collections },
      timeoutMs: 300000
    });
    if (!Array.isArray(data.results) ||
        data.results.some((result) => typeof result.success !== 'boolean' ||
          (result.success && !Number.isInteger(result.deletedCount)))) {
      throw new Error('Render returned invalid collection wipe results.');
    }
    return data;
  });

  ipcMain.handle('admin:get-bot-settings', async (event) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/bot-settings');
    if (!data.settings || typeof data.settings !== 'object') {
      throw new Error('Render returned invalid bot settings.');
    }
    return data;
  });

  ipcMain.handle('admin:save-bot-settings', async (event, settings) => {
    requireTrusted(event);
    const data = await requestAdmin(await loadSettings(), '/api/admin/bot-settings', {
      method: 'PUT',
      body: { settings }
    });
    if (!data.settings || typeof data.settings !== 'object') {
      throw new Error('Render returned invalid bot settings.');
    }
    return data;
  });

  ipcMain.handle('admin:create-user', async (event, value) => {
    requireTrusted(event);
    const username = String(value && value.username || '').trim().toLowerCase();
    const discordId = String(value && value.discordId || '').trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new TypeError('Username is invalid.');
    if (discordId && !/^\d{17,20}$/.test(discordId)) throw new TypeError('Discord user ID is invalid.');
    const data = await requestAdmin(await loadSettings(), '/api/admin/users', {
      method: 'POST',
      body: { username, discordId }
    });
    if (data.username !== username || typeof data.password !== 'string') {
      throw new Error('Render returned incomplete account details.');
    }
    return data;
  });

  ipcMain.handle('admin:link-discord', async (event, input) => {
    requireTrusted(event);
    const username = String(input && input.username || '').trim().toLowerCase();
    const discordId = String(input && input.discordId || '').trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) ||
        (discordId && !/^\d{17,20}$/.test(discordId))) {
      throw new TypeError('A valid username and Discord user ID are required.');
    }
    const data = await requestAdmin(await loadSettings(), '/api/admin/users/link-discord', {
      method: 'POST',
      body: { username, discordId }
    });
    if (data.username !== username) throw new Error('Render returned an unexpected account.');
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
    if (!current) throw new Error('Configure the Render service URL first.');
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
    if (!current) throw new Error('Save the Render service URL before selecting a source folder.');
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    saved.sourceDirectory = sourceDirectory.rootDirectory;
    await fs.writeFile(settingsPath(), JSON.stringify(saved), 'utf8');
    return { canceled: false, sourceDirectory: sourceDirectory.rootDirectory };
  });

  ipcMain.handle('release:set-channel', async (event, channel) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Configure the Render service URL first.');
    return setChannel(getSourceRoot(settings), channel, settings.serviceUrl);
  });

  ipcMain.handle('release:fetch-versions', async (event) => {
    requireTrusted(event);
    const settings = await loadSettings();
    if (!settings) throw new Error('Configure the Render service URL first.');
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
        if (!settings) throw new Error('Configure the Render service URL before building.');
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
