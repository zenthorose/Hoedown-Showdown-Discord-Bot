const byId = (id) => document.getElementById(id);
let latestAudit = [];
let currentSettings = { configured: false, serviceUrl: '', hasR2: false };
let discordLinkUsername = '';
let botSettingsLoaded = false;
let backupLoading = false;
let backupRunning = false;

function showStatus(id, message) {
  byId(id).textContent = message || '';
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
}

function formatAuditDetails(entry) {
  const changes = entry.details?.changedSettings;
  if (!Array.isArray(changes)) {
    return entry.action === 'update-bot-settings' ? 'Details unavailable for this older event' : '—';
  }
  if (changes.length === 0) return 'No settings changed';
  return changes.map(({ setting, from, to }) =>
    `${setting}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`
  ).join('\n');
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value == null ? '' : String(value);
  row.appendChild(cell);
  return cell;
}

async function loadSettings() {
  currentSettings = await window.admin.getSettings();
  byId('service-url').value = currentSettings.serviceUrl || '';
  byId('source-directory').textContent = currentSettings.sourceDirectory || 'No source folder selected.';
  byId('r2-account').value = currentSettings.r2AccountId || '';
  byId('r2-bucket').value = currentSettings.r2BucketName || '';
}

async function loadUsers() {
  showStatus('account-status', 'Loading accounts…');
  try {
    const accounts = await window.admin.listUsers();
    const body = byId('account-rows');
    body.replaceChildren();
    for (const account of accounts) {
      const row = document.createElement('tr');
      addCell(row, account.username);
      const discordCell = addCell(row, '');
      if (account.discordId) {
        const identity = document.createElement('span');
        identity.className = 'discord-identity';
        if (typeof account.discordAvatarUrl === 'string' &&
            /^https:\/\/cdn\.discordapp\.com\//.test(account.discordAvatarUrl)) {
          const avatar = document.createElement('img');
          avatar.src = account.discordAvatarUrl;
          avatar.alt = '';
          avatar.loading = 'lazy';
          identity.append(avatar);
        }
        const details = document.createElement('span');
        details.textContent = `${account.discordUsername || 'Linked'}\n${account.discordId}`;
        identity.append(details);
        discordCell.append(identity);
      } else {
        discordCell.textContent = 'Not linked';
      }
      addCell(row, account.active ? 'Active' : 'Disabled');
      addCell(row, displayDate(account.createdAt));
      addCell(row, displayDate(account.lastLoginAt));
      addCell(row, account.lastAppVersion || '—');
      const actions = addCell(row, '');
      actions.className = 'actions-cell';
      const addButton = (label, action, className = 'secondary') => {
        const button = document.createElement('button');
        button.textContent = label;
        button.className = className;
        button.dataset.action = action;
        button.dataset.username = account.username;
        actions.appendChild(button);
      };
      addButton(account.discordId ? 'Edit Discord' : 'Link Discord', 'link-discord');
      addButton(account.active ? 'Disable' : 'Enable', 'toggle');
      addButton('Reset password', 'reset');
      addButton('Revoke sessions', 'revoke');
      addButton('Devices', 'devices');
      body.appendChild(row);
    }
    showStatus('account-status', `${accounts.length} account(s).`);
  } catch (error) {
    showStatus('account-status', error.message || 'Could not load accounts.');
  }
}

async function loadAudit(filters = {}) {
  showStatus('global-status', 'Loading admin activity…');
  try {
    const result = await window.admin.listAudit(filters);
    latestAudit = result.events;
    const body = byId('audit-rows');
    body.replaceChildren();
    for (const entry of result.events) {
      const row = document.createElement('tr');
      addCell(row, displayDate(entry.at));
      addCell(row, entry.action);
      addCell(row, entry.username);
      const details = addCell(row, formatAuditDetails(entry));
      details.className = 'audit-details';
      addCell(row, entry.actor);
      body.appendChild(row);
    }
    byId('audit-truncated').textContent = result.truncated ? 'Showing the latest 1,000 matches.' : '';
    showStatus('global-status', `${result.events.length} activity record(s).`);
  } catch (error) {
    showStatus('global-status', error.message || 'Could not load admin activity.');
  }
}

