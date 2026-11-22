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
let avoidsResyncPending = false;
let avoidTargetFieldId = 0;
let ticketPeople = [];
let ticketsLoaded = false;
let ticketsLoading = false;
let ticketLoadError = '';
let ticketLoadGeneration = 0;
let ticketResyncTimer = null;
let ticketMessageResyncTimer = null;
let lastTicketMessageRefresh = 0;
let ticketPage = 1;
let ticketPageSize = 50;
let ticketTotal = 0;
let ticketCollectionCount = null;
let ticketDetailGeneration = 0;
let personTicketLoadGeneration = 0;
let personTicketRecords = [];
let personTicketsLoading = false;
let personTicketsError = '';
let selectedPersonSummary = null;
let selectedTicketSummary = null;
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
    description: 'Search and add directional Avoid Pairings.'
  },
  rounds: {
    title: 'Rounds',
    icon: '🤠',
    description: 'View and manage Hoedown rounds and teams here.'
  },
  tickets: {
    title: 'Tickets',
    icon: '🎟️',
    description: 'Browse people with ticket history and review open or closed tickets.'
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

function setLiveUpdatesStatus(liveStatus = {}) {
  const indicator = document.getElementById('live-updates-status');
  const connected = liveStatus.connected === true;
  const label = connected
    ? 'Live updates connected'
    : liveStatus.reconnecting
      ? 'Live updates reconnecting'
      : liveStatus.connecting
        ? 'Connecting live updates'
        : 'Live updates disconnected';
  indicator.classList.toggle('connected', connected);
  indicator.classList.toggle('disconnected', !connected);
  indicator.setAttribute('aria-label', label);
  indicator.title = label;
}

function setAvoidsFeedback(message, isError = false) {
  const feedback = document.getElementById('avoids-feedback');
  feedback.textContent = message || '';
  feedback.classList.toggle('error', isError);
  feedback.hidden = !message;
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
  setLiveUpdatesStatus();
  document.getElementById('add-avoid-pairing').disabled = true;
  avoidRecords = [];
  avoidsLoaded = false;
  avoidsResyncPending = false;
  document.getElementById('avoids-list').replaceChildren();
  document.getElementById('avoids-summary').textContent = 'Sign in to load avoid relationships.';
  document.getElementById('avoids-state').textContent = 'Avoid relationships are not loaded.';
  resetAvoidPairingForm();
  ticketsLoaded = false;
  ticketsLoading = false;
  ticketLoadError = '';
  ticketLoadGeneration += 1;
  ticketDetailGeneration += 1;
  personTicketLoadGeneration += 1;
  if (ticketResyncTimer) clearTimeout(ticketResyncTimer);
  ticketResyncTimer = null;
  if (ticketMessageResyncTimer) clearTimeout(ticketMessageResyncTimer);
  ticketMessageResyncTimer = null;
  ticketPage = 1;
  ticketTotal = 0;
  ticketCollectionCount = null;
  ticketPeople = [];
  personTicketRecords = [];
  personTicketsLoading = false;
  personTicketsError = '';
  selectedPersonSummary = null;
  selectedTicketSummary = null;
  document.getElementById('tickets-list').replaceChildren();
  document.getElementById('tickets-summary').textContent = 'Sign in to load ticket history.';
  document.getElementById('tickets-state').textContent = 'Tickets are not loaded.';
  document.getElementById('ticket-search').value = '';
  document.getElementById('ticket-from').value = '';
  document.getElementById('ticket-to').value = '';
  document.getElementById('person-tickets-view').hidden = true;
  document.getElementById('ticket-list-view').hidden = false;
  document.getElementById('person-tickets-summary').textContent = '';
  document.getElementById('open-person-tickets').replaceChildren();
  document.getElementById('closed-person-tickets').replaceChildren();
  document.getElementById('ticket-detail-content').replaceChildren();
  document.getElementById('ticket-detail-view').hidden = true;
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
    if (!avoidsLoaded && !avoidsLoading) void loadAvoids();
    if (!ticketsLoaded && !ticketsLoading) void loadTickets(1);
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
  const isTickets = button.dataset.tab === 'tickets';
  document.getElementById('members-view').hidden = !isMembers;
  document.getElementById('avoids-view').hidden = !isAvoids;
  document.getElementById('tickets-view').hidden = !isTickets;
  document.getElementById('page-card').hidden = isMembers || isAvoids || isTickets;
  selfPasswordForm.hidden = true;
  showStatus('');
  if (isMembers && !membersLoaded && !membersLoading) void loadMembers();
  if (isAvoids && !avoidsLoaded && !avoidsLoading) void loadAvoids();
  if (isTickets && !ticketsLoaded && !ticketsLoading) void loadTickets(1);
  else if (isTickets && selectedPersonSummary) {
    if (selectedTicketSummary && !document.getElementById('ticket-detail-view').hidden) {
      void openTicket(selectedTicketSummary);
    } else {
      void loadPersonTickets(selectedPersonSummary);
    }
  }
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
    updateAvoidMemberOptions();
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
  updateAvoidMemberOptions();
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
  document.getElementById('add-avoid-pairing').disabled = true;
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
    updateAvoidMemberOptions();
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
    document.getElementById('add-avoid-pairing').disabled =
      !membersLoaded || !memberRecords.some((member) => member.username);
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
  const groupedByAvoider = new Map();
  for (const pair of avoidRecords) {
    let group = groupedByAvoider.get(pair.avoiderDiscordId);
    if (!group) {
      group = {
        avoiderDiscordId: pair.avoiderDiscordId,
        avoiderNickname: pair.avoiderNickname || '',
        avoiderUsername: pair.avoiderUsername || '',
        avoiderName: pair.avoiderName,
        avoidedMembers: []
      };
      groupedByAvoider.set(pair.avoiderDiscordId, group);
    }
    group.avoidedMembers.push({
      discordId: pair.avoidedDiscordId,
      nickname: pair.avoidedNickname || '',
      username: pair.avoidedUsername || '',
      name: pair.avoidedName
    });
  }
  const avoiders = [...groupedByAvoider.values()];
  const matches = avoiders.filter((group) => [
    group.avoiderName,
    group.avoiderNickname,
    group.avoiderUsername,
    group.avoiderDiscordId,
    ...group.avoidedMembers.flatMap((member) => [
      member.nickname,
      member.username,
      member.name,
      member.discordId
    ])
  ].join(' ').toLowerCase().includes(query));
  list.replaceChildren();

  for (const group of matches) {
    const row = document.createElement('article');
    row.className = 'avoid-row';
    row.setAttribute('role', 'listitem');
    const avoider = document.createElement('div');
    avoider.className = 'avoid-player';
    const avoiderLabel = document.createElement('span');
    avoiderLabel.className = 'avoid-player-label';
    avoiderLabel.textContent = 'Avoider';
    const avoiderName = document.createElement('strong');
    avoiderName.textContent = group.avoiderNickname || group.avoiderUsername || 'No nickname set';
    const avoiderUsername = document.createElement('small');
    avoiderUsername.textContent = group.avoiderUsername ? `@${group.avoiderUsername}` : 'No username listed';
    const avoiderId = document.createElement('small');
    avoiderId.textContent = group.avoiderDiscordId || '';
    avoider.append(avoiderLabel, avoiderName, avoiderUsername, avoiderId);

    const avoided = document.createElement('section');
    avoided.className = 'avoid-targets';
    const avoidedLabel = document.createElement('h4');
    avoidedLabel.className = 'avoid-player-label';
    avoidedLabel.textContent = 'Avoiding';
    const avoidedList = document.createElement('ul');
    avoidedList.className = 'avoid-target-list';
    for (const member of group.avoidedMembers) {
      const item = document.createElement('li');
      item.className = 'avoid-target-item';
      const name = document.createElement('strong');
      name.textContent = member.nickname || member.username || 'No nickname set';
      const username = document.createElement('small');
      username.textContent = member.username ? `@${member.username}` : 'No username listed';
      const discordId = document.createElement('small');
      discordId.textContent = member.discordId || '';
      item.append(name, username, discordId);
      avoidedList.append(item);
    }
    avoided.append(avoidedLabel, avoidedList);
    row.append(avoider, avoided);
    list.append(row);
  }

  state.hidden = matches.length > 0;
  if (avoiders.length === 0) state.textContent = 'No Avoid Pairings were found.';
  else if (matches.length === 0 && query) state.textContent = 'No Avoid Pairings match your search.';
  const pairCount = avoidRecords.length;
  document.getElementById('avoids-summary').textContent = query
    ? `Showing ${matches.length} of ${avoiders.length} avoider(s) (${pairCount} pairing(s)).`
    : `${avoiders.length} avoider${avoiders.length === 1 ? '' : 's'}, ${pairCount} pairing${pairCount === 1 ? '' : 's'}.`;
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
    if (avoidsResyncPending) {
      avoidsResyncPending = false;
      void loadAvoids();
    }
  }
}

