const loginForm = document.getElementById('login-form');
const passwordForm = document.getElementById('password-form');
const signedInPanel = document.getElementById('signed-in');
const status = document.getElementById('status');
const connection = document.getElementById('connection');
const selfPasswordForm = document.getElementById('self-password-form');
const updateBox = document.getElementById('update-box');
let resetToken = null;
let memberRecords = [];
let membersLoaded = false;
let membersLoading = false;
let memberResyncPending = false;
let avoidRecords = [];
let avoidsLoaded = false;
let avoidsLoading = false;
const memberEdits = new Map();
const memberChangeVersions = new Map();

const pages = {
  members: {
    title: 'Members',
    icon: '👥',
    description: 'Member tools and player information will live here.'
  },
  avoids: {
    title: 'Avoids',
    icon: '🚫',
    description: 'Search directional player avoid relationships.'
  },
  rounds: {
    title: 'Rounds',
    icon: '🤠',
    description: 'View and manage Hoedown rounds and teams here.'
  },
  tickets: {
    title: 'Tickets',
    icon: '🎟️',
    description: 'View and manage support tickets here.'
  }
};
const editableMemberFields = [
  { name: 'nickname', label: 'Nickname', maxLength: 32 },
  { name: 'region', label: 'Region', maxLength: 32 },
  { name: 'steamId', label: 'Steam ID', maxLength: 128 },
  { name: 'streamLink', label: 'Stream link', maxLength: 2048, type: 'url' }
];

function showStatus(message) {
  status.textContent = message || '';
}

function showSignedOut() {
  loginForm.hidden = false;
  passwordForm.hidden = true;
  signedInPanel.hidden = true;
  document.getElementById('auth-header').hidden = false;
  selfPasswordForm.hidden = true;
  document.getElementById('app-footer').hidden = false;
  membersLoaded = false;
  memberRecords = [];
  memberEdits.clear();
  memberChangeVersions.clear();
  memberResyncPending = false;
  document.getElementById('members-list').replaceChildren();
  document.getElementById('members-summary').textContent = 'Sign in to load member records.';
  document.getElementById('members-state').textContent = 'Member records are not loaded.';
  document.getElementById('members-live-status').textContent = '';
  avoidRecords = [];
  avoidsLoaded = false;
  document.getElementById('avoids-list').replaceChildren();
  document.getElementById('avoids-summary').textContent = 'Sign in to load avoid relationships.';
  document.getElementById('avoids-state').textContent = 'Avoid relationships are not loaded.';
  resetToken = null;
}

function applyAuthState(state) {
  if (state && state.signedIn) {
    loginForm.hidden = true;
    passwordForm.hidden = true;
    signedInPanel.hidden = false;
    document.getElementById('auth-header').hidden = true;
    document.getElementById('account-name').textContent = state.username || 'Account';
    document.getElementById('welcome-name').textContent = state.username || 'partner';
    document.getElementById('app-footer').hidden = true;
    connection.hidden = true;
    showStatus('');
    if (!membersLoaded && !membersLoading) void loadMembers();
    if (document.querySelector('.nav-item.active')?.dataset.tab === 'avoids' &&
        !avoidsLoaded && !avoidsLoading) void loadAvoids();
  } else {
    showSignedOut();
    if (state && state.error) {
      connection.textContent = state.error;
      connection.hidden = false;
    }
  }
}

document.getElementById('app-navigation').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;
  const page = pages[button.dataset.tab];
  if (!page) return;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.getElementById('page-title').textContent = page.title;
  document.getElementById('page-heading').textContent = page.title;
  document.getElementById('page-icon').textContent = page.icon;
  document.getElementById('page-description').textContent = page.description;
  const isMembers = button.dataset.tab === 'members';
  const isAvoids = button.dataset.tab === 'avoids';
  document.getElementById('members-view').hidden = !isMembers;
  document.getElementById('avoids-view').hidden = !isAvoids;
  document.getElementById('page-card').hidden = isMembers || isAvoids;
  selfPasswordForm.hidden = true;
  showStatus('');
  if (isMembers && !membersLoaded && !membersLoading) void loadMembers();
  if (isAvoids && !avoidsLoaded && !avoidsLoading) void loadAvoids();
});

