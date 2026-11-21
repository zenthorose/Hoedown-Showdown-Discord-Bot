const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hoedown', {
  getStatus: () => ipcRenderer.invoke('auth:get-status'),
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  changePassword: (token, password) =>
    ipcRenderer.invoke('auth:change-password', { token, password }),
  updatePassword: (currentPassword, password) =>
    ipcRenderer.invoke('auth:update-password', { currentPassword, password }),
  getMembers: () => ipcRenderer.invoke('members:list'),
  updateMember: (discordId, fields) =>
    ipcRenderer.invoke('members:update', { discordId, fields }),
  onMemberChange: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Member change callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('members:changed', listener);
    return () => ipcRenderer.removeListener('members:changed', listener);
  },
  onMembersResync: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Members resync callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('members:resync', listener);
    return () => ipcRenderer.removeListener('members:resync', listener);
  },
  onMembersLiveStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Members live-status callback must be a function.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('members:live-status', listener);
    return () => ipcRenderer.removeListener('members:live-status', listener);
  },
  logout: () => ipcRenderer.invoke('auth:logout'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Status callback must be a function.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('auth:status', listener);
    return () => ipcRenderer.removeListener('auth:status', listener);
  },
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Update callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('app:update-status', listener);
    return () => ipcRenderer.removeListener('app:update-status', listener);
  }
});