function resyncAvoids() {
  avoidsLoaded = false;
  if (avoidsLoading) {
    avoidsResyncPending = true;
    return;
  }
  if (document.querySelector('.nav-item.active')?.dataset.tab === 'avoids') {
    void loadAvoids();
  }
}

function ticketFiltersAreActive() {
  return Boolean(
    document.getElementById('ticket-search').value.trim() ||
    document.getElementById('ticket-from').value ||
    document.getElementById('ticket-to').value
  );
}

function renderTicketPeople() {
  const list = document.getElementById('tickets-list');
  const state = document.getElementById('tickets-state');
  list.replaceChildren();

  for (const person of ticketPeople) {
    const row = document.createElement('article');
    row.className = 'ticket-row';
    row.setAttribute('role', 'listitem');
    const openButton = document.createElement('button');
    openButton.className = 'ticket-open-button';
    openButton.type = 'button';
    openButton.addEventListener('click', () => { void selectTicketPerson(person); });

    const identity = document.createElement('div');
    identity.className = 'ticket-identity';
    const title = document.createElement('strong');
    title.textContent = person.username || person.userID || 'Unknown player';
    const user = document.createElement('span');
    user.textContent = `${person.userID || 'Discord ID unavailable'} · ${person.ticketCount} ticket${person.ticketCount === 1 ? '' : 's'}`;
    identity.append(title, user);

    const details = document.createElement('div');
    details.className = 'ticket-row-details';
    const latest = document.createElement('span');
    latest.textContent = `Latest: ${person.latestCreatedAt || 'Date unavailable'}`;
    const counts = document.createElement('span');
    counts.textContent = `${person.openTicketCount} open · ${person.closedTicketCount} closed`;
    details.append(latest, counts);
    openButton.append(identity, details);
    row.append(openButton);
    list.append(row);
  }

  const totalPages = Math.max(1, Math.ceil(ticketTotal / ticketPageSize));
  document.getElementById('tickets-page-label').textContent = `Page ${ticketPage} of ${totalPages}`;
  document.getElementById('tickets-previous').disabled = ticketsLoading || ticketPage <= 1;
  document.getElementById('tickets-next').disabled = ticketsLoading || ticketPage >= totalPages;
  document.getElementById('refresh-tickets').disabled = ticketsLoading;
  state.hidden = ticketPeople.length > 0 && !ticketsLoading && !ticketLoadError;
  const hasFilters = ticketFiltersAreActive();
  if (ticketsLoading) state.textContent = 'Loading ticket history…';
  else if (ticketLoadError) state.textContent = ticketLoadError;
  else if (ticketCollectionCount === 0) state.textContent = 'No ticket archive collections were found.';
  else if (ticketTotal === 0 && hasFilters) state.textContent = 'No people match your search and date filters.';
  else if (ticketTotal === 0) state.textContent = 'No people with ticket history were found.';
  else if (ticketPeople.length === 0) state.textContent = 'There are no people on this page.';

  const start = ticketTotal ? (ticketPage - 1) * ticketPageSize + 1 : 0;
  const end = Math.min(start + ticketPeople.length - 1, ticketTotal);
  document.getElementById('tickets-summary').textContent = ticketsLoading
    ? 'Loading people with ticket history…'
    : ticketLoadError
      ? 'Ticket history could not be loaded.'
      : ticketTotal
        ? `Showing ${start}–${end} of ${ticketTotal} player${ticketTotal === 1 ? '' : 's'}.`
        : ticketCollectionCount !== null
          ? hasFilters
            ? `No matches across ${ticketCollectionCount} ticket archive(s).`
            : `0 players across ${ticketCollectionCount} ticket archive(s).`
          : '0 players found.';
}

