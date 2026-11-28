const byId = (id) => document.getElementById(id);
let latestAudit = [];
let currentSettings = {
  configured: false,
  serviceUrl: '',
  hasR2: false,
  hasAdminSession: false,
  hasBootstrapKey: false,
  outputDirectory: ''
};
let discordLinkUsername = '';
let botSettingsLoaded = false;
let backupLoading = false;
let backupRunning = false;
let databaseExportRunning = false;
let databaseRestoreRunning = false;
let selectedReplacementCsv = null;
let adminSessionExpiryTimer = null;
let passkeyLoginUrl = '';
let buildEtaTimer = null;
let activeBuildEta = null;

const BUILD_TASK_NAMES = {
  'desktop-portable': 'Desktop portable build',
  'desktop-installer': 'Desktop installer build',
  'account-manager': 'Account Manager installer build'
};

function showStatus(id, message) {
  byId(id).textContent = message || '';
}

function formatBuildDuration(milliseconds) {
  const minutes = Math.ceil(Math.max(0, milliseconds) / 60000);
  return minutes < 1 ? 'less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function updateBuildEta() {
  if (!activeBuildEta) return;
  const elapsedMs = Date.now() - activeBuildEta.startedAt;
  const elapsed = formatBuildDuration(elapsedMs);
  let message;
  if (activeBuildEta.estimatedDurationMs === null) {
    message = `${BUILD_TASK_NAMES[activeBuildEta.task]}: learning typical duration; ETA will be available after a successful build. Elapsed ${elapsed}.`;
  } else {
    const remainingMs = activeBuildEta.estimatedDurationMs - elapsedMs;
    message = remainingMs > 0
      ? `${BUILD_TASK_NAMES[activeBuildEta.task]}: about ${formatBuildDuration(remainingMs)} remaining, based on ${activeBuildEta.sampleCount} previous successful build${activeBuildEta.sampleCount === 1 ? '' : 's'}. Elapsed ${elapsed}.`
      : `${BUILD_TASK_NAMES[activeBuildEta.task]} is taking longer than its recent typical time. Elapsed ${elapsed}.`;
  }
  if (activeBuildEta.lastMessage !== message) {
    activeBuildEta.lastMessage = message;
    showStatus('build-eta', message);
  }
}

function startBuildEta(estimate) {
  if (!estimate || !Object.hasOwn(BUILD_TASK_NAMES, estimate.task)) return;
  if (buildEtaTimer) clearInterval(buildEtaTimer);
  activeBuildEta = {
    task: estimate.task,
    startedAt: Number.isFinite(estimate.startedAt) ? estimate.startedAt : Date.now(),
    estimatedDurationMs: Number.isSafeInteger(estimate.estimatedDurationMs) && estimate.estimatedDurationMs > 0
      ? estimate.estimatedDurationMs
      : null,
    sampleCount: Number.isSafeInteger(estimate.sampleCount) ? estimate.sampleCount : 0,
    lastMessage: ''
  };
  updateBuildEta();
  buildEtaTimer = setInterval(updateBuildEta, 15000);
}

function finishBuildEta(task, timing, error) {
  if (!activeBuildEta || activeBuildEta.task !== task) {
    if (error && Object.hasOwn(BUILD_TASK_NAMES, task)) {
      showStatus('build-eta', `${BUILD_TASK_NAMES[task]} failed before timing could start.`);
    }
    return;
  }
  const elapsedMs = Date.now() - activeBuildEta.startedAt;
  clearInterval(buildEtaTimer);
  buildEtaTimer = null;
  activeBuildEta = null;
  if (error) {
    showStatus('build-eta', `${BUILD_TASK_NAMES[task]} failed after ${formatBuildDuration(elapsedMs)}. This run was not added to ETA history.`);
    return;
  }
  if (!timing || !Number.isSafeInteger(timing.durationMs)) {
    showStatus('build-eta', `${BUILD_TASK_NAMES[task]} completed, but its duration was unavailable.`);
    return;
  }
  const learned = timing.sampleCount === 1
    ? 'Future estimates will use this successful run.'
    : `ETA uses the ${timing.sampleCount} most recent successful runs.`;
  const warning = timing.warning ? ` ${timing.warning}` : ` ${learned}`;
  showStatus('build-eta', `${BUILD_TASK_NAMES[task]} completed in ${formatBuildDuration(timing.durationMs)}.${warning}`);
}