function updateBackupControls() {
  const rows = byId('backup-source-rows');
  const checkboxes = [...rows.querySelectorAll('input[data-backup-database]')];
  const selectedCount = checkboxes.filter((input) => input.checked).length;
  const busy = backupLoading || backupRunning;
  for (const checkbox of checkboxes) checkbox.disabled = busy;
  byId('refresh-backups').disabled = busy;
  byId('select-all-backups').disabled = busy || checkboxes.length === 0;
  byId('create-backups').disabled = busy || selectedCount === 0;
  return selectedCount;
}

function renderBackupCollections(data) {
  const sourceRows = byId('backup-source-rows');
  sourceRows.replaceChildren();
  for (const source of data.sources) {
    const row = document.createElement('tr');
    const selection = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'backup-select';
    checkbox.dataset.backupDatabase = source.database;
    checkbox.dataset.backupCollection = source.collection;
    checkbox.setAttribute('aria-label', `Back up ${source.database}.${source.collection}`);
    selection.appendChild(checkbox);
    row.appendChild(selection);
    addCell(row, source.database);
    addCell(row, source.collection);
    sourceRows.appendChild(row);
  }
  const historyRows = byId('backup-history-rows');
  historyRows.replaceChildren();
  for (const backup of data.backups) {
    const row = document.createElement('tr');
    addCell(row, backup.collection);
    addCell(row, displayDate(backup.createdAt));
    historyRows.appendChild(row);
  }
  updateBackupControls();
}

async function loadBackups({ quiet = false } = {}) {
  backupLoading = true;
  updateBackupControls();
  if (!quiet) showStatus('backup-status', 'Loading operational collections and backup history…');
  try {
    const data = await window.admin.listBackups();
    renderBackupCollections(data);
    if (!quiet) {
      showStatus('backup-status', `${data.sources.length} eligible collection(s); ${data.backups.length} timestamped backup(s).`);
    }
  } catch (error) {
    if (!quiet) showStatus('backup-status', error.message || 'Could not load collection backups.');
    throw error;
  } finally {
    backupLoading = false;
    updateBackupControls();
  }
}

byId('backup-source-rows').addEventListener('change', () => {
  const selectedCount = updateBackupControls();
  if (!backupLoading && !backupRunning) {
    showStatus('backup-status', `${selectedCount} collection(s) selected.`);
  }
});

byId('refresh-backups').addEventListener('click', () => loadBackups().catch(() => {}));

byId('select-all-backups').addEventListener('click', () => {
  const checkboxes = [...byId('backup-source-rows').querySelectorAll('input[data-backup-database]')];
  const shouldSelect = !checkboxes.length || !checkboxes.every((input) => input.checked);
  for (const checkbox of checkboxes) checkbox.checked = shouldSelect;
  const selectedCount = updateBackupControls();
  showStatus('backup-status', `${selectedCount} collection(s) selected.`);
});

byId('create-backups').addEventListener('click', async () => {
  const collections = [...byId('backup-source-rows').querySelectorAll('input[data-backup-database]:checked')]
    .map((input) => ({
      database: input.dataset.backupDatabase,
      collection: input.dataset.backupCollection
    }));
  if (!collections.length ||
      !window.confirm(`Create timestamped backups of ${collections.length} selected collection(s)? This will use additional Atlas storage.`)) {
    return;
  }
  backupRunning = true;
  updateBackupControls();
  showStatus('backup-status', `Creating ${collections.length} backup(s). This may take several minutes; please keep the manager open.`);
  try {
    const result = await window.admin.createBackups(collections);
    const succeeded = result.results.filter((item) => item.success);
    const failed = result.results.filter((item) => !item.success);
    const summary = `${succeeded.length} backup(s) created${failed.length ? `; ${failed.length} failed` : ''}.` +
      (result.auditLogged ? ' Recorded in the admin audit log.' : ' The admin audit log could not be updated.');
    showStatus('backup-status', failed.length
      ? `${summary} ${failed.map((item) => `${item.database}.${item.collection}: ${item.error}`).join(' ')}`
      : summary);
    try {
      await loadBackups({ quiet: true });
    } catch (error) {
      showStatus('backup-status', `${summary} Could not refresh backup history: ${error.message}`);
    }
  } catch (error) {
    showStatus('backup-status', error.message || 'Could not create collection backups.');
  } finally {
    backupRunning = false;
    updateBackupControls();
  }
});