async function loadTickets(page = ticketPage) {
  const generation = ++ticketLoadGeneration;
  ticketsLoading = true;
  ticketLoadError = '';
  ticketPage = page;
  const state = document.getElementById('tickets-state');
  state.hidden = ticketPeople.length > 0;
  state.textContent = 'Loading ticket history…';
  document.getElementById('tickets-summary').textContent = 'Loading people with ticket history…';
  renderTicketPeople();
  try {
    const result = await window.hoedown.getTicketPeople({
      search: document.getElementById('ticket-search').value.trim(),
      from: document.getElementById('ticket-from').value,
      to: document.getElementById('ticket-to').value,
      page: String(page)
    });
    if (generation !== ticketLoadGeneration) return;
    if (!result.ok) throw new Error(result.error || 'Could not load ticket history.');
    ticketPeople = result.people;
    ticketTotal = result.total;
    ticketCollectionCount = Number.isSafeInteger(result.collectionCount)
      ? result.collectionCount
      : null;
    ticketPage = result.page;
    ticketPageSize = result.pageSize;
    ticketsLoaded = true;
    ticketLoadError = '';
    renderTicketPeople();
  } catch (error) {
    if (generation !== ticketLoadGeneration) return;
    ticketsLoaded = false;
    ticketLoadError = error.message || 'Could not load ticket history.';
  } finally {
    if (generation === ticketLoadGeneration) {
      ticketsLoading = false;
      renderTicketPeople();
    }
  }
}