function confirmPublishRelease(confirmation) {
  const dialog = byId('publish-confirm-dialog');
  byId('publish-confirm-title').textContent = confirmation.name;
  byId('publish-confirm-version').textContent = confirmation.version;
  byId('publish-confirm-channel').textContent = confirmation.channel;
  byId('publish-confirm-accept').textContent = `Publish ${confirmation.channel} release`;
  dialog.returnValue = '';
  return new Promise((resolve, reject) => {
    const onClose = () => resolve(dialog.returnValue === 'confirm');
    dialog.addEventListener('close', onClose, { once: true });
    try {
      dialog.showModal();
    } catch (error) {
      dialog.removeEventListener('close', onClose);
      reject(error);
    }
  });
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
  byId('connection-service-url').textContent = currentSettings.serviceUrl
    ? `Connected service: ${currentSettings.serviceUrl}`
    : '';
  byId('source-directory').textContent = currentSettings.sourceDirectory || 'No source folder selected.';
  byId('output-directory').textContent = currentSettings.outputDirectory || 'No output folder selected.';
  byId('r2-account').value = currentSettings.r2AccountId || '';
  byId('r2-bucket').value = currentSettings.r2BucketName || '';
  byId('auth-screen').hidden = currentSettings.hasAdminSession;
  byId('admin-shell').hidden = !currentSettings.hasAdminSession;
  byId('enroll-passkey').hidden = !currentSettings.hasBootstrapKey;
  byId('add-passkey').hidden = !currentSettings.hasAdminSession;
  byId('sign-in-passkey').hidden = !currentSettings.configured;
  byId('sign-out-admin').hidden = !currentSettings.hasAdminSession;
  byId('test-connection').disabled = !currentSettings.hasAdminSession;
  byId('check-admin-updates').disabled = !currentSettings.hasAdminSession;
  if (adminSessionExpiryTimer) clearTimeout(adminSessionExpiryTimer);
  if (currentSettings.hasAdminSession) {
    showStatus('connection-status', `Signed in on this computer until ${displayDate(currentSettings.adminSessionExpiresAt)}.`);
    const expiresAt = currentSettings.adminSessionExpiresAt
      ? new Date(currentSettings.adminSessionExpiresAt).getTime()
      : NaN;
    if (Number.isFinite(expiresAt)) {
      adminSessionExpiryTimer = setTimeout(() => {
        loadSettings().then(() => {
          if (!currentSettings.hasAdminSession) {
            showStatus('auth-status', 'Your Admin session expired. Sign in with your passkey again.');
          }
        }).catch((error) => {
          showStatus('auth-status', error.message || 'Could not refresh the Admin session.');
        });
      }, Math.max(0, Math.min(expiresAt - Date.now(), 2147483647)));
    }
    await loadAdminSessions();
  } else if (currentSettings.configured) {
    showStatus(
      'auth-status',
      currentSettings.hasBootstrapKey
        ? 'First-time setup is available if no owner passkey exists. If one is already enrolled, choose Sign in with passkey.'
        : 'Enter your passkey to sign in.'
    );
    byId('admin-sessions').hidden = true;
  } else {
    showStatus('auth-status', 'Enter the Render service URL to get started.');
    byId('admin-sessions').hidden = true;
  }
}