async function loadReleaseInfo() {
  try {
    const info = await window.admin.getReleaseInfo();
    byId('release-channel').value = info.channel;
    byId('desktop-version').value = info.desktopVersion;
    byId('manager-version').value = info.managerVersion;
    showStatus('release-status', `Current channel: ${info.channel}.`);
  } catch (error) {
    showStatus('release-status', error.message || 'Could not read release information.');
  }
}

function applyBotSettings(result) {
  for (const input of document.querySelectorAll('[data-bot-settings-group][data-bot-settings-field]')) {
    const value = result.settings[input.dataset.botSettingsGroup]?.[input.dataset.botSettingsField];
    if (typeof value !== 'boolean') throw new Error('Render returned incomplete bot settings.');
    input.checked = value;
  }
  const channels = result.settings.channels;
  if (!channels || typeof channels !== 'object') throw new Error('Render returned incomplete bot channel settings.');
  byId('bot-status-channel').value = channels.STATUS_CHANNEL_ID;
  byId('bot-log-channel').value = channels.LOG_CHANNEL_ID;
  byId('bot-optin-channel').value = channels.OptInChannelID;
  byId('bot-team-check-channel').value = channels.TeamCheckChannelID;
  byId('bot-round-channels').value = JSON.stringify(channels.roundChannels, null, 2);
  byId('bot-team-channels').value = JSON.stringify(channels.teamChannels, null, 2);
  byId('bot-settings-updated').textContent = result.updatedAt
    ? `Last updated ${displayDate(result.updatedAt)}${result.updatedBy ? ` by ${result.updatedBy}` : ''}.`
    : 'No saved changes. The bot is using its built-in defaults.';
}

async function loadBotSettings() {
  const saveButton = byId('bot-settings-form').querySelector('button[type="submit"]');
  const refreshButton = byId('refresh-bot-settings');
  saveButton.disabled = true;
  refreshButton.disabled = true;
  botSettingsLoaded = false;
  showStatus('bot-settings-status', 'Loading bot settings…');
  try {
    const result = await window.admin.getBotSettings();
    applyBotSettings(result);
    botSettingsLoaded = true;
    showStatus('bot-settings-status', 'Bot settings loaded.');
  } catch (error) {
    showStatus('bot-settings-status', error.message || 'Could not load bot settings.');
  } finally {
    saveButton.disabled = !botSettingsLoaded;
    refreshButton.disabled = false;
  }
}

byId('bot-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!botSettingsLoaded) return;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const refreshButton = byId('refresh-bot-settings');
  submitButton.disabled = true;
  refreshButton.disabled = true;
  try {
    const settings = { grabReactions: {}, approveRound: {}, hoedownReset: {} };
    for (const input of document.querySelectorAll('[data-bot-settings-group][data-bot-settings-field]')) {
      settings[input.dataset.botSettingsGroup][input.dataset.botSettingsField] = input.checked;
    }
    settings.channels = {
      STATUS_CHANNEL_ID: byId('bot-status-channel').value.trim(),
      LOG_CHANNEL_ID: byId('bot-log-channel').value.trim(),
      OptInChannelID: byId('bot-optin-channel').value.trim(),
      TeamCheckChannelID: byId('bot-team-check-channel').value.trim(),
      roundChannels: JSON.parse(byId('bot-round-channels').value),
      teamChannels: JSON.parse(byId('bot-team-channels').value)
    };
    const result = await window.admin.saveBotSettings(settings);
    applyBotSettings(result);
    showStatus('bot-settings-status', result.auditLogged
      ? 'Bot settings saved and recorded in the admin audit log.'
      : 'Bot settings saved. The admin audit log could not be updated.');
    await loadAudit();
  } catch (error) {
    showStatus('bot-settings-status', error.message || 'Could not save bot settings.');
  } finally {
    submitButton.disabled = !botSettingsLoaded;
    refreshButton.disabled = false;
  }
});