function createTicketRow(ticket) {
  const row = document.createElement('article');
  row.className = 'ticket-row';
  row.setAttribute('role', 'listitem');
  const openButton = document.createElement('button');
  openButton.className = 'ticket-open-button';
  openButton.type = 'button';
  openButton.addEventListener('click', () => { void openTicket(ticket); });

  const identity = document.createElement('div');
  identity.className = 'ticket-identity';
  const title = document.createElement('strong');
  title.textContent = ticket.ticketID || 'Untitled ticket';
  const created = document.createElement('span');
  created.textContent = ticket.createdAt || 'Date unavailable';
  identity.append(title, created);

  const details = document.createElement('div');
  details.className = 'ticket-row-details';
  const staff = document.createElement('span');
  staff.textContent = `${ticket.staffIDs.length} staff member${ticket.staffIDs.length === 1 ? '' : 's'}`;
  const status = document.createElement('span');
  status.className = 'ticket-status';
  status.textContent = ticket.status || 'Unknown status';
  details.append(staff, status);
  openButton.append(identity, details);
  row.append(openButton);
  return row;
}

function renderPersonTickets() {
  const openList = document.getElementById('open-person-tickets');
  const closedList = document.getElementById('closed-person-tickets');
  const openState = document.getElementById('open-person-tickets-state');
  const closedState = document.getElementById('closed-person-tickets-state');
  openList.replaceChildren();
  closedList.replaceChildren();

  const openTickets = personTicketRecords.filter((ticket) =>
    typeof ticket.status === 'string' && ticket.status.toLocaleLowerCase('en') === 'open'
  );
  const closedTickets = personTicketRecords.filter((ticket) =>
    !ticket.status || ticket.status.toLocaleLowerCase('en') !== 'open'
  );
  for (const ticket of openTickets) openList.append(createTicketRow(ticket));
  for (const ticket of closedTickets) closedList.append(createTicketRow(ticket));

  document.getElementById('ticket-person-name').textContent =
    selectedPersonSummary?.username || selectedPersonSummary?.userID || 'Ticket history';
  document.getElementById('ticket-person-summary').textContent = selectedPersonSummary
    ? `${selectedPersonSummary.userID || 'Discord ID unavailable'} · ${personTicketRecords.length} ticket${personTicketRecords.length === 1 ? '' : 's'} · ${selectedPersonSummary.openTicketCount} open · ${selectedPersonSummary.closedTicketCount} closed`
    : '';
  document.getElementById('refresh-person-tickets').disabled = personTicketsLoading;

  for (const [state, records, label] of [
    [openState, openTickets, 'open tickets'],
    [closedState, closedTickets, 'closed tickets']
  ]) {
    state.hidden = records.length > 0 && !personTicketsLoading && !personTicketsError;
    if (personTicketsLoading) state.textContent = 'Loading ticket history…';
    else if (personTicketsError) state.textContent = personTicketsError;
    else state.textContent = `No ${label}.`;
  }
}

