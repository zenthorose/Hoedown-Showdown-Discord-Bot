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

const pages = {
  members: {
    title: 'Members',
    icon: '👥',
    description: 'Member tools and player information will live here.'
  },
  avoids: {
    title: 'Avoids',
    icon: '🚫',
    description: 'Review and manage player avoid pairings here.'
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
  { name: 'nickname', label: 'Nickname', maxLength: 100 },
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
  document.getElementById('members-list').replaceChildren();
  document.getElementById('members-summary').textContent = 'Sign in to load member records.';
  document.getElementById('members-state').textContent = 'Member records are not loaded.';
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
  document.getElementById('members-view').hidden = !isMembers;
  document.getElementById('page-card').hidden = isMembers;
  selfPasswordForm.hidden = true;
  showStatus('');
  if (isMembers && !membersLoaded && !membersLoading) void loadMembers();
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

function editMemberRow(row, member) {
  row.classList.add('editing');
  for (const field of editableMemberFields) {
    const value = row.querySelector(`[data-member-field="${field.name}"]`);
    const input = document.createElement('input');
    input.className = 'member-edit-input';
    input.dataset.memberField = field.name;
    input.type = field.type || 'text';
    input.name = field.name;
    input.maxLength = field.maxLength;
    input.required = field.required === true;
    input.value = member[field.name] || '';
    input.setAttribute('aria-label', field.label);
    value.replaceWith(input);
  }
  row.querySelector('.member-edit-button').hidden = true;
  row.querySelector('.member-save-button').hidden = false;
  row.querySelector('.member-cancel-button').hidden = false;
  row.querySelector('.member-edit-error').hidden = true;
  row.querySelector('.member-edit-input').focus();
}

async function saveMemberRow(row, member) {
  const saveButton = row.querySelector('.member-save-button');
  const errorMessage = row.querySelector('.member-edit-error');
  const fields = {};
  for (const field of editableMemberFields) {
    fields[field.name] = row.querySelector(`[data-member-field="${field.name}"]`).value;
  }

  saveButton.disabled = true;
  errorMessage.hidden = true;
  try {
    const result = await window.hoedown.updateMember(member.discordId, fields);
    if (!result.ok) throw new Error(result.error || 'Could not save member changes.');
    const memberIndex = memberRecords.findIndex((entry) => entry.discordId === member.discordId);
    if (memberIndex === -1) throw new Error('The saved member is no longer in the list. Refresh and try again.');
    memberRecords[memberIndex] = result.member;
    renderMembers();
  } catch (error) {
    errorMessage.textContent = error.message || 'Could not save member changes.';
    errorMessage.hidden = false;
    saveButton.disabled = false;
  }
}

function renderMembers() {
  const list = document.getElementById('members-list');
  const state = document.getElementById('members-state');
  const query = document.getElementById('member-search').value.trim().toLowerCase();
  const scrollTop = list.scrollTop;
  list.replaceChildren();

  for (const member of memberRecords) {
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
    details.append(
      createMemberDetail('discordId', 'Discord ID', discordId),
      createMemberDetail('region', 'Region', region),
      createMemberDetail('steamId', 'Steam ID', steamId),
      createMemberDetail('streamLink', 'Stream link', streamLink),
      createMemberDetail('nickname', 'Nickname', nickname)
    );
    const actions = document.createElement('div');
    actions.className = 'member-actions';
    actions.append(
      createMemberAction('Edit', 'member-edit-button', () => editMemberRow(row, member)),
      createMemberAction('Save', 'member-save-button', () => { void saveMemberRow(row, member); }),
      createMemberAction('Cancel', 'member-cancel-button secondary', renderMembers)
    );
    actions.querySelector('.member-save-button').hidden = true;
    actions.querySelector('.member-cancel-button').hidden = true;
    const editError = document.createElement('p');
    editError.className = 'member-edit-error';
    editError.setAttribute('role', 'alert');
    editError.hidden = true;
    row.append(identity, details, actions, editError);
    list.append(row);
  }
  list.scrollTop = scrollTop;

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

async function loadMembers() {
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
    memberRecords = result.members;
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
  }
}

document.getElementById('member-search').addEventListener('input', renderMembers);
document.getElementById('refresh-members').addEventListener('click', () => {
  membersLoaded = false;
  void loadMembers();
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

window.hoedown.onStatus(applyAuthState);
window.hoedown.getStatus()
  .then(applyAuthState)
  .catch((error) => applyAuthState({ signedIn: false, error: error.message }));