function createMemberDetail(fieldName, label, value) {
  const detail = document.createElement('div');
  detail.className = 'member-detail';
  if (fieldName === 'username' || fieldName === 'nickname') {
    detail.classList.add('member-detail-editable');
  }
  const term = document.createElement('span');
  term.className = 'member-detail-label';
  term.textContent = label;
  const description = document.createElement('span');
  description.className = 'member-detail-value';
  description.dataset.memberField = fieldName;
  description.textContent = value || '—';
  detail.append(term, description);
  return detail;
}

function createMemberAction(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function createMemberEditor(field, member, edit) {
  const detail = document.createElement('label');
  detail.className = 'member-detail';
  const term = document.createElement('span');
  term.className = 'member-detail-label';
  term.textContent = field.label;
  const input = document.createElement('input');
  input.className = 'member-edit-input';
  input.dataset.memberField = field.name;
  input.type = field.type || 'text';
  input.name = field.name;
  input.maxLength = field.maxLength;
  input.required = field.required === true;
  input.value = edit.fields[field.name] || '';
  input.disabled = edit.saving;
  input.setAttribute('aria-label', field.label);
  input.addEventListener('input', () => {
    edit.fields[field.name] = input.value;
    if (edit.conflicts.has(field.name) && input.value === (member[field.name] || '')) {
      edit.conflicts.delete(field.name);
    }
    const row = input.closest('.member-row');
    const notice = row.querySelector('.member-edit-conflict');
    notice.hidden = edit.conflicts.size === 0;
    if (!notice.hidden) notice.textContent = conflictMessage(edit);
  });
  detail.append(term, input);
  return detail;
}

function conflictMessage(edit) {
  const fields = [...edit.conflicts].map((name) =>
    editableMemberFields.find((field) => field.name === name)?.label || name
  );
  return `Updated elsewhere (${fields.join(', ')}). Your draft is preserved; saving will apply your values for those fields.`;
}

function editMemberRow(row, member) {
  memberEdits.set(member.discordId, {
    baseline: { ...member },
    fields: Object.fromEntries(editableMemberFields.map((field) => [
      field.name,
      member[field.name] || ''
    ])),
    conflicts: new Set(),
    error: '',
    saving: false
  });
  renderMembers();
  document.querySelector(
    `.member-row[data-discord-id="${CSS.escape(member.discordId)}"] .member-edit-input`
  )?.focus();
}

function mergeMemberDraft(member, updatedMember, edit) {
  if (!edit) return;
  for (const field of editableMemberFields) {
    const previousValue = edit.baseline[field.name] || '';
    const remoteValue = updatedMember[field.name] || '';
    const localValue = edit.fields[field.name] || '';
    if (remoteValue === previousValue) continue;
    if (localValue !== previousValue && localValue !== remoteValue) {
      edit.conflicts.add(field.name);
    } else {
      edit.fields[field.name] = remoteValue;
      edit.conflicts.delete(field.name);
    }
  }
  edit.baseline = { ...updatedMember };
}

function mergeMemberList(profiles) {
  const currentMembers = new Map(memberRecords.map((member) => [member.discordId, member]));
  const updatedIds = new Set();
  const nextMembers = profiles.map((profile) => {
    updatedIds.add(profile.discordId);
    const current = currentMembers.get(profile.discordId);
    mergeMemberDraft(current, profile, memberEdits.get(profile.discordId));
    return profile;
  });
  for (const member of memberRecords) {
    if (!updatedIds.has(member.discordId) && memberEdits.has(member.discordId)) {
      nextMembers.push(member);
    }
  }
  memberRecords = nextMembers.sort((a, b) =>
    (a.username || '').localeCompare(b.username || '', 'en', { sensitivity: 'base' })
  );
}

function applyMemberChange(change) {
  if (!change || typeof change !== 'object') return;
  if (change.type === 'deleted' && typeof change.discordId === 'string') {
    memberChangeVersions.set(
      change.discordId,
      (memberChangeVersions.get(change.discordId) || 0) + 1
    );
    if (memberEdits.has(change.discordId)) {
      const edit = memberEdits.get(change.discordId);
      edit.error = 'This profile was removed elsewhere. Your draft is preserved, but it can no longer be saved.';
    } else {
      memberRecords = memberRecords.filter((member) => member.discordId !== change.discordId);
    }
    renderMembers();
    return;
  }
  const updatedMember = change.member;
  if (change.type !== 'updated' || !updatedMember || typeof updatedMember.discordId !== 'string') return;
  memberChangeVersions.set(
    updatedMember.discordId,
    (memberChangeVersions.get(updatedMember.discordId) || 0) + 1
  );
  const index = memberRecords.findIndex((member) => member.discordId === updatedMember.discordId);
  if (index === -1) {
    memberRecords.push(updatedMember);
    memberRecords.sort((a, b) =>
      (a.username || '').localeCompare(b.username || '', 'en', { sensitivity: 'base' })
    );
  } else {
    mergeMemberDraft(
      memberRecords[index],
      updatedMember,
      memberEdits.get(updatedMember.discordId)
    );
    memberRecords[index] = updatedMember;
  }
  renderMembers();
}

async function saveMemberRow(member) {
  const edit = memberEdits.get(member.discordId);
  const currentMember = memberRecords.find((entry) => entry.discordId === member.discordId);
  if (!edit || !currentMember || edit.saving) return;
  const fields = Object.fromEntries(editableMemberFields
    .filter((field) => (edit.fields[field.name] || '') !== (currentMember[field.name] || ''))
    .map((field) => [field.name, edit.fields[field.name] || '']));
  if (!Object.keys(fields).length) {
    memberEdits.delete(member.discordId);
    renderMembers();
    return;
  }

  const observedChangeVersion = memberChangeVersions.get(member.discordId) || 0;
  edit.saving = true;
  edit.error = '';
  renderMembers();
  try {
    const result = await window.hoedown.updateMember(member.discordId, fields);
    if (!result.ok) throw new Error(result.error || 'Could not save member changes.');
    const memberIndex = memberRecords.findIndex((entry) => entry.discordId === member.discordId);
    if (memberIndex === -1) throw new Error('The saved member is no longer in the list. Refresh and try again.');
    if ((memberChangeVersions.get(member.discordId) || 0) === observedChangeVersion) {
      memberRecords[memberIndex] = result.member;
    }
    memberEdits.delete(member.discordId);
    renderMembers();
  } catch (error) {
    edit.saving = false;
    edit.error = error.message || 'Could not save member changes.';
    renderMembers();
  }
}

function renderMembers() {
  const list = document.getElementById('members-list');
  const state = document.getElementById('members-state');
  const query = document.getElementById('member-search').value.trim().toLowerCase();
  const scrollTop = list.scrollTop;
  const activeElement = document.activeElement;
  const activeRow = activeElement?.closest('.member-row');
  const activeDiscordId = activeRow?.dataset.discordId;
  const activeField = activeElement?.dataset.memberField;
  const activeAction = activeElement?.classList.contains('member-save-button')
    ? 'member-save-button'
    : activeElement?.classList.contains('member-cancel-button') ? 'member-cancel-button' : '';
  const selectionStart = typeof activeElement?.selectionStart === 'number' ? activeElement.selectionStart : null;
  const selectionEnd = typeof activeElement?.selectionEnd === 'number' ? activeElement.selectionEnd : null;
  list.replaceChildren();

  for (const member of memberRecords) {
    const edit = memberEdits.get(member.discordId);
    const username = member.username || '';
    const nickname = member.nickname || '';
    const discordId = member.discordId || '';
    const region = member.region || '';
    const steamId = member.steamId || '';
    const streamLink = member.streamLink || '';
    const row = document.createElement('article');
    row.className = 'member-row';
    row.setAttribute('role', 'listitem');
    row.dataset.search = [username, nickname, discordId, region, steamId, streamLink].join(' ').toLowerCase();

    const identity = document.createElement('div');
    identity.className = 'member-identity';
    const name = document.createElement('h3');
    name.textContent = nickname || username || discordId || 'Unknown member';
    const account = document.createElement('p');
    account.textContent = username ? `@${username}` : 'No username listed';
    identity.append(name, account);

    const details = document.createElement('div');
    details.className = 'member-details';
    details.append(createMemberDetail('discordId', 'Discord ID', discordId));
    if (edit) {
      for (const field of editableMemberFields) {
        details.append(createMemberEditor(field, member, edit));
      }
    } else {
      details.append(
        createMemberDetail('region', 'Region', region),
        createMemberDetail('steamId', 'Steam ID', steamId),
        createMemberDetail('streamLink', 'Stream link', streamLink),
        createMemberDetail('nickname', 'Nickname', nickname)
      );
    }
    const actions = document.createElement('div');
    actions.className = 'member-actions';
    actions.append(
      createMemberAction('Edit', 'member-edit-button', () => editMemberRow(row, member)),
      createMemberAction('Save', 'member-save-button', () => { void saveMemberRow(member); }),
      createMemberAction('Cancel', 'member-cancel-button secondary', () => {
        memberEdits.delete(member.discordId);
        renderMembers();
      })
    );
    actions.querySelector('.member-edit-button').hidden = Boolean(edit);
    actions.querySelector('.member-save-button').hidden = !edit;
    actions.querySelector('.member-save-button').disabled = Boolean(edit?.saving);
    actions.querySelector('.member-cancel-button').hidden = !edit;
    const editError = document.createElement('p');
    editError.className = 'member-edit-error';
    editError.setAttribute('role', 'alert');
    editError.textContent = edit?.error || '';
    editError.hidden = !edit?.error;
    const editConflict = document.createElement('p');
    editConflict.className = 'member-edit-conflict';
    editConflict.setAttribute('role', 'status');
    editConflict.hidden = !edit || edit.conflicts.size === 0;
    if (edit && edit.conflicts.size) editConflict.textContent = conflictMessage(edit);
    row.dataset.discordId = discordId;
    row.append(identity, details, actions, editError, editConflict);
    list.append(row);
  }
  list.scrollTop = scrollTop;
  if (activeDiscordId) {
    const row = [...list.children].find((item) => item.dataset.discordId === activeDiscordId);
    const focusTarget = activeField
      ? row?.querySelector(`[data-member-field="${activeField}"]`)
      : activeAction ? row?.querySelector(`.${activeAction}`) : null;
    if (focusTarget && !focusTarget.disabled && !focusTarget.hidden) {
      focusTarget.focus();
      if (selectionStart !== null && typeof focusTarget.setSelectionRange === 'function') {
        focusTarget.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }

  const visibleCount = [...list.children].filter((row) => {
    const visible = !query || row.dataset.search.includes(query);
    row.hidden = !visible;
    return visible;
  }).length;
  const totalCount = memberRecords.length;
  document.getElementById('members-summary').textContent = query
    ? `Showing ${visibleCount} of ${totalCount} member(s).`
    : `${totalCount} member${totalCount === 1 ? '' : 's'}.`;
  state.hidden = visibleCount > 0;
  if (totalCount === 0) state.textContent = 'No member records were found.';
  else if (query && visibleCount === 0) state.textContent = 'No members match your search.';
}

async function loadMembers(options = {}) {
  if (membersLoading) return;
  membersLoading = true;
  const refreshButton = document.getElementById('refresh-members');
  const state = document.getElementById('members-state');
  refreshButton.disabled = true;
  state.hidden = false;
  state.textContent = 'Loading members…';
  document.getElementById('members-summary').textContent = 'Loading member records…';
  try {
    const result = await window.hoedown.getMembers();
    if (!result.ok) throw new Error(result.error || 'Could not load Members.');
    if (options.preserveEdits) mergeMemberList(result.members);
    else memberRecords = result.members;
    membersLoaded = true;
    renderMembers();
    if (result.truncated) {
      document.getElementById('members-summary').textContent += ' Only the first 5,000 records are shown.';
    }
  } catch (error) {
    membersLoaded = false;
    state.hidden = false;
    state.textContent = error.message || 'Could not load members.';
    document.getElementById('members-summary').textContent = 'Member records could not be loaded.';
  } finally {
    membersLoading = false;
    refreshButton.disabled = false;
    if (memberResyncPending) {
      memberResyncPending = false;
      void loadMembers({ preserveEdits: true });
    }
  }
}

async function resyncMembers() {
  if (membersLoading) {
    memberResyncPending = true;
    return;
  }
  try {
    await loadMembers({ preserveEdits: true });
  } catch (error) {
    document.getElementById('members-state').textContent = error.message || 'Could not refresh members.';
  }
}

function renderAvoids() {
  const list = document.getElementById('avoids-list');
  const state = document.getElementById('avoids-state');
  const query = document.getElementById('avoids-search').value.trim().toLowerCase();
  const matches = avoidRecords.filter((pair) => [
    pair.avoiderName,
    pair.avoiderDiscordId,
    pair.avoidedName,
    pair.avoidedDiscordId
  ].join(' ').toLowerCase().includes(query));
  list.replaceChildren();

  for (const pair of matches) {
    const row = document.createElement('article');
    row.className = 'avoid-row';
    row.setAttribute('role', 'listitem');
    const avoider = document.createElement('div');
    avoider.className = 'avoid-player';
    const avoiderLabel = document.createElement('span');
    avoiderLabel.className = 'avoid-player-label';
    avoiderLabel.textContent = 'Avoider';
    const avoiderName = document.createElement('strong');
    avoiderName.textContent = pair.avoiderName || pair.avoiderDiscordId || 'Unknown member';
    const avoiderId = document.createElement('small');
    avoiderId.textContent = pair.avoiderDiscordId || '';
    avoider.append(avoiderLabel, avoiderName, avoiderId);

    const direction = document.createElement('span');
    direction.className = 'avoid-direction';
    direction.textContent = 'avoids';

    const avoided = document.createElement('div');
    avoided.className = 'avoid-player';
    const avoidedLabel = document.createElement('span');
    avoidedLabel.className = 'avoid-player-label';
    avoidedLabel.textContent = 'Avoided player';
    const avoidedName = document.createElement('strong');
    avoidedName.textContent = pair.avoidedName || pair.avoidedDiscordId || 'Unknown member';
    const avoidedId = document.createElement('small');
    avoidedId.textContent = pair.avoidedDiscordId || '';
    avoided.append(avoidedLabel, avoidedName, avoidedId);
    row.append(avoider, direction, avoided);
    list.append(row);
  }

  state.hidden = matches.length > 0;
  if (avoidRecords.length === 0) state.textContent = 'No avoid relationships were found.';
  else if (matches.length === 0 && query) state.textContent = 'No avoid relationships match your search.';
  document.getElementById('avoids-summary').textContent = query
    ? `Showing ${matches.length} of ${avoidRecords.length} directional relationship(s).`
    : `${avoidRecords.length} directional relationship${avoidRecords.length === 1 ? '' : 's'}.`;
}

async function loadAvoids() {
  if (avoidsLoading) return;
  avoidsLoading = true;
  const refreshButton = document.getElementById('refresh-avoids');
  const state = document.getElementById('avoids-state');
  refreshButton.disabled = true;
  state.hidden = false;
  state.textContent = 'Loading avoid relationships…';
  document.getElementById('avoids-summary').textContent = 'Loading avoid relationships…';
  try {
    const result = await window.hoedown.getAvoids();
    if (!result.ok) throw new Error(result.error || 'Could not load Avoids.');
    avoidRecords = result.pairs;
    avoidsLoaded = true;
    renderAvoids();
  } catch (error) {
    avoidsLoaded = false;
    state.hidden = false;
    state.textContent = error.message || 'Could not load avoid relationships.';
    document.getElementById('avoids-summary').textContent = 'Avoid relationships could not be loaded.';
  } finally {
    avoidsLoading = false;
    refreshButton.disabled = false;
  }
}

document.getElementById('member-search').addEventListener('input', renderMembers);
document.getElementById('refresh-members').addEventListener('click', () => {
  membersLoaded = false;
  void loadMembers({ preserveEdits: true });
});
document.getElementById('avoids-search').addEventListener('input', renderAvoids);
document.getElementById('refresh-avoids').addEventListener('click', () => {
  avoidsLoaded = false;
  void loadAvoids();
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button');
  button.disabled = true;
  showStatus('Signing in…');
  try {
    const result = await window.hoedown.login({
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    });
    document.getElementById('password').value = '';
    if (!result.ok) {
      showStatus(result.error || 'Sign-in failed.');
      return;
    }
    if (result.passwordChangeRequired) {
      resetToken = result.resetToken;
      loginForm.hidden = true;
      passwordForm.hidden = false;
      showStatus('Set a new password to continue.');
      return;
    }
    applyAuthState(result);
  } catch (error) {
    showStatus(error.message || 'Could not sign in.');
  } finally {
    button.disabled = false;
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('new-password').value;
  const confirmation = document.getElementById('confirm-password').value;
  if (password !== confirmation) {
    showStatus('The passwords do not match.');
    return;
  }
  const button = passwordForm.querySelector('button');
  button.disabled = true;
  showStatus('Changing password…');
  try {
    const result = await window.hoedown.changePassword(resetToken, password);
    if (!result.ok) {
      showStatus(result.error || 'Could not change the password.');
      return;
    }
    resetToken = null;
    passwordForm.reset();
    showSignedOut();
    showStatus('Password changed. Sign in with your new password.');
  } catch (error) {
    showStatus(error.message || 'Could not change the password.');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('sign-out').addEventListener('click', async () => {
  try {
    const result = await window.hoedown.logout();
    applyAuthState({ signedIn: false });
    showStatus(result.warning || 'Signed out.');
  } catch (error) {
    showStatus(error.message || 'Could not sign out.');
  }
});

document.getElementById('open-password-form').addEventListener('click', () => {
  selfPasswordForm.hidden = !selfPasswordForm.hidden;
  showStatus('');
});

selfPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('self-new-password').value;
  if (password !== document.getElementById('self-confirm-password').value) {
    showStatus('The passwords do not match.');
    return;
  }
  const button = selfPasswordForm.querySelector('button');
  button.disabled = true;
  showStatus('Updating password…');
  try {
    const result = await window.hoedown.updatePassword(
      document.getElementById('current-password').value,
      password
    );
    if (!result.ok) {
      showStatus(result.error || 'Could not update password.');
      return;
    }
    selfPasswordForm.reset();
    selfPasswordForm.hidden = true;
    showStatus('Password updated. Other sessions were signed out.');
  } catch (error) {
    showStatus(error.message || 'Could not update password.');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('install-update').addEventListener('click', async () => {
  try {
    await window.hoedown.installUpdate();
  } catch (error) {
    showStatus(error.message || 'Could not install the update.');
  }
});

window.hoedown.onUpdateStatus((update) => {
  if (!update || !update.message) return;
  updateBox.hidden = false;
  document.getElementById('update-message').textContent = update.message;
  document.getElementById('install-update').hidden = update.ready !== true;
});

window.hoedown.onMemberChange(applyMemberChange);
window.hoedown.onMembersResync(() => { void resyncMembers(); });
window.hoedown.onMembersLiveStatus((liveStatus) => {
  const indicator = document.getElementById('members-live-status');
  if (liveStatus.connected) indicator.textContent = 'Live updates connected';
  else if (liveStatus.reconnecting) indicator.textContent = 'Live updates reconnecting…';
  else if (liveStatus.connecting) indicator.textContent = 'Connecting live updates…';
  else indicator.textContent = '';
});
window.hoedown.onStatus(applyAuthState);
window.hoedown.getStatus()
  .then(applyAuthState)
  .catch((error) => applyAuthState({ signedIn: false, error: error.message }));