async function selectTicketPerson(person) {
  selectedPersonSummary = person;
  selectedTicketSummary = null;
  personTicketRecords = [];
  personTicketsError = '';
  personTicketsLoading = false;
  document.getElementById('ticket-list-view').hidden = true;
  document.getElementById('person-tickets-view').hidden = false;
  document.getElementById('ticket-detail-view').hidden = true;
  await loadPersonTickets(person, { preserve: false });
}

async function loadPersonTickets(person, { preserve = true } = {}) {
  if (!person) return;
  selectedPersonSummary = person;
  const generation = ++personTicketLoadGeneration;
  personTicketsLoading = true;
  personTicketsError = '';
  if (!preserve) personTicketRecords = [];
  renderPersonTickets();
  try {
    const result = await window.hoedown.getTicketsForPerson(person.personId);
    if (generation !== personTicketLoadGeneration) return;
    if (!result.ok) throw new Error(result.error || 'Could not load this ticket history.');
    personTicketRecords = result.tickets;
    const openCount = personTicketRecords.filter((ticket) =>
      ticket.status?.toLocaleLowerCase('en') === 'open'
    ).length;
    selectedPersonSummary = {
      ...selectedPersonSummary,
      ...result.person,
      ticketCount: result.total,
      openTicketCount: openCount,
      closedTicketCount: result.total - openCount
    };
    if (selectedTicketSummary) {
      selectedTicketSummary = personTicketRecords.find((ticket) =>
        ticket.collectionName === selectedTicketSummary.collectionName &&
        ticket.ticketId === selectedTicketSummary.ticketId
      ) || selectedTicketSummary;
    }
  } catch (error) {
    if (generation !== personTicketLoadGeneration) return;
    personTicketsError = error.message || 'Could not load this ticket history.';
  } finally {
    if (generation === personTicketLoadGeneration) {
      personTicketsLoading = false;
      renderPersonTickets();
    }
  }
}

function resyncTickets() {
  if (signedInPanel.hidden) return;
  if (ticketResyncTimer) clearTimeout(ticketResyncTimer);
  ticketResyncTimer = setTimeout(() => {
    ticketResyncTimer = null;
    ticketsLoaded = false;
    void loadTickets(ticketPage);
    if (!selectedPersonSummary) return;

    void loadPersonTickets(selectedPersonSummary, { preserve: true });
    const ticketsView = document.getElementById('tickets-view');
    const detailView = document.getElementById('ticket-detail-view');
    if (!ticketsView.hidden && !detailView.hidden && selectedTicketSummary) {
      void openTicket(selectedTicketSummary);
    }
  }, 200);
}