byId('refresh-bot-settings').addEventListener('click', loadBotSettings);

byId('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const saved = await window.admin.saveSettings({
      serviceUrl: byId('service-url').value,
      adminKey: byId('admin-key').value
    });
    byId('admin-key').value = '';
    currentSettings = saved;
    showStatus('connection-status', 'Connection settings saved securely on this computer.');
  } catch (error) {
    showStatus('connection-status', error.message || 'Could not save connection settings.');
  }
});

byId('test-connection').addEventListener('click', async () => {
  try {
    const result = await window.admin.testConnection();
    showStatus('connection-status', `Connected to Render. ${result.accountCount} account(s) found.`);
    await loadUsers();
  } catch (error) {
    showStatus('connection-status', error.message || 'Connection test failed.');
  }
});

byId('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await window.admin.createUser({
      username: byId('new-username').value,
      discordId: byId('new-discord-id').value
    });
    byId('new-username').value = '';
    byId('new-discord-id').value = '';
    byId('temporary-password-value').textContent = result.password;
    byId('temporary-password').hidden = false;
    showStatus('account-status', `Created ${result.username}. Share its temporary password securely.`);
    await loadUsers();
    await loadAudit();
  } catch (error) {
    showStatus('account-status', error.message || 'Could not create account.');
  } finally {
    button.disabled = false;
  }
});

byId('copy-password').addEventListener('click', async () => {
  try {
    await window.admin.copyText(byId('temporary-password-value').textContent);
    showStatus('account-status', 'Temporary password copied.');
  } catch (error) {
    showStatus('account-status', error.message || 'Could not copy password.');
  }
});

byId('account-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, username } = button.dataset;
  try {
    if (action === 'link-discord') {
      const account = (await window.admin.listUsers()).find((item) => item.username === username);
      if (!account) throw new Error('Account was not found.');
      discordLinkUsername = username;
      byId('discord-link-account').textContent = `App account: ${username}`;
      byId('discord-link-id').value = account.discordId || '';
      byId('discord-link-status').textContent = '';
      byId('discord-link-dialog').showModal();
      byId('discord-link-id').focus();
      return;
    }
    if (action === 'devices') {
      const devices = await window.admin.listDevices(username);
      const body = byId('device-rows');
      body.replaceChildren();
      byId('devices-title').textContent = `Devices for ${username}`;
      for (const device of devices) {
        const row = document.createElement('tr');
        addCell(row, `${device.deviceName || 'Device'}${device.isCurrent ? ' (current)' : ''}`);
        addCell(row, device.platform);
        addCell(row, displayDate(device.lastSeenAt));
        addCell(row, device.lastIpAddress);
        const cell = addCell(row, `${device.loginCount || 0} sign-in(s), ${device.launchCount || 0} launch(es)`);
        if (device.isCurrent) {
          const revoke = document.createElement('button');
          revoke.textContent = 'Revoke';
          revoke.className = 'danger';
          revoke.dataset.action = 'revoke-device';
          revoke.dataset.username = username;
          revoke.dataset.deviceId = device.deviceId;
          cell.appendChild(document.createTextNode(' '));
          cell.appendChild(revoke);
        }
        body.appendChild(row);
      }
      byId('devices-card').hidden = false;
      return;
    }
    if (action === 'revoke-device') {
      if (!window.confirm(`Sign out ${username} from this device?`)) return;
      await window.admin.revokeDevice(username, button.dataset.deviceId);
      showStatus('account-status', `Revoked the current device session for ${username}.`);
    } else {
      const account = (await window.admin.listUsers()).find((item) => item.username === username);
      const confirmation = action === 'reset'
        ? `Reset ${username}'s password and sign out all sessions?`
        : action === 'revoke'
          ? `Sign out all sessions for ${username}?`
          : `${account && account.active ? 'Disable' : 'Enable'} ${username}?`;
      if (!window.confirm(confirmation)) return;
      const selectedAction = action === 'toggle' ? 'set-active' : action === 'reset' ? 'reset-password' : 'revoke-sessions';
      const result = await window.admin.manageUser(
        selectedAction,
        username,
        action === 'toggle' ? !account.active : undefined
      );
      if (typeof result.password === 'string') {
        byId('temporary-password-value').textContent = result.password;
        byId('temporary-password').hidden = false;
        showStatus('account-status', `Password reset for ${username}. Share it securely; it must be changed at sign-in.`);
      } else {
        showStatus('account-status', `${username}: ${action === 'toggle' ? (result.active ? 'enabled' : 'disabled') : 'sessions revoked'}.`);
      }
    }
    await loadUsers();
    await loadAudit();
  } catch (error) {
    showStatus('account-status', error.message || 'Account action failed.');
  }
});

