const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('admin', {
  getSettings: () => ipcRenderer.invoke('admin:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('admin:save-settings', settings),
  testConnection: () => ipcRenderer.invoke('admin:test-connection'),
  listUsers: () => ipcRenderer.invoke('admin:list-users'),
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
  }
});