async function loadAdminSessions() {
  byId('admin-sessions').hidden = false;
  showStatus('admin-session-status', 'Loading sessions…');
  try {
    const data = await window.admin.listAdminSessions();
    if (!Array.isArray(data.sessions)) throw new Error('Render returned an invalid Admin session list.');
    const body = byId('admin-session-rows');
    body.replaceChildren();
    for (const session of data.sessions) {
      const row = document.createElement('tr');
      addCell(row, `${session.deviceName || 'Admin device'}${session.isCurrent ? ' (this computer)' : ''}\n${session.platform || ''}`);
      addCell(row, displayDate(session.createdAt));
      addCell(row, displayDate(session.expiresAt));
      const actionCell = addCell(row, '');
      if (!session.isCurrent) {
        const revokeButton = document.createElement('button');
        revokeButton.className = 'danger';
        revokeButton.textContent = 'Revoke';
        revokeButton.dataset.sessionId = session.id;
        actionCell.appendChild(revokeButton);
      }
      body.appendChild(row);
    }
    showStatus('admin-session-status', '');
  } catch (error) {
    showStatus('admin-session-status', error.message || 'Could not load Admin sessions.');
  }
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
  const busy = backupLoading || backupRunning || databaseExportRunning || databaseRestoreRunning;
  for (const checkbox of checkboxes) checkbox.disabled = busy;
  for (const group of rows.querySelectorAll('details[data-backup-group]')) {
    const groupCheckboxes = [...group.querySelectorAll('input[data-backup-database]')];
    const groupSelected = groupCheckboxes.filter((input) => input.checked).length;
    const count = group.querySelector('[data-backup-group-count]');
    count.textContent = `${groupCheckboxes.length} collection(s)${groupSelected ? ` · ${groupSelected} selected` : ''}`;
  }
  byId('refresh-backups').disabled = busy;
  byId('download-full-export').disabled = busy;
  byId('restore-full-export').disabled = busy;
  byId('select-all-backups').disabled = busy || checkboxes.length === 0;
  byId('create-backups').disabled = busy || selectedCount === 0;
  byId('wipe-selected').disabled = busy || selectedCount === 0;
  byId('replace-selected').disabled = busy || selectedCount !== 1;
  return selectedCount;
}