byId('discord-link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!discordLinkUsername) return;
  const buttons = [...event.currentTarget.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await window.admin.linkDiscord(discordLinkUsername, byId('discord-link-id').value.trim());
    byId('discord-link-dialog').close();
    showStatus('account-status', `Updated Discord link for ${discordLinkUsername}.`);
    await loadUsers();
    await loadAudit();
  } catch (error) {
    showStatus('discord-link-status', error.message || 'Could not update Discord link.');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

byId('remove-discord-link').addEventListener('click', async () => {
  if (!discordLinkUsername || !window.confirm(`Remove the Discord link for ${discordLinkUsername}?`)) return;
  try {
    await window.admin.linkDiscord(discordLinkUsername, '');
    byId('discord-link-dialog').close();
    showStatus('account-status', `Removed the Discord link for ${discordLinkUsername}.`);
    await loadUsers();
    await loadAudit();
  } catch (error) {
    showStatus('discord-link-status', error.message || 'Could not remove Discord link.');
  }
});
byId('cancel-discord-link').addEventListener('click', () => byId('discord-link-dialog').close());

byId('device-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="revoke-device"]');
  if (!button) return;
  const { username, deviceId } = button.dataset;
  if (!window.confirm(`Sign out ${username} from this device?`)) return;
  try {
    await window.admin.revokeDevice(username, deviceId);
    showStatus('account-status', `Revoked the current device session for ${username}.`);
    byId('devices-card').hidden = true;
    await loadUsers();
    await loadAudit();
  } catch (error) {
    showStatus('account-status', error.message || 'Could not revoke device session.');
  }
});

byId('refresh-users').addEventListener('click', loadUsers);
byId('close-devices').addEventListener('click', () => { byId('devices-card').hidden = true; });
byId('audit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadAudit({
    search: byId('audit-search').value,
    from: byId('audit-from').value,
    to: byId('audit-to').value
  });
});
byId('export-audit').addEventListener('click', async () => {
  try {
    const result = await window.admin.saveAudit(latestAudit);
    showStatus('global-status', result.canceled ? 'Export canceled.' : 'Activity exported.');
  } catch (error) {
    showStatus('global-status', error.message || 'Could not export activity.');
  }
});

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.tab-page').forEach((page) => { page.hidden = page.id !== button.dataset.tab; });
    if (button.dataset.tab === 'backups') loadBackups().catch(() => {});
  });
});

