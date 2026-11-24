const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { createProfileStore } = require('./profile-store.cjs');

let mainWindow;
let sessionToken = null;
let username = '';
let activeProfileId = null;
let activeProfile = null;
let profileStore;
let authConfig = {};
let deviceInfo;
let statusTimer;
let memberLiveController;
let memberLiveGeneration = 0;
let updateProvider;
let updateDownloaded = false;
const THEME_COLOR_FIELDS = [
  'background',
  'surface',
  'accent',
  'accentText',
  'text',
  'muted',
  'border'
];

function normalizeDiscordAvatarUrl(value) {
  return typeof value === 'string' && value.length <= 512 &&
    /^https:\/\/cdn\.discordapp\.com\//.test(value)
    ? value
    : '';
}

function isRoundActionState(value) {
  return value && typeof value === 'object' &&
    typeof value.running === 'boolean' &&
    (value.lastClickedBy === null ||
      value.lastClickedBy && typeof value.lastClickedBy.username === 'string' &&
      typeof value.lastClickedBy.discordUsername === 'string' &&
      (typeof value.lastClickedBy.avatarUrl === 'undefined' ||
        typeof value.lastClickedBy.avatarUrl === 'string' &&
        (value.lastClickedBy.avatarUrl === '' ||
          normalizeDiscordAvatarUrl(value.lastClickedBy.avatarUrl) === value.lastClickedBy.avatarUrl))) &&
    (value.lastClickedAt === null || typeof value.lastClickedAt === 'string') &&
    ['none', 'running', 'success', 'failed'].includes(value.lastOutcome);
}

function isThemeColorSet(colors) {
  return colors && typeof colors === 'object' && !Array.isArray(colors) &&
    Object.keys(colors).length === THEME_COLOR_FIELDS.length &&
    Object.keys(colors).every((field) => THEME_COLOR_FIELDS.includes(field)) &&
    THEME_COLOR_FIELDS.every((field) =>
      typeof colors[field] === 'string' && /^#[0-9a-f]{6}$/i.test(colors[field])
    );
}

function serviceUrl() {
  if (typeof authConfig.apiBaseUrl !== 'string' || !authConfig.apiBaseUrl.trim()) {
    throw new Error('The sign-in service URL is not configured in desktop/auth-config.json.');
  }
  let url;
  try {
    url = new URL(authConfig.apiBaseUrl);
  } catch {
    throw new Error('The sign-in service URL is invalid.');
  }
  const local = !app.isPackaged && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('The sign-in service must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The sign-in service URL must not include credentials or query parameters.');
  }
  return url.origin;
}

function tokenFile() {
  if (!profileStore || !activeProfileId) {
    throw new Error('Select an app profile before accessing its saved session.');
  }
  return profileStore.sessionPath(activeProfileId);
}

async function loadDeviceInfo() {
  const file = path.join(app.getPath('userData'), 'device.json');
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof saved.deviceId === 'string') {
      return { deviceId: saved.deviceId, launchId: crypto.randomUUID() };
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const value = { deviceId: crypto.randomUUID(), launchId: crypto.randomUUID() };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ deviceId: value.deviceId }), 'utf8');
  return value;
}

async function saveToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure session storage is unavailable on this computer.');
  }
  const encryptedToken = safeStorage.encryptString(token).toString('base64');
  await fs.mkdir(path.dirname(tokenFile()), { recursive: true });
  await fs.writeFile(tokenFile(), JSON.stringify({ encryptedToken }), 'utf8');
}

async function clearToken() {
  stopMembersLiveUpdates();
  try {
    await fs.unlink(tokenFile());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  sessionToken = null;
  username = '';
}

function sendMembersLiveStatus(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('members:live-status', state);
  }
}

function stopMembersLiveUpdates() {
  memberLiveGeneration += 1;
  if (memberLiveController) memberLiveController.abort();
  memberLiveController = null;
  sendMembersLiveStatus({ connected: false });
}