function resyncTicketMessage(update) {
  const collectionName = update?.collectionName;
  if (signedInPanel.hidden || typeof collectionName !== 'string' ||
      !selectedPersonSummary?.collectionNames?.includes(collectionName) ||
      ticketMessageResyncTimer) return;

  const wait = Math.max(0, 1500 - (Date.now() - lastTicketMessageRefresh));
  ticketMessageResyncTimer = setTimeout(() => {
    ticketMessageResyncTimer = null;
    lastTicketMessageRefresh = Date.now();
    if (!selectedPersonSummary?.collectionNames?.includes(collectionName)) return;

    void loadPersonTickets(selectedPersonSummary, { preserve: true });
    const ticketsView = document.getElementById('tickets-view');
    const detailView = document.getElementById('ticket-detail-view');
    if (!ticketsView.hidden && !detailView.hidden &&
        selectedTicketSummary?.collectionName === collectionName) {
      void openTicket(selectedTicketSummary);
    }
  }, wait);
}

function showTicketPeople() {
  ticketDetailGeneration += 1;
  personTicketLoadGeneration += 1;
  selectedPersonSummary = null;
  selectedTicketSummary = null;
  document.getElementById('ticket-detail-view').hidden = true;
  document.getElementById('person-tickets-view').hidden = true;
  document.getElementById('ticket-list-view').hidden = false;
}

function showPersonTickets() {
  ticketDetailGeneration += 1;
  selectedTicketSummary = null;
  document.getElementById('ticket-detail-view').hidden = true;
  document.getElementById('ticket-list-view').hidden = true;
  document.getElementById('person-tickets-view').hidden = false;
}

async function openTicket(ticketSummary) {
  selectedTicketSummary = ticketSummary;
  const generation = ++ticketDetailGeneration;
  const detailView = document.getElementById('ticket-detail-view');
  const content = document.getElementById('ticket-detail-content');
  const state = document.getElementById('ticket-detail-state');
  document.getElementById('ticket-list-view').hidden = true;
  document.getElementById('person-tickets-view').hidden = true;
  detailView.hidden = false;
  content.replaceChildren();
  state.hidden = false;
  state.textContent = 'Loading ticket transcript…';

  try {
    const result = await window.hoedown.getTicket(
      ticketSummary.collectionName,
      ticketSummary.ticketId
    );
    if (generation !== ticketDetailGeneration) return;
    if (!result.ok) throw new Error(result.error || 'Could not load the ticket transcript.');
    const ticket = result.ticket;
    state.hidden = true;

    const heading = document.createElement('h2');
    heading.className = 'ticket-detail-title';
    heading.textContent = ticket.ticketID || 'Ticket transcript';
    const summary = document.createElement('p');
    summary.className = 'ticket-detail-summary muted';
    summary.textContent = `${ticket.username || 'Unknown player'}${ticket.userID ? ` · ${ticket.userID}` : ''}`;

    const metadata = document.createElement('dl');
    metadata.className = 'ticket-metadata';
    for (const [label, value] of [
      ['Status', ticket.status || 'Unknown'],
      ['Created', ticket.createdAt || 'Unknown'],
      ['Closed', ticket.closedAt || (ticket.status === 'Open' ? 'Not closed' : 'Unknown')]
    ]) {
      const entry = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      entry.append(term, description);
      metadata.append(entry);
    }

    const staffHeading = document.createElement('h3');
    staffHeading.className = 'ticket-section-title';
    staffHeading.textContent = 'Staff involved';
    const staffList = document.createElement('ul');
    staffList.className = 'ticket-staff-list';
    if (ticket.staffIDs.length) {
      for (const staffId of ticket.staffIDs) {
        const item = document.createElement('li');
        item.textContent = staffId;
        staffList.append(item);
      }
    } else {
      const item = document.createElement('li');
      item.textContent = 'No staff members recorded.';
      staffList.append(item);
    }

    const transcriptHeading = document.createElement('h3');
    transcriptHeading.className = 'ticket-section-title';
    transcriptHeading.textContent = `Transcript (${ticket.messages.length} messages)`;
    const transcript = document.createElement('ol');
    transcript.className = 'ticket-transcript';
    transcript.setAttribute('aria-label', 'Ticket messages');
    for (const message of ticket.messages) {
      const item = document.createElement('li');
      item.className = 'ticket-message';
      const messageHeader = document.createElement('header');
      const author = document.createElement('strong');
      author.textContent = message.authorName || message.authorID || 'Unknown author';
      const timestamp = document.createElement('time');
      timestamp.textContent = message.timestamp || 'Time unavailable';
      messageHeader.append(author, timestamp);
      const authorId = document.createElement('small');
      authorId.textContent = message.authorID || '';
      const body = document.createElement('p');
      body.className = 'ticket-message-content';
      body.textContent = message.content || '[No message content]';
      item.append(messageHeader, authorId, body);
      transcript.append(item);
    }
    content.append(heading, summary, metadata, staffHeading, staffList, transcriptHeading, transcript);
  } catch (error) {
    if (generation !== ticketDetailGeneration) return;
    state.hidden = false;
    state.textContent = error.message || 'Could not load the ticket transcript.';
  }
}