byId('suggest-versions').addEventListener('click', () => {
  const channel = byId('release-channel').value;
  const desktop = byId('desktop-version').value;
  const manager = byId('manager-version').value;
  const next = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-beta(?:\.(\d+))?)?$/.exec(version);
    if (!match) throw new Error('Current versions must use a supported semantic version format.');
    return channel === 'stable'
      ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
      : `${match[1]}.${match[2]}.${match[3]}-beta.${match[4] ? Number(match[4]) + 1 : 1}`;
  };
  try {
    byId('desktop-version').value = next(desktop);
    byId('manager-version').value = next(manager);
    showStatus('release-status', `Suggested next ${channel} versions.`);
  } catch (error) {
    showStatus('release-status', error.message);
  }
});

byId('fetch-versions').addEventListener('click', async () => {
  try {
    const result = await window.admin.fetchPublishedVersions();
    byId('desktop-version').value = byId('release-channel').value === 'beta'
      ? result.suggestedDesktopBeta
      : result.suggestedDesktopStable;
    byId('manager-version').value = byId('release-channel').value === 'beta'
      ? result.suggestedManagerBeta
      : result.suggestedManagerStable;
    showStatus(
      'release-status',
      `Latest published desktop versions — beta: ${result.beta || 'none'}, stable: ${result.stable || 'none'}.`
    );
  } catch (error) {
    showStatus('release-status', error.message || 'Could not fetch published versions.');
  }
});

byId('choose-source').addEventListener('click', async () => {
  try {
    const result = await window.admin.chooseSource();
    if (result.canceled) return;
    byId('source-directory').textContent = result.sourceDirectory;
    await loadReleaseInfo();
    showStatus('release-status', 'Release source folder selected.');
  } catch (error) {
    showStatus('release-status', error.message || 'Could not select source folder.');
  }
});

byId('save-versions').addEventListener('click', async () => {
  try {
    const result = await window.admin.updateVersions({
      desktopVersion: byId('desktop-version').value,
      managerVersion: byId('manager-version').value
    }, {
      desktop: byId('update-desktop').checked,
      accountManager: byId('update-manager').checked
    });
    await loadReleaseInfo();
    showStatus('release-status', `Saved versions: ${JSON.stringify(result)}`);
  } catch (error) {
    showStatus('release-status', error.message || 'Could not update versions.');
  }
});

byId('apply-channel').addEventListener('click', async () => {
  try {
    const channel = await window.admin.setChannel(byId('release-channel').value);
    showStatus('release-status', `Applied ${channel} channel to desktop app config.`);
    await loadReleaseInfo();
  } catch (error) {
    showStatus('release-status', error.message || 'Could not apply channel.');
  }
});

byId('r2-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await window.admin.saveReleaseSettings({
      accountId: byId('r2-account').value.trim(),
      bucketName: byId('r2-bucket').value.trim(),
      accessKeyId: byId('r2-access-key').value.trim(),
      secretAccessKey: byId('r2-secret-key').value.trim()
    });
    byId('r2-access-key').value = '';
    byId('r2-secret-key').value = '';
    showStatus('release-status', result.hasR2 ? 'R2 publishing settings saved securely.' : 'R2 settings saved.');
  } catch (error) {
    showStatus('release-status', error.message || 'Could not save R2 settings.');
  }
});

byId('releases').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-task]');
  if (!button) return;
  const output = byId('build-output');
  output.textContent = '';
  button.disabled = true;
  showStatus('release-status', 'Release task running…');
  try {
    const result = await window.admin.runReleaseTask(button.dataset.task, byId('release-channel').value);
    showStatus('release-status', result.canceled
      ? 'Publish canceled.'
      : `Completed ${result.task}. Artifacts are under electron-app/dist.`);
  } catch (error) {
    showStatus('release-status', error.message || 'Release task failed.');
  } finally {
    button.disabled = false;
  }
});

window.admin.onOutput((text) => {
  byId('build-output').textContent += text;
  byId('build-output').scrollTop = byId('build-output').scrollHeight;
});

Promise.all([loadSettings(), loadReleaseInfo(), loadBotSettings()]).catch((error) => {
  showStatus('global-status', error.message || 'Could not load account manager.');
});