function startMembersLiveUpdates() {
  if (!sessionToken || !mainWindow) return;
  if (memberLiveController) memberLiveController.abort();
  const token = sessionToken;
  const controller = new AbortController();
  memberLiveController = controller;
  const generation = ++memberLiveGeneration;
  let retryDelay = 1000;
  sendMembersLiveStatus({ connected: false, connecting: true });

  const receiveFrame = async (frame) => {
    let eventName = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    let data;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch (error) {
      console.error('Could not parse a Members live-update event:', error);
      return;
    }

    if (eventName === 'session-expired') {
      await clearToken();
      sendStatus({ signedIn: false, error: data.error || 'Session expired. Please sign in again.' });
    } else if (eventName === 'rounds-action-status') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rounds:action-status', data);
      }
    } else if (eventName === 'round-draft-updated') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rounds:draft-updated', data);
      }
    } else if (
      eventName === 'member' ||
      eventName === 'resync' ||
      eventName === 'avoids-resync' ||
      eventName === 'tickets-resync' ||
      eventName === 'ticket-message'
    ) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (eventName === 'member') mainWindow.webContents.send('members:changed', data);
        else if (eventName === 'avoids-resync') mainWindow.webContents.send('avoids:resync', data);
        else if (eventName === 'tickets-resync') mainWindow.webContents.send('tickets:resync', data);
        else if (eventName === 'ticket-message') mainWindow.webContents.send('tickets:message', data);
        else mainWindow.webContents.send('members:resync', data);
      }
    }
  };

  void (async () => {
    while (!controller.signal.aborted && generation === memberLiveGeneration && sessionToken === token) {
      try {
        const response = await fetch(new URL('/api/members/stream', `${serviceUrl()}/`), {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
        if (response.status === 401) {
          await response.body?.cancel();
          await clearToken();
          sendStatus({ signedIn: false, error: 'Session expired. Please sign in again.' });
          return;
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error(`The live member service returned HTTP ${response.status}.`);
        }

        retryDelay = 1000;
        sendMembersLiveStatus({ connected: true });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            await receiveFrame(frame);
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (controller.signal.aborted) return;
        throw new Error('The live member update connection closed.');
      } catch (error) {
        if (controller.signal.aborted || generation !== memberLiveGeneration || sessionToken !== token) return;
        console.error('Members live-update connection failed:', error);
        sendMembersLiveStatus({ connected: false, reconnecting: true });
      }

      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, retryDelay);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  })();
}

async function readToken() {
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(tokenFile(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read the saved sign-in session: ${error.message}`);
  }
  if (!safeStorage.isEncryptionAvailable() || typeof saved.encryptedToken !== 'string') {
    throw new Error('Secure session storage is unavailable or the saved session is invalid.');
  }
  try {
    return safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
  } catch (error) {
    await clearToken();
    throw new Error(`Could not decrypt the saved sign-in session: ${error.message}`);
  }
}

async function requestApi(route, { method = 'GET', token, body, headers = {}, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const response = await fetch(new URL(route, `${serviceUrl()}/`), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    let data;
    try {
      data = await response.json();
    } catch {
      if (route === '/api/members' && response.status === 404) {
        throw new Error('The Members API is not deployed on the sign-in service yet. Deploy the updated bot service and try again.');
      }
      if (!response.ok) {
        throw new Error(`The sign-in service returned HTTP ${response.status} with a non-JSON response.`);
      }
      throw new Error('The sign-in service returned an invalid response.');
    }
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function isRoundDraft(value) {
  return value && typeof value === 'object' &&
    typeof value.generationId === 'string' &&
    Number.isSafeInteger(value.round) &&
    value.status === 'pending' &&
    Array.isArray(value.teams) &&
    value.teams.every((team) => team && typeof team.name === 'string' &&
      Array.isArray(team.players) && team.players.every((player) =>
        player && typeof player.discordId === 'string' &&
        typeof player.name === 'string' && typeof player.region === 'string')) &&
    value.pairingRelations && typeof value.pairingRelations === 'object' &&
    Array.isArray(value.pairingRelations.avoids) &&
    value.pairingRelations.avoids.every((pair) => pair &&
      typeof pair.discordIdA === 'string' && typeof pair.discordIdB === 'string') &&
    Array.isArray(value.pairingRelations.previousPairings) &&
    value.pairingRelations.previousPairings.every((pair) => pair &&
      typeof pair.discordIdA === 'string' && typeof pair.discordIdB === 'string') &&
    Array.isArray(value.reviewActivity) &&
    value.reviewActivity.every((reviewer) => reviewer &&
      typeof reviewer.discordId === 'string' && typeof reviewer.username === 'string' &&
      typeof reviewer.discordUsername === 'string' &&
      (reviewer.avatarUrl === '' ||
        normalizeDiscordAvatarUrl(reviewer.avatarUrl) === reviewer.avatarUrl) &&
      (reviewer.vote === null || ['approve', 'changes'].includes(reviewer.vote))) &&
    ['approve', 'changes', null].includes(value.myVote) &&
    typeof value.previewStatus === 'string';
}

async function requestRoundDraftApi(event, route, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted Team Check draft request.');
  }
  try {
    if (!sessionToken) sessionToken = await readToken();
    if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
    const { response, data } = await requestApi(route, {
      method,
      body,
      timeoutMs,
      token: sessionToken
    });
    if (response.status === 401) {
      await clearToken();
      sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
      return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: data.error || 'Could not load the Team Check draft.',
        partial: data.partial === true,
        ...(isRoundDraft(data.draft) ? { draft: data.draft } : {})
      };
    }
    if (!isRoundDraft(data.draft)) {
      throw new Error('The service returned an invalid Team Check draft.');
    }
    return { ok: true, draft: data.draft };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not reach the round service.' };
  }
}

async function requestSettingsApi(event, route, options = {}) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted app settings request.');
  }
  try {
    if (!sessionToken) sessionToken = await readToken();
    if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
    const { response, data } = await requestApi(route, { ...options, token: sessionToken });
    if (response.status === 401) {
      await clearToken();
      sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
      return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
    }
    if (!response.ok) return { ok: false, error: data.error || 'Could not save app settings.' };
    if (data.themeColors !== null && !isThemeColorSet(data.themeColors)) {
      throw new Error('The service returned invalid app color settings.');
    }
    return { ok: true, themeColors: data.themeColors };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not reach the settings service.' };
  }
}

function sendStatus(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:status', state);
}

function sendUpdateStatus(message, ready = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-status', { message, ready });
  }
}

function configureUpdater() {
  if (!app.isPackaged) return;
  if (!['beta', 'stable'].includes(authConfig.updateChannel)) {
    throw new Error('Set updateChannel to beta or stable in desktop/auth-config.json.');
  }
  const feedUrl = new URL(`/api/app-updates/${authConfig.updateChannel}/`, `${serviceUrl()}/`).href;
  updateProvider = new NsisUpdater({ provider: 'generic', url: feedUrl });
  updateProvider.autoDownload = false;
  updateProvider.autoInstallOnAppQuit = false;
  updateProvider.on('download-progress', (progress) => {
    sendUpdateStatus(`Downloading update: ${Math.round(progress.percent)}%`);
  });
  updateProvider.on('update-downloaded', () => {
    updateDownloaded = true;
    sendUpdateStatus('Update downloaded and ready to install.', true);
  });
  updateProvider.on('error', (error) => {
    console.error('Desktop update error:', error);
    sendUpdateStatus('Could not complete the update check or download.');
  });
}

async function checkForUpdate() {
  if (!updateProvider || !sessionToken) return;
  try {
    updateProvider.requestHeaders = { Authorization: `Bearer ${sessionToken}` };
    const result = await updateProvider.checkForUpdates();
    updateProvider.requestHeaders = null;
    if (result && result.isUpdateAvailable) {
      sendUpdateStatus('A new version is available. Downloading…');
      await updateProvider.downloadUpdate();
    } else {
      sendUpdateStatus('You are using the latest version.');
    }
  } catch (error) {
    if (updateProvider) updateProvider.requestHeaders = null;
    console.error('Desktop update check failed:', error);
    sendUpdateStatus('Could not check for updates. Try again later.');
  }
}

async function checkSession() {
  if (!sessionToken) return { signedIn: false };
  const { response, data } = await requestApi('/api/auth/session', {
    token: sessionToken,
    headers: {
      'X-App-Device-Id': deviceInfo.deviceId,
      'X-App-Launch-Id': deviceInfo.launchId,
      'X-App-Device-Name': os.hostname(),
      'X-App-Platform': process.platform,
      'X-App-Version': app.getVersion()
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      await clearToken();
      return { signedIn: false, error: data.error || 'Your session expired. Sign in again.' };
    }
    throw new Error(data.error || `The sign-in service returned HTTP ${response.status}.`);
  }
  username = data.username;
  return { signedIn: true, username, avatarUrl: normalizeDiscordAvatarUrl(data.avatarUrl) };
}

async function getCurrentAuthStatus(recordLaunch = false) {
  if (!activeProfileId) {
    try {
      return {
        signedIn: false,
        profileSelection: true,
        profiles: await profileStore.listProfiles()
      };
    } catch (error) {
      return {
        signedIn: false,
        profileSelection: true,
        profiles: [],
        error: error.message || 'Could not load saved app profiles.'
      };
    }
  }

  try {
    if (!sessionToken) sessionToken = await readToken();
    const state = await checkSession();
    if (!state.signedIn) {
      return {
        ...state,
        profileSelected: true,
        profileName: activeProfile?.username || ''
      };
    }
    let avatarUrl = state.avatarUrl;

    if (recordLaunch) {
      const { response, data } = await requestApi('/api/auth/session', {
        token: sessionToken,
        headers: {
          'X-App-Device-Id': deviceInfo.deviceId,
          'X-App-Launch-Id': deviceInfo.launchId,
          'X-App-Device-Name': os.hostname(),
          'X-App-Platform': process.platform,
          'X-App-Version': app.getVersion(),
          'X-App-Launch': 'true'
        }
      });
      if (response.status === 401) {
        await clearToken();
        return {
          signedIn: false,
          profileSelected: true,
          profileName: activeProfile?.username || '',
          error: data.error || 'Your session expired. Sign in again.'
        };
      }
      if (!response.ok) throw new Error(data.error || 'Session check failed.');
      username = data.username;
      avatarUrl = normalizeDiscordAvatarUrl(data.avatarUrl);
    }

    activeProfile = await profileStore.updateAccount(activeProfileId, username, avatarUrl);
    if (recordLaunch) {
      void checkForUpdate();
      startMembersLiveUpdates();
    }
    return { signedIn: true, username, avatarUrl };
  } catch (error) {
    return {
      signedIn: false,
      profileSelected: true,
      profileName: activeProfile?.username || '',
      error: error.message || 'Could not reach the sign-in service.'
    };
  }
}

app.whenReady().then(async () => {
  authConfig = JSON.parse(await fs.readFile(path.join(__dirname, 'auth-config.json'), 'utf8'));
  profileStore = createProfileStore(app.getPath('userData'));
  await profileStore.migrateLegacySession();
  deviceInfo = await loadDeviceInfo();
  configureUpdater();

  ipcMain.handle('auth:get-status', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted status request.');
    return getCurrentAuthStatus(true);
  });

  ipcMain.handle('auth:select-profile', async (event, profileId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted profile selection request.');
    const profile = await profileStore.readProfile(profileId);
    if (!profile) {
      return {
        signedIn: false,
        profileSelection: true,
        profiles: await profileStore.listProfiles(),
        error: 'That saved profile could not be found.'
      };
    }
    stopMembersLiveUpdates();
    activeProfileId = profile.id;
    activeProfile = profile;
    sessionToken = null;
    username = '';
    return getCurrentAuthStatus(true);
  });

  ipcMain.handle('auth:create-profile', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted profile creation request.');
    if (activeProfileId) throw new Error('Return to the profile list before adding another sign-in.');
    const profile = await profileStore.createProfile();
    activeProfileId = profile.id;
    activeProfile = profile;
    sessionToken = null;
    username = '';
    return { signedIn: false, profileSelected: true, profileName: '' };
  });

  ipcMain.handle('auth:delete-profile', async (event, profileId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted profile deletion request.');
    if (activeProfileId) throw new Error('Return to the profile list before deleting a profile.');
    const deleted = await profileStore.deleteProfile(profileId);
    if (!deleted) {
      return {
        ...(await getCurrentAuthStatus()),
        error: 'That saved profile could not be found.'
      };
    }
    return { ...(await getCurrentAuthStatus()), profileDeleted: true };
  });

  ipcMain.handle('auth:back-to-profiles', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted profile navigation request.');
    stopMembersLiveUpdates();
    activeProfileId = null;
    activeProfile = null;
    sessionToken = null;
    username = '';
    return getCurrentAuthStatus();
  });

  ipcMain.handle('auth:login', async (event, credentials) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted sign-in request.');
    if (!activeProfileId) return { ok: false, error: 'Choose or create a profile before signing in.' };
    if (!credentials || typeof credentials.username !== 'string' ||
        typeof credentials.password !== 'string' || credentials.username.length > 64 ||
        credentials.password.length > 128) {
      return { ok: false, error: 'Enter a valid username and password.' };
    }
    try {
      const { response, data } = await requestApi('/api/auth/login', {
        method: 'POST',
        body: {
          username: credentials.username,
          password: credentials.password,
          appVersion: app.getVersion(),
          deviceId: deviceInfo.deviceId,
          launchId: deviceInfo.launchId,
          deviceName: os.hostname(),
          platform: process.platform
        }
      });
      if (!response.ok) return { ok: false, error: data.error || 'Sign-in failed. Try again.' };
      if (data.passwordChangeRequired === true) {
        if (typeof data.resetToken !== 'string') throw new Error('The service returned an invalid password-change request.');
        activeProfile = await profileStore.updateAccount(
          activeProfileId,
          credentials.username.trim(),
          normalizeDiscordAvatarUrl(data.avatarUrl)
        );
        return { ok: true, passwordChangeRequired: true, resetToken: data.resetToken };
      }
      if (typeof data.token !== 'string' || typeof data.username !== 'string') {
        throw new Error('The service returned an invalid session.');
      }
      activeProfile = await profileStore.updateAccount(
        activeProfileId,
        data.username,
        normalizeDiscordAvatarUrl(data.avatarUrl)
      );
      await saveToken(data.token);
      sessionToken = data.token;
      username = data.username;
      void checkForUpdate();
      startMembersLiveUpdates();
      return { ok: true, signedIn: true, username };
    } catch (error) {
      return { ok: false, error: error.name === 'AbortError'
        ? 'Sign-in timed out. Check your connection and retry.'
        : error.message || 'Could not reach the sign-in service.' };
    }
  });

  ipcMain.handle('auth:change-password', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted password-change request.');
    if (!input || typeof input.token !== 'string' || typeof input.password !== 'string') {
      return { ok: false, error: 'Enter a valid new password.' };
    }
    try {
      const { response, data } = await requestApi('/api/auth/change-password', {
        method: 'POST',
        token: input.token,
        body: { password: input.password }
      });
      return response.ok && data.passwordChanged === true
        ? { ok: true }
        : { ok: false, error: data.error || 'Could not change the password.' };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the sign-in service.' };
    }
  });

  ipcMain.handle('auth:update-password', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted password update request.');
    if (!input || typeof input.currentPassword !== 'string' || typeof input.password !== 'string') {
      return { ok: false, error: 'Enter your current password and a valid new password.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/auth/change-password', {
        method: 'POST',
        token: sessionToken,
        body: { currentPassword: input.currentPassword, password: input.password }
      });
      if (!response.ok) return { ok: false, error: data.error || 'Could not update password.' };
      if (data.passwordChanged !== true || data.sessionsRevoked !== true || typeof data.token !== 'string') {
        throw new Error('The service did not return a valid updated session.');
      }
      await saveToken(data.token);
      sessionToken = data.token;
      startMembersLiveUpdates();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not update password.' };
    }
  });

  ipcMain.handle('auth:logout', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted sign-out request.');
    let warning = '';
    try {
      if (sessionToken) {
        const { response, data } = await requestApi('/api/auth/logout', { method: 'POST', token: sessionToken });
        if (!response.ok && response.status !== 401) throw new Error(data.error || 'Server sign-out failed.');
      }
    } catch {
      warning = 'Signed out on this computer, but the service could not confirm session revocation.';
    }
    await clearToken();
    stopMembersLiveUpdates();
    activeProfileId = null;
    activeProfile = null;
    username = '';
    return { ...(await getCurrentAuthStatus()), warning };
  });

  ipcMain.handle('settings:get', (event) =>
    requestSettingsApi(event, '/api/settings'));
  ipcMain.handle('settings:save-theme-colors', (event, colors) => {
    if (!isThemeColorSet(colors)) {
      return { ok: false, error: 'Enter valid app colors before saving.' };
    }
    return requestSettingsApi(event, '/api/settings/theme-colors', {
      method: 'PUT',
      body: { colors }
    });
  });
  ipcMain.handle('settings:reset-theme-colors', (event) =>
    requestSettingsApi(event, '/api/settings/theme-colors', { method: 'DELETE' }));

  ipcMain.handle('members:list', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted member list request.');
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/members', { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load Members.' };
      if (!Array.isArray(data.members)) throw new Error('The service returned an invalid member list.');
      return { ok: true, members: data.members, truncated: data.truncated === true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the member service.' };
    }
  });

  ipcMain.handle('members:update', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted member update request.');
    }
    if (!input || typeof input.discordId !== 'string' || !/^\d{17,20}$/.test(input.discordId) ||
        !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
      return { ok: false, error: 'Enter valid member profile fields.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi(`/api/members/${encodeURIComponent(input.discordId)}`, {
        method: 'PATCH',
        token: sessionToken,
        body: input.fields
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not save member changes.' };
      if (!data.member || data.member.discordId !== input.discordId) {
        throw new Error('The service returned an invalid updated member.');
      }
      return { ok: true, member: data.member };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the member service.' };
    }
  });

  ipcMain.handle('avoids:list', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted avoid list request.');
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/avoids', { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load Avoids.' };
      if (!Array.isArray(data.pairs)) throw new Error('The service returned an invalid Avoids list.');
      return { ok: true, pairs: data.pairs };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the avoid service.' };
    }
  });

  ipcMain.handle('avoids:create', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted avoid pairing request.');
    }
    if (!input || typeof input.avoiderDiscordId !== 'string' ||
        !/^\d{17,20}$/.test(input.avoiderDiscordId) ||
        !Array.isArray(input.avoidedDiscordIds) || input.avoidedDiscordIds.length === 0 ||
        input.avoidedDiscordIds.some((discordId) =>
          typeof discordId !== 'string' || !/^\d{17,20}$/.test(discordId))) {
      return { ok: false, error: 'Select an avoider and at least one valid Avoiding member.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/avoids', {
        method: 'POST',
        token: sessionToken,
        body: input,
        timeoutMs: 60000
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not save the Avoid Pairing.' };
      if (data.success !== true ||
          !Number.isSafeInteger(data.googleSheets?.addedPairs) ||
          !Number.isSafeInteger(data.googleSheets?.skippedPairs) ||
          !Number.isSafeInteger(data.mongodb?.relationshipCount)) {
        throw new Error('The service returned an invalid Avoid Pairing result.');
      }
      return {
        ok: true,
        googleSheets: data.googleSheets,
        mongodb: data.mongodb
      };
    } catch (error) {
      return {
        ok: false,
        error: error.name === 'AbortError'
          ? 'Saving the Avoid Pairing timed out. It may still complete; refresh Avoids before retrying.'
          : error.message || 'Could not reach the avoid service.'
      };
    }
  });

  ipcMain.handle('rounds:grab-reactions', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted round generation request.');
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/rounds/grab-reactions', {
        method: 'POST',
        token: sessionToken,
        timeoutMs: 120000
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Could not generate the next round draft.',
          partial: data.partial === true,
          round: Number.isSafeInteger(data.round) ? data.round : null,
          roundActionState: isRoundActionState(data.roundActionState) ? data.roundActionState : null
        };
      }
      if (!Number.isSafeInteger(data.round) ||
          !Number.isSafeInteger(data.reactedPlayerCount) ||
          !Number.isSafeInteger(data.eligiblePlayerCount) ||
          !Number.isSafeInteger(data.excludedPlayerCount) ||
          typeof data.conflictsFound !== 'boolean' ||
          !Array.isArray(data.conflictDetails) ||
          !data.conflictDetails.every((detail) => typeof detail === 'string') ||
          data.conflictsFound !== (data.conflictDetails.length > 0) ||
          !['posted', 'disabled'].includes(data.postingStatus) ||
          !isRoundActionState(data.roundActionState)) {
        throw new Error('The service returned an invalid round-generation result.');
      }
      return {
        ok: true,
        round: data.round,
        reactedPlayerCount: data.reactedPlayerCount,
        eligiblePlayerCount: data.eligiblePlayerCount,
        excludedPlayerCount: data.excludedPlayerCount,
        conflictsFound: data.conflictsFound,
        conflictDetails: data.conflictDetails,
        postingStatus: data.postingStatus,
        roundActionState: data.roundActionState
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the round service.' };
    }
  });

  ipcMain.handle('rounds:get-status', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted round action status request.');
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi('/api/rounds/grab-reactions/status', {
        token: sessionToken
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load round action status.' };
      if (!isRoundActionState(data)) throw new Error('The service returned an invalid round action status.');
      return { ok: true, state: data };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not load round action status.' };
    }
  });

  ipcMain.handle('rounds:get-current-draft', (event) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current'));
  ipcMain.handle('rounds:open-current-draft', (event) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/open', {
      method: 'POST'
    }));
  ipcMain.handle('rounds:update-current-draft-presence', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/presence', {
      method: 'POST',
      body: input
    }));
  ipcMain.handle('rounds:review-current-draft', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/review', {
      method: 'POST',
      body: input
    }));
  ipcMain.handle('rounds:add-current-draft-filler-team', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/add-filler-team', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));
  ipcMain.handle('rounds:delete-current-draft-filler-team', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/delete-filler-team', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));
  ipcMain.handle('rounds:replace-current-draft-player', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/replace-player', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));
  ipcMain.handle('rounds:replace-current-draft-player-with-filler', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/replace-player-with-filler', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));
  ipcMain.handle('rounds:fill-current-draft-slot', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/fill-slot', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));
  ipcMain.handle('rounds:swap-current-draft-players', (event, input) =>
    requestRoundDraftApi(event, '/api/rounds/draft/current/swap', {
      method: 'POST',
      body: input,
      timeoutMs: 60000
    }));

  ipcMain.handle('tickets:list', async (event, filters = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket list request.');
    }
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      return { ok: false, error: 'Enter valid ticket filters.' };
    }
    const query = new URLSearchParams();
    for (const field of ['search', 'from', 'to', 'page']) {
      if (typeof filters[field] === 'string' && filters[field]) query.set(field, filters[field]);
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi(`/api/tickets?${query}`, { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load Tickets.' };
      if (!Array.isArray(data.tickets) || !Number.isSafeInteger(data.total) ||
          !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pageSize)) {
        throw new Error('The service returned an invalid ticket list.');
      }
      return {
        ok: true,
        tickets: data.tickets,
        total: data.total,
        collectionCount: Number.isSafeInteger(data.collectionCount) ? data.collectionCount : null,
        page: data.page,
        pageSize: data.pageSize
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:people', async (event, filters = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket people request.');
    }
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      return { ok: false, error: 'Enter valid ticket filters.' };
    }
    const query = new URLSearchParams();
    for (const field of ['search', 'from', 'to', 'page']) {
      if (typeof filters[field] === 'string' && filters[field]) query.set(field, filters[field]);
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const { response, data } = await requestApi(`/api/ticket-people?${query}`, { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load ticket owners.' };
      if (!Array.isArray(data.people) || !Number.isSafeInteger(data.total) ||
          !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pageSize) ||
          data.people.some((person) =>
            !person || typeof person.personId !== 'string' ||
            typeof person.username !== 'string' ||
            !Number.isSafeInteger(person.ticketCount) ||
            !Number.isSafeInteger(person.openTicketCount) ||
            !Number.isSafeInteger(person.closedTicketCount) ||
            !Array.isArray(person.collectionNames))) {
        throw new Error('The service returned an invalid ticket owner list.');
      }
      return {
        ok: true,
        people: data.people,
        total: data.total,
        collectionCount: Number.isSafeInteger(data.collectionCount) ? data.collectionCount : null,
        page: data.page,
        pageSize: data.pageSize
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:person', async (event, personId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket owner history request.');
    }
    const isDiscordId = typeof personId === 'string' && /^\d{1,20}$/.test(personId);
    const isUsernameKey = typeof personId === 'string' &&
      personId.startsWith('username:') &&
      Buffer.byteLength(personId, 'utf8') <= 120 &&
      !personId.includes('\0') &&
      !personId.includes('$');
    if (!isDiscordId && !isUsernameKey) {
      return { ok: false, error: 'Enter a valid ticket owner.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const route = `/api/ticket-people/${encodeURIComponent(personId)}/tickets`;
      const { response, data } = await requestApi(route, { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load this ticket history.' };
      if (!data.person || typeof data.person.personId !== 'string' ||
          !Array.isArray(data.person.collectionNames) ||
          !Array.isArray(data.tickets) || !Number.isSafeInteger(data.total)) {
        throw new Error('The service returned an invalid ticket history.');
      }
      return { ok: true, person: data.person, tickets: data.tickets, total: data.total };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:get', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket transcript request.');
    }
    if (!input || typeof input.collectionName !== 'string' ||
        !input.collectionName.endsWith('_Tickets') ||
        Buffer.byteLength(input.collectionName, 'utf8') > 120 ||
        input.collectionName.includes('\0') ||
        input.collectionName.includes('$') ||
        input.collectionName.startsWith('system.') ||
        typeof input.ticketId !== 'string' || !/^[a-f\d]{24}$/i.test(input.ticketId) ||
        (input.syncStaffChat !== undefined && typeof input.syncStaffChat !== 'boolean')) {
      return { ok: false, error: 'Enter a valid ticket reference.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const syncQuery = input.syncStaffChat ? '?syncStaffChat=true' : '';
      const route = `/api/tickets/${encodeURIComponent(input.collectionName)}/${encodeURIComponent(input.ticketId)}${syncQuery}`;
      const { response, data } = await requestApi(route, { token: sessionToken });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) return { ok: false, error: data.error || 'Could not load the ticket transcript.' };
      if (!data.ticket || !Array.isArray(data.ticket.messages) || typeof data.canReply !== 'boolean') {
        throw new Error('The service returned an invalid ticket transcript.');
      }
      return {
        ok: true,
        ticket: data.ticket,
        canReply: data.canReply,
        syncWarning: typeof data.syncWarning === 'string' ? data.syncWarning : ''
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:reply', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket reply request.');
    }
    if (!input || typeof input.collectionName !== 'string' ||
        !input.collectionName.endsWith('_Tickets') ||
        Buffer.byteLength(input.collectionName, 'utf8') > 120 ||
        input.collectionName.includes('\0') ||
        input.collectionName.includes('$') ||
        input.collectionName.startsWith('system.') ||
        typeof input.ticketId !== 'string' || !/^[a-f\d]{24}$/i.test(input.ticketId) ||
        typeof input.replyText !== 'string' || !input.replyText.trim() ||
        input.replyText.trim().length > 1800) {
      return { ok: false, error: 'Enter a valid ticket reply.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const route = `/api/tickets/${encodeURIComponent(input.collectionName)}/${encodeURIComponent(input.ticketId)}/reply`;
      const { response, data } = await requestApi(route, {
        method: 'POST',
        token: sessionToken,
        body: { replyText: input.replyText.trim() }
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Could not send this ticket reply.',
          partial: data.partial === true
        };
      }
      if (typeof data.authorName !== 'string') {
        throw new Error('The service returned an invalid ticket reply result.');
      }
      return { ok: true, authorName: data.authorName };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:staff-chat', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket staff chat request.');
    }
    if (!input || typeof input.collectionName !== 'string' ||
        !input.collectionName.endsWith('_Tickets') ||
        Buffer.byteLength(input.collectionName, 'utf8') > 120 ||
        input.collectionName.includes('\0') ||
        input.collectionName.includes('$') ||
        input.collectionName.startsWith('system.') ||
        typeof input.ticketId !== 'string' || !/^[a-f\d]{24}$/i.test(input.ticketId) ||
        typeof input.messageText !== 'string' || !input.messageText.trim() ||
        input.messageText.trim().length > 1800) {
      return { ok: false, error: 'Enter a valid staff chat message.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const route = `/api/tickets/${encodeURIComponent(input.collectionName)}/${encodeURIComponent(input.ticketId)}/staff-chat`;
      const { response, data } = await requestApi(route, {
        method: 'POST',
        token: sessionToken,
        body: { messageText: input.messageText.trim() }
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Could not send this staff chat message.',
          partial: data.partial === true
        };
      }
      if (typeof data.authorName !== 'string' || !data.authorName) {
        throw new Error('The service returned an invalid staff chat result.');
      }
      return { ok: true, authorName: data.authorName };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:edit-reply', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket reply edit request.');
    }
    if (!input || typeof input.collectionName !== 'string' ||
        !input.collectionName.endsWith('_Tickets') ||
        Buffer.byteLength(input.collectionName, 'utf8') > 120 ||
        input.collectionName.includes('\0') ||
        input.collectionName.includes('$') ||
        input.collectionName.startsWith('system.') ||
        typeof input.ticketId !== 'string' || !/^[a-f\d]{24}$/i.test(input.ticketId) ||
        typeof input.mirrorMessageID !== 'string' || !/^\d{17,20}$/.test(input.mirrorMessageID) ||
        typeof input.replyText !== 'string' || !input.replyText.trim() ||
        input.replyText.trim().length > 1800) {
      return { ok: false, error: 'Enter a valid ticket reply edit.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const route = `/api/tickets/${encodeURIComponent(input.collectionName)}/${encodeURIComponent(input.ticketId)}/messages/${encodeURIComponent(input.mirrorMessageID)}`;
      const { response, data } = await requestApi(route, {
        method: 'PATCH',
        token: sessionToken,
        body: { replyText: input.replyText.trim() }
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Could not edit this ticket reply.',
          partial: data.partial === true
        };
      }
      if (typeof data.authorName !== 'string') {
        throw new Error('The service returned an invalid ticket reply edit result.');
      }
      return { ok: true, authorName: data.authorName };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('tickets:close', async (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('Untrusted ticket close request.');
    }
    if (!input || typeof input.collectionName !== 'string' ||
        !input.collectionName.endsWith('_Tickets') ||
        Buffer.byteLength(input.collectionName, 'utf8') > 120 ||
        input.collectionName.includes('\0') ||
        input.collectionName.includes('$') ||
        input.collectionName.startsWith('system.') ||
        typeof input.ticketId !== 'string' || !/^[a-f\d]{24}$/i.test(input.ticketId) ||
        !['normal', 'silent'].includes(input.mode)) {
      return { ok: false, error: 'Select a valid ticket and close mode.' };
    }
    try {
      if (!sessionToken) sessionToken = await readToken();
      if (!sessionToken) return { ok: false, error: 'Your session expired. Sign in again.' };
      const route = `/api/tickets/${encodeURIComponent(input.collectionName)}/${encodeURIComponent(input.ticketId)}/close`;
      const { response, data } = await requestApi(route, {
        method: 'POST',
        token: sessionToken,
        body: { mode: input.mode }
      });
      if (response.status === 401) {
        await clearToken();
        sendStatus({ signedIn: false, error: data.error || 'Your session expired. Sign in again.' });
        return { ok: false, error: data.error || 'Your session expired. Sign in again.' };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || 'Could not close this ticket.',
          partial: data.partial === true
        };
      }
      if (data.mode !== input.mode || typeof data.warning !== 'string') {
        throw new Error('The service returned an invalid ticket close result.');
      }
      return { ok: true, mode: data.mode, warning: data.warning };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not reach the ticket service.' };
    }
  });

  ipcMain.handle('app:install-update', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted update install request.');
    if (!updateProvider || !updateDownloaded) throw new Error('There is no downloaded update ready to install.');
    updateProvider.quitAndInstall(false, true);
    return { ok: true };
  });

  mainWindow = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 460,
    minHeight: 580,
    autoHideMenuBar: true,
    backgroundColor: '#101413',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const indexUrl = require('node:url').pathToFileURL(path.join(__dirname, 'index.html')).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== indexUrl) event.preventDefault();
  });
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  statusTimer = setInterval(async () => {
    sendStatus(await getCurrentAuthStatus());
  }, 5 * 60 * 1000);
}).catch((error) => {
  console.error('Desktop app startup failed:', error);
  app.quit();
});

app.on('before-quit', () => clearInterval(statusTimer));