function memberPickerLabel(member) {
  const name = member.nickname || member.username || member.discordId || 'Unknown member';
  const account = member.username ? `@${member.username}` : member.discordId;
  return `${name} — ${account}`;
}

function updateAvoidMemberOptions() {
  const datalist = document.getElementById('avoid-member-options');
  if (!datalist) return;
  const options = memberRecords
    .filter((member) => member.username)
    .map((member) => {
      const option = document.createElement('option');
      option.value = memberPickerLabel(member);
      return option;
    });
  datalist.replaceChildren(...options);
    const addButton = document.getElementById('add-avoid-pairing');
    if (addButton) addButton.disabled = !membersLoaded || options.length === 0;
}

function createAvoidTargetField(index) {
  const row = document.createElement('div');
  row.className = 'avoid-target-row';
  const label = document.createElement('label');
  label.className = 'avoid-target-label';
  label.htmlFor = `avoid-target-${index}`;
  label.textContent = 'Avoiding';
  const inputRow = document.createElement('div');
  inputRow.className = 'avoid-target-input-row';
  if (index === 0) inputRow.classList.add('single');
  const input = document.createElement('input');
  input.id = `avoid-target-${index}`;
  input.className = 'avoid-member-input';
  input.type = 'text';
  input.setAttribute('list', 'avoid-member-options');
  input.placeholder = 'Search Members…';
  input.autocomplete = 'off';
  input.addEventListener('input', () => setAvoidsFeedback(''));

  if (index > 0) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'secondary avoid-target-remove';
    action.textContent = '−';
    action.setAttribute('aria-label', 'Remove this Avoiding member');
    action.title = 'Remove this Avoiding member';
    action.addEventListener('click', () => row.remove());
    inputRow.append(input, action);
  } else {
    inputRow.append(input);
  }
  row.append(label, inputRow);
  return row;
}

function addAvoidTargetField() {
  const index = avoidTargetFieldId++;
  document.getElementById('avoid-target-fields').append(createAvoidTargetField(index));
}

function resetAvoidPairingForm() {
  const form = document.getElementById('avoid-pairing-form');
  if (!form) return;
  form.hidden = true;
  document.getElementById('avoid-avoider').value = '';
  document.getElementById('avoid-target-fields').replaceChildren();
  avoidTargetFieldId = 0;
  addAvoidTargetField();
  setAvoidsFeedback('');
}

function resolveMemberPicker(value) {
  const normalizedValue = value.trim();
  return memberRecords.find((member) => memberPickerLabel(member) === normalizedValue);
}

