const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('admin', {
  getSettings: () => ipcRenderer.invoke('admin:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('admin:save-settings', settings),
  testConnection: () => ipcRenderer.invoke('admin:test-connection'),
  enrollPasskey: () => ipcRenderer.invoke('admin:enroll-passkey'),
  addPasskey: () => ipcRenderer.invoke('admin:add-passkey'),
  signInPasskey: () => ipcRenderer.invoke('admin:sign-in-passkey'),
  signOutAdmin: () => ipcRenderer.invoke('admin:sign-out'),
  checkAdminAppUpdate: () => ipcRenderer.invoke('admin:check-app-update'),
  installAdminAppUpdate: () => ipcRenderer.invoke('admin:install-app-update'),
  listAdminSessions: () => ipcRenderer.invoke('admin:list-sessions'),
  revokeAdminSession: (sessionId) => ipcRenderer.invoke('admin:revoke-session', sessionId),
  listUsers: () => ipcRenderer.invoke('admin:list-users'),
  listBackups: () => ipcRenderer.invoke('admin:list-backups'),
  createBackups: (collections) => ipcRenderer.invoke('admin:create-backups', collections),
  downloadDatabaseExport: () => ipcRenderer.invoke('admin:download-database-export'),
  restoreDatabaseExport: () => ipcRenderer.invoke('admin:restore-database-export'),
  wipeCollections: (collections) => ipcRenderer.invoke('admin:wipe-collections', collections),
  getReplacementOptions: (target) => ipcRenderer.invoke('admin:get-replacement-options', target),
  chooseReplacementCsv: () => ipcRenderer.invoke('admin:choose-replacement-csv'),
  replaceFromBackup: (input) => ipcRenderer.invoke('admin:replace-from-backup', input),
  replaceFromCsv: (input) => ipcRenderer.invoke('admin:replace-from-csv', input),
  getBotSettings: () => ipcRenderer.invoke('admin:get-bot-settings'),
  saveBotSettings: (settings) => ipcRenderer.invoke('admin:save-bot-settings', settings),
  createUser: (account) => ipcRenderer.invoke('admin:create-user', account),
  linkDiscord: (username, discordId) =>
    ipcRenderer.invoke('admin:link-discord', { username, discordId }),
  manageUser: (action, username, active) =>
    ipcRenderer.invoke('admin:manage-user', { action, username, active }),
  listDevices: (username) => ipcRenderer.invoke('admin:list-devices', username),
  revokeDevice: (username, deviceId) => ipcRenderer.invoke('admin:revoke-device', { username, deviceId }),
  listAudit: (filters) => ipcRenderer.invoke('admin:list-audit', filters),
  saveAudit: (events) => ipcRenderer.invoke('admin:save-audit', events),
  saveReleaseSettings: (settings) => ipcRenderer.invoke('release:save-settings', settings),
  chooseSource: () => ipcRenderer.invoke('release:choose-source'),
  chooseOutput: () => ipcRenderer.invoke('release:choose-output'),
  getReleaseInfo: () => ipcRenderer.invoke('release:get-info'),
  setChannel: (channel) => ipcRenderer.invoke('release:set-channel', channel),
  fetchPublishedVersions: () => ipcRenderer.invoke('release:fetch-versions'),
  updateVersions: (versions, selections) => ipcRenderer.invoke('release:update-versions', { versions, selections }),
  runReleaseTask: (task, channel) => ipcRenderer.invoke('release:run-task', { task, channel }),
  copyText: (text) => ipcRenderer.invoke('admin:copy-text', text),
  onOutput: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Build output callback must be a function.');
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('release:output', listener);
    return () => ipcRenderer.removeListener('release:output', listener);
  },
  onAdminUpdateStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Admin update callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('admin:update-status', listener);
    return () => ipcRenderer.removeListener('admin:update-status', listener);
  }
});
