const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hoedown', {
  getStatus: () => ipcRenderer.invoke('auth:get-status'),
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  changePassword: (token, password) =>
    ipcRenderer.invoke('auth:change-password', { token, password }),
  updatePassword: (currentPassword, password) =>
    ipcRenderer.invoke('auth:update-password', { currentPassword, password }),
  getMembers: () => ipcRenderer.invoke('members:list'),
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