document.getElementById('add-avoid-pairing').addEventListener('click', () => {
  if (!membersLoaded || !memberRecords.some((member) => member.username)) {
    setAvoidsFeedback('Load registered Members before creating an Avoid Pairing.', true);
    return;
  }
  resetAvoidPairingForm();
  document.getElementById('avoid-pairing-form').hidden = false;
  document.getElementById('avoid-avoider').focus();
});

document.getElementById('cancel-avoid-pairing').addEventListener('click', resetAvoidPairingForm);
document.getElementById('add-avoid-target').addEventListener('click', addAvoidTargetField);
document.getElementById('avoid-avoider').addEventListener('input', () => setAvoidsFeedback(''));
document.getElementById('avoid-pairing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const avoider = resolveMemberPicker(document.getElementById('avoid-avoider').value);
  const targetInputs = [...document.querySelectorAll('#avoid-target-fields .avoid-member-input')];
  const targets = targetInputs.map((input) => resolveMemberPicker(input.value));
  if (!avoider || targets.some((member) => !member)) {
    setAvoidsFeedback('Choose each member from the search suggestions.', true);
    return;
  }
  const targetIds = targets.map((member) => member.discordId);
  if (targetIds.includes(avoider.discordId)) {
    setAvoidsFeedback('The Avoider cannot also be selected as an Avoiding member.', true);
    return;
  }
  if (new Set(targetIds).size !== targetIds.length) {
    setAvoidsFeedback('Each Avoiding member can be selected only once.', true);
    return;
  }

  const saveButton = document.getElementById('save-avoid-pairing');
  saveButton.disabled = true;
  setAvoidsFeedback('Saving Avoid Pairing…');
  try {
    const result = await window.hoedown.createAvoids({
      avoiderDiscordId: avoider.discordId,
      avoidedDiscordIds: targetIds
    });
    if (!result.ok) throw new Error(result.error || 'Could not save the Avoid Pairing.');
    resetAvoidPairingForm();
    const { addedPairs, skippedPairs } = result.googleSheets;
    setAvoidsFeedback(
      `Saved to MongoDB. Google Sheets added ${addedPairs} and skipped ${skippedPairs} existing pairing(s).`
    );
    avoidsLoaded = false;
    await loadAvoids();
  } catch (error) {
    setAvoidsFeedback(error.message || 'Could not save the Avoid Pairing.', true);
  } finally {
    saveButton.disabled = false;
  }
});

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
document.getElementById('ticket-filters').addEventListener('submit', (event) => {
  event.preventDefault();
  ticketsLoaded = false;
  showTicketPeople();
  void loadTickets(1);
});
document.getElementById('refresh-tickets').addEventListener('click', () => {
  ticketsLoaded = false;
  showTicketPeople();
  void loadTickets(ticketPage);
});
document.getElementById('tickets-previous').addEventListener('click', () => {
  if (ticketPage > 1) {
    showTicketPeople();
    void loadTickets(ticketPage - 1);
  }
});
document.getElementById('tickets-next').addEventListener('click', () => {
  const lastPage = Math.max(1, Math.ceil(ticketTotal / ticketPageSize));
  if (ticketPage < lastPage) {
    showTicketPeople();
    void loadTickets(ticketPage + 1);
  }
});
document.getElementById('refresh-person-tickets').addEventListener('click', () => {
  if (selectedPersonSummary) void loadPersonTickets(selectedPersonSummary);
});
document.getElementById('back-to-people').addEventListener('click', showTicketPeople);
document.getElementById('back-to-tickets').addEventListener('click', showPersonTickets);

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
window.hoedown.onAvoidsResync(resyncAvoids);
window.hoedown.onTicketsResync(resyncTickets);
window.hoedown.onTicketMessage(resyncTicketMessage);
window.hoedown.onMembersLiveStatus((liveStatus) => {
  setLiveUpdatesStatus(liveStatus);
});
window.hoedown.onStatus(applyAuthState);
window.hoedown.getStatus()
  .then(applyAuthState)
  .catch((error) => applyAuthState({ signedIn: false, error: error.message }));