function renderBackupCollections(data) {
  const sourceRows = byId('backup-source-rows');
  sourceRows.replaceChildren();
  const groupedSources = new Map(data.databases.map((database) => [database, []]));
  for (const source of data.sources) {
    if (!groupedSources.has(source.database)) groupedSources.set(source.database, []);
    groupedSources.get(source.database).push(source);
  }
  const preferredOrder = ['HoedownInfo', 'Rounds', 'Tickets'];
  const databaseNames = [...groupedSources.keys()].sort((left, right) => {
    const leftOrder = preferredOrder.indexOf(left);
    const rightOrder = preferredOrder.indexOf(right);
    if (leftOrder !== -1 || rightOrder !== -1) {
      return (leftOrder === -1 ? preferredOrder.length : leftOrder) -
        (rightOrder === -1 ? preferredOrder.length : rightOrder);
    }
    return left.localeCompare(right);
  });
  for (const database of databaseNames) {
    const sources = groupedSources.get(database);
    const group = document.createElement('details');
    group.className = 'backup-database-group';
    group.dataset.backupGroup = '';
    const summary = document.createElement('summary');
    const title = document.createElement('strong');
    title.textContent = database;
    const count = document.createElement('span');
    count.className = 'muted';
    count.dataset.backupGroupCount = '';
    summary.append(title, count);
    group.appendChild(summary);
    if (sources.length) {
      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrap backup-group-content';
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Select</th><th>Collection</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const source of sources) {
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
        addCell(row, source.collection);
        body.appendChild(row);
      }
      table.appendChild(body);
      tableWrap.appendChild(table);
      group.appendChild(tableWrap);
    } else {
      const empty = document.createElement('p');
      empty.className = 'muted backup-group-empty';
      empty.textContent = 'No collections found.';
      group.appendChild(empty);
    }
    sourceRows.appendChild(group);
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

byId('check-admin-updates').addEventListener('click', async () => {
  const button = byId('check-admin-updates');
  button.disabled = true;
  showStatus('admin-update-status', 'Checking for Admin app updates…');
  try {
    await window.admin.checkAdminAppUpdate();
  } catch (error) {
    showStatus('admin-update-status', error.message || 'Could not check for Admin app updates.');
  } finally {
    button.disabled = !currentSettings.hasAdminSession;
  }
});

byId('install-admin-update').addEventListener('click', async () => {
  try {
    await window.admin.installAdminAppUpdate();
  } catch (error) {
    showStatus('admin-update-status', error.message || 'Could not install the Admin app update.');
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

byId('choose-output').addEventListener('click', async () => {
  try {
    const result = await window.admin.chooseOutput();
    if (result.canceled) return;
    byId('output-directory').textContent = result.outputDirectory;
    currentSettings.outputDirectory = result.outputDirectory;
    showStatus('release-status', 'Release output folder selected.');
  } catch (error) {
    showStatus('release-status', error.message || 'Could not select an output folder.');
  }
});

function getSelectedBackupCollections() {
  return [...byId('backup-source-rows').querySelectorAll('input[data-backup-database]:checked')]
    .map((input) => ({
      database: input.dataset.backupDatabase,
      collection: input.dataset.backupCollection
    }));
}

function confirmCollectionAction({ title, message, confirmLabel, collections, danger = false }) {
  const dialog = byId('collection-confirm-dialog');
  byId('collection-confirm-title').textContent = title;
  byId('collection-confirm-message').textContent = message;
  const list = byId('collection-confirm-items');
  list.replaceChildren();
  for (const item of collections) {
    const row = document.createElement('li');
    row.textContent = `${item.database}.${item.collection}`;
    list.appendChild(row);
  }
  const confirmButton = byId('collection-confirm-accept');
  confirmButton.textContent = confirmLabel;
  confirmButton.className = danger ? 'danger' : '';
  dialog.returnValue = '';
  return new Promise((resolve, reject) => {
    const onClose = () => resolve(dialog.returnValue === 'confirm');
    dialog.addEventListener('close', onClose, { once: true });
    try {
      dialog.showModal();
    } catch (error) {
      dialog.removeEventListener('close', onClose);
      reject(error);
    }
  });
}

function updateReplacementSourceFields(target, options) {
  const kind = byId('replacement-source-kind').value;
  const isCsv = kind === 'csv';
  byId('replacement-backup-fields').hidden = isCsv;
  byId('replacement-csv-fields').hidden = !isCsv;
  const showPastOptions = isCsv && target.collection === 'PastHoedownTeams';
  byId('replacement-past-fields').hidden = !showPastOptions;
  byId('replacement-event-field').hidden = !showPastOptions ||
    byId('replacement-csv-format').value !== 'event-sheet';
  if (showPastOptions && byId('replacement-csv-format').value === 'event-sheet' &&
      !options.events.length) {
    showStatus('replacement-source-error', 'No supported Hoedown events are configured.');
  } else {
    showStatus('replacement-source-error', '');
  }
}

function chooseReplacementSource(target, options) {
  const dialog = byId('replacement-source-dialog');
  const backupSelect = byId('replacement-backup-select');
  const eventSelect = byId('replacement-event-select');
  const kindSelect = byId('replacement-source-kind');
  const backupAvailable = options.backups.length > 0;
  const csvAvailable = options.csvSupported;
  const backupKind = kindSelect.querySelector('option[value="backup"]');
  const csvKind = kindSelect.querySelector('option[value="csv"]');
  backupKind.hidden = !backupAvailable;
  csvKind.hidden = !csvAvailable;
  byId('replacement-source-kind-field').hidden = !(backupAvailable && csvAvailable);

  backupSelect.replaceChildren();
  for (const backup of options.backups) {
    const option = document.createElement('option');
    option.value = backup.collection;
    option.textContent = `${backup.collection} — ${displayDate(backup.createdAt)}`;
    backupSelect.appendChild(option);
  }
  eventSelect.replaceChildren();
  for (const event of options.events) {
    const option = document.createElement('option');
    option.value = event.id;
    option.textContent = event.name;
    eventSelect.appendChild(option);
  }
  selectedReplacementCsv = null;
  byId('replacement-csv-name').textContent = 'No CSV selected.';
  byId('replacement-csv-format').value = 'normalized';
  dialog.returnValue = '';
  kindSelect.value = backupAvailable ? 'backup' : 'csv';
  byId('replacement-target').textContent = `Target: ${target.database}.${target.collection}`;
  updateReplacementSourceFields(target, options);

  return new Promise((resolve, reject) => {
    let selectedSource = null;
    const continueButton = byId('replacement-source-continue');
    const chooseCsvButton = byId('replacement-choose-csv');
    const onKindChange = () => updateReplacementSourceFields(target, options);
    const onFormatChange = () => updateReplacementSourceFields(target, options);
    const onChooseCsv = async () => {
      try {
        const selection = await window.admin.chooseReplacementCsv();
        if (selection.canceled) return;
        selectedReplacementCsv = selection;
        byId('replacement-csv-name').textContent =
          `${selection.fileName} (${(selection.size / (1024 * 1024)).toFixed(2)} MB)`;
        showStatus('replacement-source-error', '');
      } catch (error) {
        showStatus('replacement-source-error', error.message || 'Could not choose the CSV file.');
      }
    };
    const onContinue = () => {
      if (kindSelect.value === 'backup') {
        if (!backupSelect.value) {
          showStatus('replacement-source-error', 'Choose an eligible backup snapshot.');
          return;
        }
        selectedSource = {
          kind: 'backup',
          backupCollection: backupSelect.value
        };
      } else {
        if (!selectedReplacementCsv) {
          showStatus('replacement-source-error', 'Choose a CSV file first.');
          return;
        }
        const format = target.collection === 'PastHoedownTeams'
          ? byId('replacement-csv-format').value
          : 'normalized';
        const eventId = format === 'event-sheet' ? eventSelect.value : undefined;
        if (format === 'event-sheet' && !eventId) {
          showStatus('replacement-source-error', 'Choose the Hoedown event for this event-sheet CSV.');
          return;
        }
        selectedSource = {
          kind: 'csv',
          csvToken: selectedReplacementCsv.token,
          csvFileName: selectedReplacementCsv.fileName,
          format,
          eventId
        };
      }
      dialog.close('continue');
    };
    const cleanup = () => {
      kindSelect.removeEventListener('change', onKindChange);
      byId('replacement-csv-format').removeEventListener('change', onFormatChange);
      chooseCsvButton.removeEventListener('click', onChooseCsv);
      continueButton.removeEventListener('click', onContinue);
      dialog.removeEventListener('close', onClose);
    };
    const onClose = () => {
      cleanup();
      resolve(dialog.returnValue === 'continue' ? selectedSource : null);
    };
    kindSelect.addEventListener('change', onKindChange);
    byId('replacement-csv-format').addEventListener('change', onFormatChange);
    chooseCsvButton.addEventListener('click', onChooseCsv);
    continueButton.addEventListener('click', onContinue);
    dialog.addEventListener('close', onClose);
    try {
      dialog.showModal();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

byId('create-backups').addEventListener('click', async () => {
  const collections = getSelectedBackupCollections();
  if (!collections.length) return;
  const confirmed = await confirmCollectionAction({
    title: 'Create collection backups?',
    message: 'Timestamped copies of these collections, including their documents and custom indexes, will be saved in the configured backup database.',
    confirmLabel: 'Create backups',
    collections
  });
  if (!confirmed) return;
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

window.admin.onAdminUpdateStatus((update) => {
  if (!update || typeof update.message !== 'string') return;
  showStatus('admin-update-status', update.message);
  byId('install-admin-update').hidden = update.ready !== true;
});

window.admin.onPasskeyLoginLink((url) => {
  passkeyLoginUrl = typeof url === 'string' ? url : '';
  byId('passkey-browser-help').hidden = !passkeyLoginUrl;
  byId('copy-passkey-link').disabled = !passkeyLoginUrl;
  byId('cancel-passkey-sign-in').disabled = !passkeyLoginUrl;
});

byId('download-full-export').addEventListener('click', async () => {
  if (backupLoading || backupRunning || databaseExportRunning) return;
  const confirmed = await confirmCollectionAction({
    title: 'Download full database export?',
    message: 'This export includes all non-system collections from the operational, backup, and Admin/auth databases. It includes account password hashes and passkey/session metadata. The file is compressed but not encrypted; anyone with the file could inspect its contents. Continue only if you can store it securely.',
    confirmLabel: 'Choose save location',
    collections: []
  });
  if (!confirmed) return;

  databaseExportRunning = true;
  updateBackupControls();
  showStatus('backup-status', 'Preparing the full database export. This may take several minutes.');
  try {
    const result = await window.admin.downloadDatabaseExport();
    showStatus(
      'backup-status',
      result.canceled ? 'Export canceled.' : `Full database export saved to ${result.fileName}.`
    );
  } catch (error) {
    showStatus('backup-status', error.message || 'Could not download the full database export.');
  } finally {
    databaseExportRunning = false;
    updateBackupControls();
  }
});

byId('restore-full-export').addEventListener('click', async () => {
  if (backupLoading || backupRunning || databaseExportRunning || databaseRestoreRunning) return;
  const confirmed = await confirmCollectionAction({
    title: 'Replace all configured databases?',
    message: 'This will upload a .jsonl.gz export to Render over HTTPS and replace every configured database, including Admin/auth. Current account/passkey data and all current collections will be replaced; the current Admin session may stop working. Make sure the export is trusted, you have a separate recovery passkey, and database writes are quiet. Selecting a file starts the restore.',
    confirmLabel: 'Choose export file',
    collections: [],
    danger: true
  });
  if (!confirmed) return;

  databaseRestoreRunning = true;
  updateBackupControls();
  showStatus('backup-status', 'Choose the export file to upload and restore. This may take several minutes.');
  try {
    const result = await window.admin.restoreDatabaseExport();
    if (result.canceled) {
      showStatus('backup-status', 'Database restore canceled.');
    } else {
      const cleanupWarning = result.cleanupWarningCount
        ? ` ${result.cleanupWarningCount} previous collection(s) could not be removed; review the service logs.`
        : '';
      showStatus(
        'backup-status',
        `Restored ${result.documentCount} document(s) across ${result.collectionCount} collection(s) and ${result.viewCount} view(s) from ${result.fileName}.${cleanupWarning}`
      );
    }
  } catch (error) {
    showStatus('backup-status', error.message || 'Could not restore the full database export.');
  } finally {
    databaseRestoreRunning = false;
    updateBackupControls();
  }
});

byId('wipe-selected').addEventListener('click', async () => {
  const collections = getSelectedBackupCollections();
  if (!collections.length) return;
  const confirmed = await confirmCollectionAction({
    title: 'Wipe selected collection data?',
    message: 'This permanently deletes every document in these collections. The collections and their indexes will remain. This action cannot be undone.',
    confirmLabel: 'Wipe data',
    collections,
    danger: true
  });
  if (!confirmed) return;
  backupRunning = true;
  updateBackupControls();
  showStatus('backup-status', `Wiping data from ${collections.length} collection(s)…`);
  try {
    const result = await window.admin.wipeCollections(collections);
    const succeeded = result.results.filter((item) => item.success);
    const failed = result.results.filter((item) => !item.success);
    const deletedCount = succeeded.reduce((count, item) =>
      count + (Number.isInteger(item.deletedCount) ? item.deletedCount : 0), 0);
    const summary = `Wiped ${succeeded.length} collection(s), deleting ${deletedCount} document(s)${failed.length ? `; ${failed.length} failed` : ''}.` +
      (result.auditLogged ? ' Recorded in the admin audit log.' : ' The admin audit log could not be updated.');
    showStatus('backup-status', failed.length
      ? `${summary} ${failed.map((item) => `${item.database}.${item.collection}: ${item.error}`).join(' ')}`
      : summary);
    try {
      await loadBackups({ quiet: true });
    } catch (error) {
      showStatus('backup-status', `${summary} Could not refresh the collection list: ${error.message}`);
    }
  } catch (error) {
    showStatus('backup-status', error.message || 'Could not wipe selected collections.');
  } finally {
    backupRunning = false;
    updateBackupControls();
  }
});

byId('replace-selected').addEventListener('click', async () => {
  const selected = getSelectedBackupCollections();
  if (selected.length !== 1) return;
  const target = selected[0];
  backupRunning = true;
  updateBackupControls();
  showStatus('backup-status', `Loading replacement sources for ${target.database}.${target.collection}…`);
  try {
    const options = await window.admin.getReplacementOptions(target);
    if (options.backups.length === 0 && !options.csvSupported) {
      throw new Error('No matching backup snapshots or supported CSV source are available for this collection.');
    }
    const source = await chooseReplacementSource(target, options);
    if (!source) return;
    const sourceDescription = source.kind === 'backup'
      ? `backup snapshot ${source.backupCollection}`
      : `CSV file ${source.csvFileName}`;
    const confirmed = await confirmCollectionAction({
      title: 'Replace collection data?',
      message: `Replace the target collection's current documents using ${sourceDescription}. The operation validates and stages the replacement before switching it into place.`,
      confirmLabel: 'Replace collection',
      collections: [target],
      danger: true
    });
    if (!confirmed) return;
    showStatus('backup-status', `Replacing ${target.database}.${target.collection} from ${sourceDescription}…`);
    const result = source.kind === 'backup'
      ? await window.admin.replaceFromBackup({
        database: target.database,
        collection: target.collection,
        backupCollection: source.backupCollection
      })
      : await window.admin.replaceFromCsv({
        database: target.database,
        collection: target.collection,
        csvToken: source.csvToken,
        format: source.format,
        eventId: source.eventId
      });
    const summary = `Replaced ${target.database}.${target.collection} with ${result.documentCount} document(s) and ${result.indexCount} index(es).` +
      (result.auditLogged ? ' Recorded in the admin audit log.' : ' The admin audit log could not be updated.');
    showStatus('backup-status', summary);
    selectedReplacementCsv = null;
    try {
      await loadBackups({ quiet: true });
    } catch (error) {
      showStatus('backup-status', `${summary} Could not refresh the collection list: ${error.message}`);
    }
  } catch (error) {
    showStatus('backup-status', error.message || 'Could not replace the selected collection.');
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
  if (!currentSettings.hasAdminSession) {
    botSettingsLoaded = false;
    saveButton.disabled = true;
    refreshButton.disabled = true;
    showStatus(
      'bot-settings-status',
      currentSettings.configured
        ? 'Sign in with your passkey to load bot settings.'
        : 'Save the Render service URL and sign in to load bot settings.'
    );
    return;
  }
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
    refreshButton.disabled = !currentSettings.hasAdminSession;
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
    await loadSettings();
      showStatus(
        'auth-status',
        currentSettings.hasBootstrapKey
          ? 'Connection saved. Expand First-time owner setup to enroll the first passkey.'
          : 'Connection settings saved securely on this computer.'
      );
  } catch (error) {
    showStatus('auth-status', error.message || 'Could not save connection settings.');
  }
});

byId('enroll-passkey').addEventListener('click', async () => {
  try {
    const result = await window.admin.enrollPasskey();
    await loadSettings();
    showStatus(
      currentSettings.hasAdminSession ? 'connection-status' : 'auth-status',
      result.enrolled
        ? 'First passkey enrolled. The one-time enrollment key was removed; add a separate backup passkey now.'
        : 'Passkey enrollment completed.'
    );
    await loadBotSettings();
    await loadUsers();
  } catch (error) {
    showStatus('auth-status', error.message || 'Passkey enrollment failed.');
  }
});

byId('add-passkey').addEventListener('click', async () => {
  try {
    await window.admin.addPasskey();
    showStatus('connection-status', 'Passkey setup opened in your browser. Finish registration there, then store the backup key separately.');
  } catch (error) {
    showStatus('connection-status', error.message || 'Could not add a backup passkey.');
  }
});

byId('sign-in-passkey').addEventListener('click', async () => {
  const button = byId('sign-in-passkey');
  button.disabled = true;
  showStatus('auth-status', 'Waiting for passkey verification in your browser…');
  try {
    const result = await window.admin.signInPasskey();
    await loadSettings();
    showStatus('connection-status', `Passkey sign-in succeeded until ${displayDate(result.expiresAt)}.`);
    await loadBotSettings();
    await loadUsers();
  } catch (error) {
    showStatus(
      'auth-status',
      error.message === 'Passkey sign-in canceled.'
        ? 'Sign-in canceled. You can try again in the browser that has your passkey.'
        : error.message || 'Passkey sign-in failed.'
    );
  } finally {
    button.disabled = !currentSettings.configured;
  }
});

byId('copy-passkey-link').addEventListener('click', async () => {
  if (!passkeyLoginUrl) return;
  try {
    await window.admin.copyText(passkeyLoginUrl);
    showStatus('auth-status', 'Temporary sign-in link copied. Paste it into the browser that has your passkey.');
  } catch (error) {
    showStatus('auth-status', error.message || 'Could not copy the sign-in link.');
  }
});

byId('cancel-passkey-sign-in').addEventListener('click', async () => {
  const button = byId('cancel-passkey-sign-in');
  button.disabled = true;
  showStatus('auth-status', 'Canceling passkey sign-in…');
  try {
    await window.admin.cancelPasskeyFlow();
  } catch (error) {
    showStatus('auth-status', error.message || 'Could not cancel passkey sign-in.');
    button.disabled = false;
  }
});

byId('sign-out-admin').addEventListener('click', async () => {
  try {
    await window.admin.signOutAdmin();
    await loadSettings();
    showStatus('auth-status', 'This computer has been signed out.');
  } catch (error) {
    await loadSettings();
    showStatus(
      currentSettings.hasAdminSession ? 'connection-status' : 'auth-status',
      error.message || 'Could not sign out this computer.'
    );
  }
});

byId('refresh-admin-sessions').addEventListener('click', loadAdminSessions);
byId('admin-session-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-session-id]');
  if (!button) return;
  if (!window.confirm('Revoke this Admin session? That computer will need to sign in again.')) return;
  button.disabled = true;
  try {
    await window.admin.revokeAdminSession(button.dataset.sessionId);
    await loadAdminSessions();
    showStatus('connection-status', 'The selected Admin session was revoked.');
  } catch (error) {
    showStatus('admin-session-status', error.message || 'Could not revoke the Admin session.');
    button.disabled = false;
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
      `Latest published versions — desktop beta: ${result.beta || 'none'}, stable: ${result.stable || 'none'}; ` +
      `Account Manager beta: ${result.accountManagerBeta || 'none'}, stable: ${result.accountManagerStable || 'none'}.`
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
    showStatus('release-status', `Applied ${channel} channel to both app configs.`);
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
  const task = button.dataset.task;
  const output = byId('build-output');
  output.textContent = '';
  if (Object.hasOwn(BUILD_TASK_NAMES, task)) {
    if (buildEtaTimer) clearInterval(buildEtaTimer);
    buildEtaTimer = null;
    activeBuildEta = null;
    showStatus('build-eta', 'Preparing build…');
  }
  button.disabled = true;
  showStatus('release-status', 'Release task running…');
  try {
    const channel = byId('release-channel').value;
    let result = await window.admin.runReleaseTask(task, channel);
    if (result.confirmationRequired) {
      const confirmation = result.confirmation;
      let confirmed = false;
      try {
        confirmed = await confirmPublishRelease(confirmation);
      } catch (error) {
        await window.admin.cancelPublishConfirmation(confirmation.id);
        throw error;
      }
      if (!confirmed) {
        await window.admin.cancelPublishConfirmation(confirmation.id);
        showStatus('release-status', 'Publish canceled.');
        return;
      }
      result = await window.admin.runReleaseTask(task, channel, confirmation.id);
    }
    finishBuildEta(task, result.buildTiming);
    showStatus('release-status', result.canceled
      ? 'Publish canceled.'
      : `Completed ${result.task}. Output: ${result.artifactDirectory || result.outputDirectory}`);
  } catch (error) {
    finishBuildEta(task, null, error);
    showStatus('release-status', error.message || 'Release task failed.');
  } finally {
    button.disabled = false;
  }
});

byId('release-download-actions').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-download-app]');
  if (!button) return;
  const urlInput = byId('release-download-url');
  const copyButton = byId('copy-release-download');
  urlInput.value = '';
  copyButton.disabled = true;
  button.disabled = true;
  showStatus('release-download-status', 'Generating a passkey-protected download link…');
  try {
    const result = await window.admin.createReleaseDownloadLink(
      button.dataset.downloadApp,
      byId('release-channel').value
    );
    urlInput.value = result.url;
    copyButton.disabled = false;
    showStatus(
      'release-download-status',
      `${result.fileName} (${result.version}) is ready. Link expires ${displayDate(result.expiresAt)}. Anyone with it can download until it expires.`
    );
  } catch (error) {
    showStatus('release-download-status', error.message || 'Could not generate the app download link.');
  } finally {
    button.disabled = false;
  }
});

byId('copy-release-download').addEventListener('click', async () => {
  const url = byId('release-download-url').value;
  if (!url) return;
  try {
    await window.admin.copyText(url);
    showStatus('release-download-status', 'Temporary download link copied. Share it before it expires.');
  } catch (error) {
    showStatus('release-download-status', error.message || 'Could not copy the download link.');
  }
});

byId('release-channel').addEventListener('change', () => {
  byId('release-download-url').value = '';
  byId('copy-release-download').disabled = true;
  showStatus('release-download-status', '');
});

window.admin.onBuildEtaStart(startBuildEta);

window.admin.onOutput((text) => {
  byId('build-output').textContent += text;
  byId('build-output').scrollTop = byId('build-output').scrollHeight;
});

(async () => {
  await loadSettings();
  if (currentSettings.hasAdminSession) {
    await Promise.all([loadReleaseInfo(), loadBotSettings()]);
  }
})().catch((error) => {
  showStatus(
    currentSettings.hasAdminSession ? 'global-status' : 'auth-status',
    error.message || 'Could not load account manager.'
  );
});
