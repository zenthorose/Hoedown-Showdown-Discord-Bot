const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hoedown', {
  getStatus: () => ipcRenderer.invoke('auth:get-status'),
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  selectProfile: (profileId) => ipcRenderer.invoke('auth:select-profile', profileId),
  createProfile: () => ipcRenderer.invoke('auth:create-profile'),
  deleteProfile: (profileId) => ipcRenderer.invoke('auth:delete-profile', profileId),
  backToProfiles: () => ipcRenderer.invoke('auth:back-to-profiles'),
  changePassword: (token, password) =>
    ipcRenderer.invoke('auth:change-password', { token, password }),
  updatePassword: (currentPassword, password) =>
    ipcRenderer.invoke('auth:update-password', { currentPassword, password }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveThemeColors: (colors) => ipcRenderer.invoke('settings:save-theme-colors', colors),
  resetThemeColors: () => ipcRenderer.invoke('settings:reset-theme-colors'),
  getMembers: () => ipcRenderer.invoke('members:list'),
  getAvoids: () => ipcRenderer.invoke('avoids:list'),
  grabRoundReactions: () => ipcRenderer.invoke('rounds:grab-reactions'),
  getRoundActionStatus: () => ipcRenderer.invoke('rounds:get-status'),
  getCurrentRoundDraft: () => ipcRenderer.invoke('rounds:get-current-draft'),
  openCurrentRoundDraft: () => ipcRenderer.invoke('rounds:open-current-draft'),
  updateCurrentRoundDraftPresence: (input) =>
    ipcRenderer.invoke('rounds:update-current-draft-presence', input),
  reviewCurrentRoundDraft: (input) =>
    ipcRenderer.invoke('rounds:review-current-draft', input),
  approveCurrentRoundDraft: (input) =>
    ipcRenderer.invoke('rounds:approve-current-draft', input),
  addCurrentRoundDraftFillerTeam: (input) =>
    ipcRenderer.invoke('rounds:add-current-draft-filler-team', input),
  deleteCurrentRoundDraftFillerTeam: (input) =>
    ipcRenderer.invoke('rounds:delete-current-draft-filler-team', input),
  replaceCurrentRoundDraftPlayer: (input) =>
    ipcRenderer.invoke('rounds:replace-current-draft-player', input),
  replaceCurrentRoundDraftPlayerWithFiller: (input) =>
    ipcRenderer.invoke('rounds:replace-current-draft-player-with-filler', input),
  fillCurrentRoundDraftSlot: (input) =>
    ipcRenderer.invoke('rounds:fill-current-draft-slot', input),
  swapCurrentRoundDraftPlayers: (input) =>
    ipcRenderer.invoke('rounds:swap-current-draft-players', input),
  getTickets: (filters) => ipcRenderer.invoke('tickets:list', filters),
  getTicketPeople: (filters) => ipcRenderer.invoke('tickets:people', filters),
  getTicketsForPerson: (personId) => ipcRenderer.invoke('tickets:person', personId),
  getTicket: (collectionName, ticketId, options) =>
    ipcRenderer.invoke('tickets:get', { collectionName, ticketId, ...options }),
  sendTicketReply: (input) => ipcRenderer.invoke('tickets:reply', input),
  sendTicketStaffMessage: (input) => ipcRenderer.invoke('tickets:staff-chat', input),
  editTicketReply: (input) => ipcRenderer.invoke('tickets:edit-reply', input),
  closeTicket: (input) => ipcRenderer.invoke('tickets:close', input),
  updateMember: (discordId, fields) =>
    ipcRenderer.invoke('members:update', { discordId, fields }),
  createAvoids: (input) => ipcRenderer.invoke('avoids:create', input),
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
  onAvoidsResync: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Avoids resync callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('avoids:resync', listener);
    return () => ipcRenderer.removeListener('avoids:resync', listener);
  },
  onTicketsResync: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Tickets resync callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('tickets:resync', listener);
    return () => ipcRenderer.removeListener('tickets:resync', listener);
  },
  onTicketMessage: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Ticket message callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('tickets:message', listener);
    return () => ipcRenderer.removeListener('tickets:message', listener);
  },
  onMembersLiveStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Members live-status callback must be a function.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('members:live-status', listener);
    return () => ipcRenderer.removeListener('members:live-status', listener);
  },
  onRoundActionStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Round action status callback must be a function.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('rounds:action-status', listener);
    return () => ipcRenderer.removeListener('rounds:action-status', listener);
  },
  onRoundDraftUpdated: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Round draft callback must be a function.');
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('rounds:draft-updated', listener);
    return () => ipcRenderer.removeListener('rounds:draft-updated', listener);
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
