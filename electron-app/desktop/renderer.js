const loginForm = document.getElementById('login-form');
const passwordForm = document.getElementById('password-form');
const signedInPanel = document.getElementById('signed-in');
const status = document.getElementById('status');
const connection = document.getElementById('connection');
const profilePicker = document.getElementById('profile-picker');
const profileList = document.getElementById('profile-list');
const profileEmpty = document.getElementById('profile-empty');
const selfPasswordForm = document.getElementById('self-password-form');
const updateBox = document.getElementById('update-box');
let resetToken = null;
let profilePendingDeletion = null;
let localRoundActionPending = false;
let roundStatusRequestPending = false;
let roundActionState = {
  running: false,
  lastClickedBy: null,
  lastClickedAt: null,
  lastOutcome: 'none'
};
let currentRoundDraft = null;
let roundPreviewOpen = false;
let roundPreviewRequestGeneration = 0;
let roundDraftPresenceGenerationId = '';
let roundDraftPresenceRequest = null;
let roundDraftPresencePending = false;
let roundDraftActionPending = false;
let roundDraftViewGeneration = 0;
let draggedRoundPlayerId = '';
let selectedRoundPlayerId = '';
let selectedRoundFillerSlot = null;
let draggedRoundSlot = null;
let memberRecords = [];
let membersLoaded = false;
let membersLoading = false;
let memberResyncPending = false;
let avoidRecords = [];
let avoidsLoaded = false;
let avoidsLoading = false;
let avoidsResyncPending = false;
let avoidTargetFieldId = 0;
const editingAvoiderIds = new Set();
const pendingAvoidRemovals = new Set();
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
let ticketActionInProgress = false;
let settingsLoaded = false;
let settingsLoading = false;
let settingsBusy = false;
let settingsGeneration = 0;
let ticketCloseConfirmationResolver = null;
let memberReplyConfirmationResolver = null;
let memberReplyConfirmationPromise = null;
const memberEdits = new Map();
const memberChangeVersions = new Map();
const DEFAULT_THEME_COLORS = {
  background: '#101413',
  surface: '#171d19',
  accent: '#a8863b',
  accentText: '#f0d58f',
  text: '#f2f5ef',
  muted: '#a5aea6',
  border: '#536044'
};
const THEME_COLOR_VARIABLES = {
  background: '--theme-background',
  surface: '--theme-surface',
  accent: '--theme-accent',
  accentText: '--theme-accent-text',
  text: '--theme-text',
  muted: '--theme-muted',
  border: '--theme-border'
};

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
  },
  settings: {
    title: 'Settings',
    icon: '⚙️',
    description: 'Customize your app appearance and preferences.'
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

function normalizeThemeColors(colors = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_THEME_COLORS).map(([key, fallback]) => {
    const value = colors && colors[key];
    return [key, typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : fallback];
  }));
}

function applyThemeColors(colors) {
  const themeColors = normalizeThemeColors(colors);
  for (const [key, variable] of Object.entries(THEME_COLOR_VARIABLES)) {
    document.documentElement.style.setProperty(variable, themeColors[key]);
  }
  document.querySelectorAll('[data-theme-color]').forEach((input) => {
    if (Object.hasOwn(themeColors, input.dataset.themeColor)) {
      input.value = themeColors[input.dataset.themeColor];
    }
  });
  return themeColors;
}

function readThemeColorsFromInputs() {
  return Object.fromEntries([...document.querySelectorAll('[data-theme-color]')].map((input) => [
    input.dataset.themeColor,
    input.value
  ]));
}

function setSettingsFeedback(message, isError = false) {
  const feedback = document.getElementById('settings-feedback');
  feedback.textContent = message || '';
  feedback.dataset.error = String(isError);
}

function setSettingsControlsDisabled(disabled) {
  document.querySelectorAll('[data-theme-color]').forEach((input) => { input.disabled = disabled; });
  document.getElementById('save-theme-colors').disabled = disabled;
  document.getElementById('reset-theme-colors').disabled = disabled;
}

async function loadSettings() {
  if (settingsLoaded || settingsLoading || signedInPanel.hidden) return;
  settingsLoading = true;
  const generation = settingsGeneration;
  setSettingsControlsDisabled(true);
  setSettingsFeedback('Loading your settings…');
  try {
    const result = await window.hoedown.getSettings();
    if (generation !== settingsGeneration || signedInPanel.hidden) return;
    if (!result.ok) throw new Error(result.error || 'Could not load your settings.');
    applyThemeColors(result.themeColors);
    settingsLoaded = true;
    setSettingsFeedback('');
  } catch (error) {
    if (generation === settingsGeneration) {
      setSettingsFeedback(error.message || 'Could not load your settings.', true);
    }
  } finally {
    if (generation === settingsGeneration) {
      settingsLoading = false;
      setSettingsControlsDisabled(false);
    }
  }
}

async function saveThemeColors() {
  if (settingsBusy || signedInPanel.hidden) return;
  settingsBusy = true;
  const generation = settingsGeneration;
  const colors = readThemeColorsFromInputs();
  setSettingsControlsDisabled(true);
  setSettingsFeedback('Saving your colors…');
  try {
    const result = await window.hoedown.saveThemeColors(colors);
    if (generation !== settingsGeneration || signedInPanel.hidden) return;
    if (!result.ok) throw new Error(result.error || 'Could not save your colors.');
    applyThemeColors(result.themeColors);
    settingsLoaded = true;
    setSettingsFeedback('Colors saved to your account.');
  } catch (error) {
    if (generation === settingsGeneration) {
      setSettingsFeedback(error.message || 'Could not save your colors.', true);
    }
  } finally {
    if (generation === settingsGeneration) {
      settingsBusy = false;
      setSettingsControlsDisabled(false);
    }
  }
}

async function resetThemeColors() {
  if (settingsBusy || signedInPanel.hidden) return;
  settingsBusy = true;
  const generation = settingsGeneration;
  setSettingsControlsDisabled(true);
  setSettingsFeedback('Resetting your colors…');
  try {
    const result = await window.hoedown.resetThemeColors();
    if (generation !== settingsGeneration || signedInPanel.hidden) return;
    if (!result.ok) throw new Error(result.error || 'Could not reset your colors.');
    applyThemeColors(DEFAULT_THEME_COLORS);
    settingsLoaded = true;
    setSettingsFeedback('Colors reset to defaults and saved to your account.');
  } catch (error) {
    if (generation === settingsGeneration) {
      setSettingsFeedback(error.message || 'Could not reset your colors.', true);
    }
  } finally {
    if (generation === settingsGeneration) {
      settingsBusy = false;
      setSettingsControlsDisabled(false);
    }
  }
}

function showSignedOut(profileSelected = true) {
  closeRoundDraftPreview();
  profilePicker.hidden = profileSelected;
  loginForm.hidden = !profileSelected;
  passwordForm.hidden = true;
  signedInPanel.hidden = true;
  roundPreviewOpen = false;
  currentRoundDraft = null;
  selectedRoundPlayerId = '';
  selectedRoundFillerSlot = null;
  draggedRoundSlot = null;
  roundDraftActionPending = false;
  roundDraftViewGeneration += 1;
  document.getElementById('open-round-preview').disabled = false;
  document.getElementById('round-preview-panel').hidden = true;
  document.getElementById('round-preview-teams').replaceChildren();
  applyRoundPreviewIndicator(null);
  renderRoundApprovalActivity(null);
  updateRoundDraftControls();
  renderRoundReviewers([]);
  document.getElementById('auth-header').hidden = false;
  document.getElementById('auth-title').textContent = profileSelected ? 'Sign in' : 'Select your profile';
  document.getElementById('back-to-profiles').hidden = !profileSelected;
  const profileName = document.getElementById('selected-profile-name');
  profileName.hidden = !profileSelected || !profileName.textContent;
  selfPasswordForm.hidden = true;
  connection.hidden = true;
  showStatus('');
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
  editingAvoiderIds.clear();
  pendingAvoidRemovals.clear();
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
  settingsGeneration += 1;
  settingsLoaded = false;
  settingsLoading = false;
  settingsBusy = false;
  applyThemeColors(DEFAULT_THEME_COLORS);
  setSettingsFeedback('');
  setSettingsControlsDisabled(false);
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
  document.getElementById('ticket-person-summary').textContent = '';
  document.getElementById('open-person-tickets').replaceChildren();
  document.getElementById('closed-person-tickets').replaceChildren();
  document.getElementById('ticket-detail-content').replaceChildren();
  document.getElementById('ticket-detail-view').hidden = true;
  resetToken = null;
}

function showProfileSelection(profiles = []) {
  const addButton = document.getElementById('add-profile');
  profileList.replaceChildren();
  for (const profile of profiles) {
    const card = document.createElement('article');
    card.className = 'profile-card';
    const button = document.createElement('button');
    button.className = 'profile-choice';
    button.type = 'button';
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const initials = (profile.username || '')
      .split(/[.\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    const avatarFallback = initials || '+';
    avatar.textContent = avatarFallback;
    if (typeof profile.avatarUrl === 'string' &&
        /^https:\/\/cdn\.discordapp\.com\//.test(profile.avatarUrl)) {
      const image = document.createElement('img');
      image.src = profile.avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        avatar.replaceChildren();
        avatar.textContent = avatarFallback;
      }, { once: true });
      avatar.replaceChildren(image);
    }
    const name = document.createElement('span');
    name.className = 'profile-choice-name';
    name.textContent = profile.username || 'New profile';
    const detail = document.createElement('span');
    detail.className = 'profile-choice-detail';
    detail.textContent = profile.username ? 'Saved sign-in' : 'Sign-in not completed';
    button.setAttribute('aria-label', `Select ${name.textContent}`);
    button.append(avatar, name, detail);
    button.addEventListener('click', async () => {
      profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = true; });
      document.getElementById('add-profile').disabled = true;
      showStatus('Checking saved profile…');
      try {
        applyAuthState(await window.hoedown.selectProfile(profile.id));
      } catch (error) {
        showStatus(error.message || 'Could not open this profile.');
        profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = false; });
        document.getElementById('add-profile').disabled = false;
      }
    });
    const menu = document.createElement('details');
    menu.className = 'profile-menu';
    const menuButton = document.createElement('summary');
    menuButton.textContent = '⋯';
    menuButton.setAttribute('aria-label', `Actions for ${name.textContent}`);
    const deleteButton = document.createElement('button');
    deleteButton.className = 'profile-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      menu.open = false;
      profilePendingDeletion = profile;
      document.getElementById('profile-delete-confirmation-message').textContent =
        `Delete ${profile.username || 'this profile'} from this device? Its saved profile and session will be removed. The account and service session will remain unchanged.`;
      document.getElementById('profile-delete-confirmation').showModal();
    });
    menu.append(menuButton, deleteButton);
    card.append(button, menu);
    profileList.append(card);
  }
  profileList.append(addButton);
  addButton.disabled = false;
  profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = false; });
  profileEmpty.hidden = profiles.length > 0;
}

function applyAuthState(state) {
  if (state && state.profileSelection) {
    showSignedOut(false);
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    showProfileSelection(Array.isArray(state.profiles) ? state.profiles : []);
    if (state.error) {
      connection.textContent = state.error;
      connection.hidden = false;
      showStatus(state.error);
    }
    return;
  }
  if (state && state.signedIn) {
    loginForm.hidden = true;
    profilePicker.hidden = true;
    passwordForm.hidden = true;
    signedInPanel.hidden = false;
    document.getElementById('auth-header').hidden = true;
    document.getElementById('account-name').textContent = state.username || 'Account';
    const accountAvatar = document.getElementById('account-avatar');
    if (typeof state.avatarUrl === 'string' && state.avatarUrl.length <= 512 &&
        /^https:\/\/cdn\.discordapp\.com\//.test(state.avatarUrl)) {
      accountAvatar.src = state.avatarUrl;
      accountAvatar.hidden = false;
      accountAvatar.onerror = () => {
        accountAvatar.hidden = true;
        accountAvatar.removeAttribute('src');
      };
    } else {
      accountAvatar.hidden = true;
      accountAvatar.removeAttribute('src');
      accountAvatar.onerror = null;
    }
    document.getElementById('welcome-name').textContent = state.username || 'partner';
    document.getElementById('app-footer').hidden = true;
    connection.hidden = true;
    showStatus('');
    if (!membersLoaded && !membersLoading) void loadMembers();
    if (!avoidsLoaded && !avoidsLoading) void loadAvoids();
    if (!ticketsLoaded && !ticketsLoading) void loadTickets(1);
    if (!settingsLoaded && !settingsLoading) void loadSettings();
    if (!document.getElementById('rounds-view').hidden) void refreshRoundDraftStatus();
  } else {
    showSignedOut();
    const profileName = document.getElementById('selected-profile-name');
    profileName.textContent = state?.profileName ? `Profile: ${state.profileName}` : '';
    profileName.hidden = !state?.profileSelected || !state?.profileName;
    if (state && state.error) {
      connection.textContent = state.error;
      connection.hidden = false;
    }
  }
}

function applyRoundActionState(state) {
  if (!state || typeof state.running !== 'boolean') return;
  roundActionState = state;
  const button = document.getElementById('grab-round-reactions');
  const indicator = document.getElementById('rounds-generation-indicator');
  const lastClicked = document.getElementById('rounds-last-clicked');
  const running = state.running || localRoundActionPending;
  button.disabled = running;
  indicator.classList.remove('loading', 'complete', 'pending');

  if (running) {
    indicator.classList.add('loading');
    indicator.textContent = '';
    indicator.setAttribute('aria-label', 'Round generation in progress');
  } else if (state.lastOutcome === 'success') {
    indicator.classList.add('complete');
    indicator.textContent = '✓';
    indicator.setAttribute('aria-label', 'Round generated');
  } else {
    indicator.classList.add('pending');
    indicator.textContent = '✕';
    indicator.setAttribute('aria-label', state.lastOutcome === 'failed'
      ? 'Last round generation failed'
      : 'Round not generated');
  }

  const actor = state.lastClickedBy;
  if (!actor) {
    lastClicked.textContent = state.running
      ? 'Generating now'
      : 'No one has clicked this action yet.';
    return;
  }

  const accountName = actor.username || 'Unknown account';
  const initials = accountName
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const avatarFallback = initials || '?';
  const avatar = document.createElement('span');
  avatar.className = 'rounds-last-clicked-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = avatarFallback;
  if (typeof actor.avatarUrl === 'string' && actor.avatarUrl.length <= 512 &&
      /^https:\/\/cdn\.discordapp\.com\//.test(actor.avatarUrl)) {
    const image = document.createElement('img');
    image.src = actor.avatarUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      avatar.replaceChildren();
      avatar.textContent = avatarFallback;
    }, { once: true });
    avatar.replaceChildren(image);
  }

  const label = document.createElement('span');
  label.textContent = state.running ? 'Generating now · Last clicked by' : 'Last clicked by';
  const name = document.createElement('span');
  name.className = 'rounds-last-clicked-name';
  name.textContent = accountName;
  lastClicked.replaceChildren(label, avatar, name);
}

async function refreshRoundActionStatus() {
  if (roundStatusRequestPending || signedInPanel.hidden) return;
  roundStatusRequestPending = true;
  try {
    const result = await window.hoedown.getRoundActionStatus();
    if (!result.ok) throw new Error(result.error || 'Could not load round action status.');
    applyRoundActionState(result.state);
  } catch (error) {
    document.getElementById('rounds-last-clicked').textContent =
      `Round activity status unavailable: ${error.message || 'Could not load status.'}`;
  } finally {
    roundStatusRequestPending = false;
  }
}

function applyRoundPreviewIndicator(draft) {
  const indicator = document.getElementById('round-preview-indicator');
  const finalChecks = draft?.checks?.final;
  const checksAvailable = Boolean(draft && finalChecks &&
    Array.isArray(finalChecks.avoidConflicts) &&
    Array.isArray(finalChecks.previousConflicts) &&
    Array.isArray(finalChecks.regionErrors));
  const hasConflicts = Boolean(checksAvailable && (
    finalChecks.avoidConflicts.length > 0 ||
    finalChecks.previousConflicts.length > 0 ||
    finalChecks.regionErrors.length > 0));
  const hasIssues = !draft || !checksAvailable || hasConflicts;
  const approvedWithConflicts = hasConflicts && draft.myVote === 'approve';
  indicator.classList.remove('loading', 'complete', 'pending', 'accepted-with-conflicts');
  indicator.classList.add(approvedWithConflicts
    ? 'accepted-with-conflicts'
    : hasIssues
      ? 'pending'
      : 'complete');
  indicator.textContent = approvedWithConflicts || !hasIssues ? '✓' : '✕';
  indicator.setAttribute('aria-label', !draft
    ? 'No pending team preview'
    : approvedWithConflicts
    ? 'Team preview marked Looks good with known conflicts'
    : hasIssues
      ? 'Team preview has issues'
      : 'Team preview has no issues');
}

function renderRoundReviewers(activity, emptyMessage = 'No one is viewing this draft yet.') {
  const reviewers = document.getElementById('round-reviewers');
  reviewers.replaceChildren();
  if (!activity?.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = emptyMessage;
    reviewers.append(empty);
    return;
  }
  for (const reviewer of activity) {
    const item = document.createElement('span');
    item.className = 'round-reviewer';
    const accountName = reviewer.username || reviewer.discordUsername || 'Unknown account';
    const initials = accountName
      .split(/[.\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    const avatar = document.createElement('span');
    avatar.className = 'rounds-last-clicked-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials || '?';
    if (typeof reviewer.avatarUrl === 'string' &&
        /^https:\/\/cdn\.discordapp\.com\//.test(reviewer.avatarUrl)) {
      const image = document.createElement('img');
      image.src = reviewer.avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        avatar.replaceChildren();
        avatar.textContent = initials || '?';
      }, { once: true });
      avatar.replaceChildren(image);
    }
    const name = document.createElement('span');
    name.className = 'rounds-last-clicked-name';
    name.textContent = accountName;
    item.append(avatar, name);
    reviewers.append(item);
  }
}

function renderRoundApprovalActivity(draft) {
  const indicator = document.getElementById('round-approval-indicator');
  const activity = document.getElementById('round-approval-activity');
  const approval = draft?.approvalActivity;
  const approvalStatus = draft?.status === 'approved'
    ? 'sent'
    : approval?.status || (draft?.status === 'approving' ? 'failed' : 'pending');
  indicator.classList.remove('loading', 'complete', 'pending');
  if (approvalStatus === 'sending') {
    indicator.classList.add('loading');
    indicator.textContent = '';
    indicator.setAttribute('aria-label', 'Round approval in progress');
  } else if (approvalStatus === 'sent') {
    indicator.classList.add('complete');
    indicator.textContent = '✓';
    indicator.setAttribute('aria-label', 'Round approved');
  } else {
    indicator.classList.add('pending');
    indicator.textContent = '✕';
    indicator.setAttribute('aria-label', approvalStatus === 'failed'
      ? 'Round approval incomplete'
      : 'Round not approved');
  }

  const actor = approval?.actor;
  if (!actor) {
    activity.textContent = draft?.status === 'approved'
      ? 'Round approved.'
      : approvalStatus === 'sending'
        ? 'Approving round…'
        : approvalStatus === 'failed'
          ? 'Approval incomplete. Retry to continue.'
          : 'No approval attempt yet.';
    return;
  }
  const accountName = actor.username || actor.discordUsername || 'Unknown account';
  const initials = accountName
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
  const avatar = document.createElement('span');
  avatar.className = 'rounds-last-clicked-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initials;
  if (typeof actor.avatarUrl === 'string' && actor.avatarUrl.length <= 512 &&
      /^https:\/\/cdn\.discordapp\.com\//.test(actor.avatarUrl)) {
    const image = document.createElement('img');
    image.src = actor.avatarUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      avatar.replaceChildren();
      avatar.textContent = initials;
    }, { once: true });
    avatar.replaceChildren(image);
  }
  const label = document.createElement('span');
  label.textContent = approvalStatus === 'sending'
    ? 'Approving now · requested by'
    : approvalStatus === 'sent'
      ? 'Approved by'
      : 'Approval incomplete · last tried by';
  const name = document.createElement('span');
  name.className = 'rounds-last-clicked-name';
  name.textContent = accountName;
  activity.replaceChildren(label, avatar, name);
}

function clearRoundDraftRelationshipHighlights() {
  document.querySelectorAll('.round-preview-player').forEach((player) => {
    player.classList.remove('avoid-highlight', 'previous-pairing-highlight');
  });
}

function highlightRoundDraftRelations(discordId) {
  clearRoundDraftRelationshipHighlights();
  const relations = currentRoundDraft?.pairingRelations || {};
  const avoidIds = new Set();
  const previousPairingIds = new Set();
  for (const pair of Array.isArray(relations.avoids) ? relations.avoids : []) {
    if (pair.discordIdA === discordId) avoidIds.add(pair.discordIdB);
    else if (pair.discordIdB === discordId) avoidIds.add(pair.discordIdA);
  }
  for (const pair of Array.isArray(relations.previousPairings) ? relations.previousPairings : []) {
    if (pair.discordIdA === discordId) previousPairingIds.add(pair.discordIdB);
    else if (pair.discordIdB === discordId) previousPairingIds.add(pair.discordIdA);
  }
  document.querySelectorAll('.round-preview-player[data-discord-id]').forEach((player) => {
    const playerId = player.dataset.discordId;
    player.classList.toggle('avoid-highlight', avoidIds.has(playerId));
    player.classList.toggle('previous-pairing-highlight', previousPairingIds.has(playerId));
  });
}

function updateRoundPlayerSelection() {
  document.querySelectorAll('button.round-preview-player').forEach((player) => {
    const pressed = player.dataset.discordId
      ? player.dataset.discordId === selectedRoundPlayerId
      : Boolean(selectedRoundFillerSlot &&
        player.dataset.team === selectedRoundFillerSlot.teamName &&
        player.dataset.slotIndex === String(selectedRoundFillerSlot.slotIndex));
    player.setAttribute('aria-pressed', String(pressed));
  });
  updateRoundDraftControls();
  renderRoundReplacementMembers();
}

function updateRoundDraftControls() {
  const addTeamButton = document.getElementById('round-add-filler-team');
  const replaceButton = document.getElementById('round-open-replacement');
  const replaceWithFillerButton = document.getElementById('round-replace-with-filler');
  const canEditDraft = currentRoundDraft?.status === 'pending';
  const canApproveDraft = ['pending', 'approving'].includes(currentRoundDraft?.status);
  const approveFinalButton = document.getElementById('round-approve-final');
  const approvalInProgress = currentRoundDraft?.status !== 'approved' &&
    currentRoundDraft?.approvalActivity?.status === 'sending';
  const selectedPlayerExists = Boolean(currentRoundDraft?.teams.some((team) =>
    team.players.some((player) => player.discordId === selectedRoundPlayerId)));
  const selectedFillerExists = Boolean(selectedRoundFillerSlot &&
    currentRoundDraft?.teams.some((team) => team.name === selectedRoundFillerSlot.teamName &&
      team.players[selectedRoundFillerSlot.slotIndex]?.region === 'Filler' &&
      !team.players[selectedRoundFillerSlot.slotIndex]?.discordId));
  if (addTeamButton) addTeamButton.disabled = !canEditDraft || roundDraftActionPending;
  if (replaceButton) {
    replaceButton.textContent = selectedFillerExists ? 'Fill selected slot' : 'Replace selected player';
    replaceButton.disabled = !canEditDraft ||
      (!selectedPlayerExists && !selectedFillerExists) || roundDraftActionPending;
  }
  if (replaceWithFillerButton) {
    replaceWithFillerButton.hidden = !selectedPlayerExists;
    replaceWithFillerButton.disabled = !canEditDraft || roundDraftActionPending;
  }
  document.querySelectorAll('button.round-preview-player').forEach((player) => {
    player.disabled = !canEditDraft || roundDraftActionPending;
    player.draggable = canEditDraft && !roundDraftActionPending;
  });
  document.querySelectorAll('.round-preview-delete-filler-team').forEach((button) => {
    button.disabled = !canEditDraft || roundDraftActionPending;
  });
  document.getElementById('round-review-approve').disabled = !canEditDraft || roundDraftActionPending;
  document.getElementById('round-review-changes').disabled = !canEditDraft || roundDraftActionPending;
  if (approveFinalButton) {
    approveFinalButton.disabled = !canApproveDraft || roundDraftActionPending || approvalInProgress;
    approveFinalButton.classList.toggle('is-loading', approvalInProgress);
    approveFinalButton.textContent = approvalInProgress
      ? 'Approving round…'
      : currentRoundDraft?.status === 'approved'
        ? 'Round approved'
        : currentRoundDraft?.status === 'approving'
          ? 'Retry round approval'
          : 'Approve round';
  }
  renderRoundApprovalActivity(currentRoundDraft);
  const search = document.getElementById('round-replacement-search');
  const closeButton = document.getElementById('round-close-replacement');
  if (search) search.disabled = !canEditDraft || roundDraftActionPending;
  if (closeButton) closeButton.disabled = roundDraftActionPending;
  document.querySelectorAll('#round-replacement-results button').forEach((button) => {
    button.disabled = !canEditDraft || roundDraftActionPending;
  });
}

function updateRoundDraftConflictMarkers(teamsContainer, pairingRelations) {
  const teamsByPlayer = new Map();
  teamsContainer.querySelectorAll('li[data-team][data-discord-id]').forEach((row) => {
    if (row.dataset.discordId) teamsByPlayer.set(row.dataset.discordId, row.dataset.team);
  });
  const getConflictedPlayers = (pairs) => {
    const conflictedPlayers = new Set();
    for (const pair of Array.isArray(pairs) ? pairs : []) {
      const teamA = teamsByPlayer.get(pair.discordIdA);
      if (teamA && teamA === teamsByPlayer.get(pair.discordIdB)) {
        conflictedPlayers.add(pair.discordIdA);
        conflictedPlayers.add(pair.discordIdB);
      }
    }
    return conflictedPlayers;
  };
  const avoidConflicts = getConflictedPlayers(pairingRelations?.avoids);
  const previousConflicts = getConflictedPlayers(pairingRelations?.previousPairings);

  teamsContainer.querySelectorAll('.round-preview-player-label').forEach((label) => {
    label.querySelectorAll('.round-preview-conflict-marker').forEach((marker) => marker.remove());
    const player = label.querySelector('.round-preview-player[data-discord-id]');
    if (!player) return;
    for (const [conflicts, className, description] of [
      [avoidConflicts, 'avoid', 'Current same-team Avoid conflict'],
      [previousConflicts, 'previous', 'Current same-team previous-pairing conflict']
    ]) {
      if (!conflicts.has(player.dataset.discordId)) continue;
      const marker = document.createElement('span');
      marker.className = `round-preview-conflict-marker ${className}`;
      marker.textContent = '*';
      marker.title = description;
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', description);
      label.append(marker);
    }
  });
}

function renderRoundDraft(draft) {
  if (currentRoundDraft && currentRoundDraft.generationId !== draft.generationId) {
    selectedRoundPlayerId = '';
    selectedRoundFillerSlot = null;
    document.getElementById('round-replacement-panel').hidden = true;
  }
  const selectedSlotStillExists = Boolean(selectedRoundFillerSlot &&
    draft.teams.some((team) => team.name === selectedRoundFillerSlot.teamName &&
      team.players[selectedRoundFillerSlot.slotIndex]?.region === 'Filler' &&
      !team.players[selectedRoundFillerSlot.slotIndex]?.discordId));
  const selectedPlayerStillExists = Boolean(selectedRoundPlayerId && draft.teams.some((team) =>
    team.players.some((player) => player.discordId === selectedRoundPlayerId)));
  if ((selectedRoundPlayerId && !selectedPlayerStillExists) ||
      (selectedRoundFillerSlot && !selectedSlotStillExists)) {
    selectedRoundPlayerId = '';
    selectedRoundFillerSlot = null;
    document.getElementById('round-replacement-panel').hidden = true;
  }
  currentRoundDraft = draft;
  renderRoundApprovalActivity(draft);
  const panel = document.getElementById('round-preview-panel');
  const title = document.getElementById('round-preview-title');
  const previewStatus = document.getElementById('round-preview-status');
  const teamsContainer = document.getElementById('round-preview-teams');
  const statusParts = [];
  const finalChecks = draft.checks?.final || {};
  const avoidCount = Array.isArray(finalChecks.avoidConflicts) ? finalChecks.avoidConflicts.length : 0;
  const previousCount = Array.isArray(finalChecks.previousConflicts)
    ? finalChecks.previousConflicts.length
    : 0;
  const regionCount = Array.isArray(finalChecks.regionErrors) ? finalChecks.regionErrors.length : 0;
  applyRoundPreviewIndicator(draft);
  renderRoundReviewers(draft.activeViewers);
  if (avoidCount) statusParts.push(`${avoidCount} Avoid conflict${avoidCount === 1 ? '' : 's'}`);
  if (previousCount) statusParts.push(`${previousCount} previous pairing${previousCount === 1 ? '' : 's'}`);
  if (regionCount) statusParts.push(`${regionCount} region conflict${regionCount === 1 ? '' : 's'}`);
  if (draft.status === 'approving') statusParts.push('Approval incomplete; retry when ready');
  if (draft.status === 'approved') statusParts.push('Round approved');
  title.textContent = `Round #${draft.round} Team Preview`;
  previewStatus.textContent = draft.status === 'approved'
    ? `Round #${draft.round} is approved.`
    : draft.status === 'approving'
      ? `Round #${draft.round} approval is incomplete; retry it to continue${statusParts.length ? ` · ${statusParts.join(' · ')}` : ''}.`
      : draft.previewStatus === 'failed'
    ? `Teams are saved, but the Discord preview needs attention${statusParts.length ? ` · ${statusParts.join(' · ')}` : ''}.`
    : statusParts.length
      ? `Draft warnings: ${statusParts.join(' · ')}.`
      : 'Draft is ready. No team conflicts were found.';

  const approveButton = document.getElementById('round-review-approve');
  const changesButton = document.getElementById('round-review-changes');
  approveButton.setAttribute('aria-pressed', String(draft.myVote === 'approve'));
  changesButton.setAttribute('aria-pressed', String(draft.myVote === 'changes'));
  approveButton.disabled = draft.status !== 'pending' || roundDraftActionPending;
  changesButton.disabled = draft.status !== 'pending' || roundDraftActionPending;

  teamsContainer.replaceChildren();
  for (const team of draft.teams) {
    const card = document.createElement('article');
    card.className = 'round-preview-team';
    card.dataset.team = team.name;
    const teamHeader = document.createElement('div');
    teamHeader.className = 'round-preview-team-header';
    const heading = document.createElement('h3');
    heading.textContent = `Team ${team.name}`;
    teamHeader.append(heading);
    const isAllFillerTeam = team.players.length === 3 &&
      team.players.every((player) => player.region === 'Filler' && !player.discordId);
    if (isAllFillerTeam && draft.teams.length > 1) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'round-preview-delete-filler-team';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', `Delete all-filler Team ${team.name}`);
      deleteButton.title = 'Delete this all-filler team';
      deleteButton.disabled = roundDraftActionPending;
      teamHeader.append(deleteButton);
    }
    const list = document.createElement('ul');
    team.players.forEach((player, slotIndex) => {
      const row = document.createElement('li');
      row.dataset.team = team.name;
      row.dataset.slotIndex = String(slotIndex);
      row.dataset.discordId = player.discordId || '';
      const isFillerSlot = player.region === 'Filler' && !player.discordId;
      const name = player.discordId || isFillerSlot
        ? document.createElement('button')
        : document.createElement('span');
      name.className = 'round-preview-player';
      if (isFillerSlot) name.classList.add('filler-slot');
      name.textContent = player.name;
      name.draggable = Boolean(player.discordId || isFillerSlot) && !roundDraftActionPending;
      if (player.discordId || isFillerSlot) {
        name.type = 'button';
        name.disabled = roundDraftActionPending;
        name.dataset.team = team.name;
        name.dataset.slotIndex = String(slotIndex);
        name.setAttribute('aria-pressed', String(
          player.discordId === selectedRoundPlayerId ||
          (isFillerSlot && selectedRoundFillerSlot?.teamName === team.name &&
            selectedRoundFillerSlot.slotIndex === slotIndex)
        ));
        if (player.discordId) {
          name.dataset.discordId = player.discordId;
          name.title = 'Click to show Avoids and previous pairings, or drag to swap';
        } else {
          name.dataset.fillerSlot = 'true';
          name.title = 'Click to add an unassigned member, or drag onto a player to move them here';
        }
      }
      const region = document.createElement('span');
      region.className = 'round-preview-region';
      region.textContent = player.region;
      const playerLabel = document.createElement('span');
      playerLabel.className = 'round-preview-player-label';
      playerLabel.append(name);
      row.append(playerLabel, region);
      list.append(row);
    });
    card.append(teamHeader, list);
    teamsContainer.append(card);
  }
  updateRoundDraftConflictMarkers(teamsContainer, draft.pairingRelations);
  if (selectedRoundPlayerId) highlightRoundDraftRelations(selectedRoundPlayerId);
  updateRoundDraftControls();
  renderRoundReplacementMembers();
  panel.hidden = false;
  roundPreviewOpen = true;
}

function renderRoundReplacementMembers() {
  const panel = document.getElementById('round-replacement-panel');
  if (!panel || panel.hidden) return;
  const currentLabel = document.getElementById('round-replacement-current');
  const search = document.getElementById('round-replacement-search');
  const results = document.getElementById('round-replacement-results');
  results.replaceChildren();

  const selectedTeam = currentRoundDraft?.teams.find((team) =>
    team.players.some((player) => player.discordId === selectedRoundPlayerId));
  const selectedPlayer = selectedTeam?.players.find((player) =>
    player.discordId === selectedRoundPlayerId);
  const selectedFillerTeam = selectedRoundFillerSlot
    ? currentRoundDraft?.teams.find((team) => team.name === selectedRoundFillerSlot.teamName)
    : null;
  const selectedFiller = selectedFillerTeam?.players[selectedRoundFillerSlot?.slotIndex];
  const fillingFillerSlot = selectedFiller?.region === 'Filler' && !selectedFiller.discordId;
  document.getElementById('round-replace-with-filler').hidden = !selectedPlayer;
  if (!selectedPlayer && !fillingFillerSlot) {
    currentLabel.textContent = 'Select a player in the preview first.';
    return;
  }
  document.querySelector('#round-replacement-panel h3').textContent =
    fillingFillerSlot ? 'Fill filler slot' : 'Replace selected player';
  currentLabel.textContent = fillingFillerSlot
    ? `Adding a member to Team ${selectedFillerTeam.name}.`
    : `Replacing ${selectedPlayer.name} on Team ${selectedTeam.name}.`;
  if (!membersLoaded) {
    currentLabel.textContent += membersLoading
      ? ' Loading the Members list…'
      : ' Open the Members tab and refresh the member list before replacing players.';
    return;
  }

  const assignedIds = new Set(currentRoundDraft.teams.flatMap((team) =>
    team.players.map((player) => player.discordId).filter(Boolean)));
  const teammates = (fillingFillerSlot ? selectedFillerTeam : selectedTeam).players.filter(
    (player, index) => player.discordId &&
      (fillingFillerSlot || player.discordId !== selectedRoundPlayerId) &&
      (!fillingFillerSlot || index !== selectedRoundFillerSlot.slotIndex)
  );
  const query = search.value.trim().toLowerCase();
  const candidates = memberRecords.filter((member) => {
    const discordId = member.discordId || '';
    const region = (member.region || '').trim();
    if (!/^\d{17,20}$/.test(discordId) || assignedIds.has(discordId) ||
        !['East', 'West', 'Both'].includes(region)) {
      return false;
    }
    if (teammates.some((teammate) =>
      (region === 'East' && teammate.region === 'West') ||
      (region === 'West' && teammate.region === 'East'))) {
      return false;
    }
    const searchText = [
      member.nickname,
      member.username,
      discordId,
      region
    ].join(' ').toLowerCase();
    return !query || searchText.includes(query);
  });

  for (const member of candidates.slice(0, 50)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'round-replacement-option';
    button.dataset.discordId = member.discordId;
    const name = document.createElement('span');
    name.textContent = member.nickname || member.username || member.discordId;
    const details = document.createElement('small');
    details.textContent = `${member.username ? `@${member.username} · ` : ''}${member.region}`;
    button.append(name, details);
    results.append(button);
  }
  currentLabel.textContent = candidates.length
    ? `Choose a registered member to ${fillingFillerSlot
      ? `fill the slot on Team ${selectedFillerTeam.name}`
      : `replace ${selectedPlayer.name}`}.` +
      (candidates.length > 50 ? ' Showing the first 50 matches.' : '')
    : 'No eligible, unassigned members match your search.';
}

function showRoundDraftFillerTeamImmediately() {
  const card = document.createElement('article');
  card.className = 'round-preview-team';
  card.dataset.team = '';
  const heading = document.createElement('h3');
  heading.textContent = 'Adding filler team…';
  const teamHeader = document.createElement('div');
  teamHeader.className = 'round-preview-team-header';
  teamHeader.append(heading);
  const list = document.createElement('ul');
  for (let slot = 0; slot < 3; slot += 1) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'round-preview-player';
    name.textContent = 'Filler';
    const region = document.createElement('span');
    region.className = 'round-preview-region';
    region.textContent = 'Filler';
    row.append(name, region);
    list.append(row);
  }
  card.append(teamHeader, list);
  document.getElementById('round-preview-teams').append(card);
}

function showRoundDraftFillerTeamDeletionImmediately(teamName) {
  const card = [...document.querySelectorAll('#round-preview-teams .round-preview-team')]
    .find((candidate) => candidate.dataset.team === teamName);
  if (!card) return false;
  card.remove();
  return true;
}

function showRoundDraftPlayerReplacementImmediately(member) {
  const row = selectedRoundFillerSlot
    ? [...document.querySelectorAll('#round-preview-teams li[data-team][data-slot-index]')]
      .find((candidate) => candidate.dataset.team === selectedRoundFillerSlot.teamName &&
        candidate.dataset.slotIndex === String(selectedRoundFillerSlot.slotIndex))
    : [...document.querySelectorAll('#round-preview-teams li[data-discord-id]')]
      .find((candidate) => candidate.dataset.discordId === selectedRoundPlayerId);
  const player = row?.querySelector('.round-preview-player');
  const region = row?.querySelector('.round-preview-region');
  if (!row || !player || !region) return false;

  player.textContent = member.nickname || member.username || member.discordId;
  player.dataset.discordId = member.discordId;
  player.dataset.team = row.dataset.team;
  player.dataset.slotIndex = row.dataset.slotIndex;
  delete player.dataset.fillerSlot;
  player.setAttribute('aria-pressed', 'false');
  player.classList.remove('avoid-highlight', 'previous-pairing-highlight', 'dragging');
  player.draggable = false;
  player.disabled = true;
  row.dataset.discordId = member.discordId;
  region.textContent = member.region;
  clearRoundDraftRelationshipHighlights();
  updateRoundDraftConflictMarkers(
    document.getElementById('round-preview-teams'),
    currentRoundDraft?.pairingRelations
  );
  return true;
}

function showRoundDraftPlayerFillerImmediately() {
  const playerDiscordId = selectedRoundPlayerId;
  const row = [...document.querySelectorAll('#round-preview-teams li[data-discord-id]')]
    .find((candidate) => candidate.dataset.discordId === playerDiscordId);
  const player = row?.querySelector('.round-preview-player');
  const region = row?.querySelector('.round-preview-region');
  if (!row || !player || !region) return false;

  const usedNumbers = new Set();
  for (const team of currentRoundDraft?.teams || []) {
    for (const draftPlayer of team.players) {
      for (const value of [draftPlayer.id, draftPlayer.name]) {
        const match = String(value || '').match(/^(?:FILLER_|Filler #)(\d+)$/i);
        if (match) usedNumbers.add(Number(match[1]));
      }
    }
  }
  let fillerNumber = 1;
  while (usedNumbers.has(fillerNumber)) fillerNumber += 1;

  player.textContent = `Filler #${fillerNumber}`;
  delete player.dataset.discordId;
  player.dataset.fillerSlot = 'true';
  player.dataset.team = row.dataset.team;
  player.dataset.slotIndex = row.dataset.slotIndex;
  player.classList.add('filler-slot');
  player.classList.remove('avoid-highlight', 'previous-pairing-highlight', 'dragging');
  player.setAttribute('aria-pressed', 'false');
  player.draggable = false;
  player.disabled = true;
  row.dataset.discordId = '';
  region.textContent = 'Filler';
  selectedRoundPlayerId = '';
  selectedRoundFillerSlot = null;
  document.getElementById('round-replacement-panel').hidden = true;
  clearRoundDraftRelationshipHighlights();
  updateRoundDraftConflictMarkers(
    document.getElementById('round-preview-teams'),
    currentRoundDraft?.pairingRelations
  );
  return true;
}

function stopRoundDraftViewerPresence(generationId) {
  if (!generationId) return;
  roundDraftPresenceGenerationId = '';
  const pendingRequest = roundDraftPresenceRequest;
  void (async () => {
    if (pendingRequest) {
      try {
        await pendingRequest;
      } catch {
        // The release request below still lets the server clear the presence.
      }
    }
    try {
      const result = await window.hoedown.updateCurrentRoundDraftPresence({
        generationId,
        viewing: false
      });
      if (!result.ok) {
        console.warn('Could not clear Team Check viewer presence:', result.error);
      }
    } catch (error) {
      console.warn('Could not clear Team Check viewer presence:', error);
    }
  })();
}

function closeRoundDraftPreview() {
  roundPreviewRequestGeneration += 1;
  const generationId = roundDraftPresenceGenerationId ||
    (roundPreviewOpen ? currentRoundDraft?.generationId : '');
  roundPreviewOpen = false;
  stopRoundDraftViewerPresence(generationId);
  selectedRoundPlayerId = '';
  selectedRoundFillerSlot = null;
  draggedRoundSlot = null;
  document.getElementById('round-replacement-panel').hidden = true;
  clearRoundDraftRelationshipHighlights();
  updateRoundPlayerSelection();
  document.getElementById('round-preview-panel').hidden = true;
}

async function renewRoundDraftViewerPresence() {
  const generationId = currentRoundDraft?.generationId;
  if (!roundPreviewOpen || !generationId || roundDraftPresencePending) return;
  const viewGeneration = roundDraftViewGeneration;
  roundDraftPresencePending = true;
  const request = window.hoedown.updateCurrentRoundDraftPresence({
    generationId,
    viewing: true
  });
  roundDraftPresenceRequest = request;
  try {
    const result = await request;
    if (viewGeneration !== roundDraftViewGeneration || !roundPreviewOpen) return;
    if (!result.ok) {
      console.warn('Could not renew Team Check viewer presence:', result.error);
      return;
    }
    currentRoundDraft.activeViewers = result.draft.activeViewers;
    renderRoundReviewers(currentRoundDraft.activeViewers);
  } catch (error) {
    console.warn('Could not renew Team Check viewer presence:', error);
  } finally {
    if (roundDraftPresenceRequest === request) roundDraftPresenceRequest = null;
    roundDraftPresencePending = false;
  }
}

async function refreshRoundDraftStatus() {
  if (roundDraftActionPending || signedInPanel.hidden) return;
  const viewGeneration = roundDraftViewGeneration;
  try {
    const result = await window.hoedown.getCurrentRoundDraft();
    if (viewGeneration !== roundDraftViewGeneration || signedInPanel.hidden) return;
    if (!result.ok) {
      currentRoundDraft = null;
      selectedRoundPlayerId = '';
      selectedRoundFillerSlot = null;
      applyRoundPreviewIndicator(null);
      renderRoundApprovalActivity(null);
      updateRoundDraftControls();
      renderRoundReviewers([], /no pending Team Check draft/i.test(result.error || '')
        ? 'No pending draft.'
        : 'Preview activity unavailable.');
      if (roundPreviewOpen) {
        document.getElementById('round-preview-title').textContent = 'Team Preview unavailable';
        document.getElementById('round-preview-status').textContent =
          result.error || 'Could not refresh the Team Check draft.';
        document.getElementById('round-preview-teams').replaceChildren();
      }
      return;
    }
    if (roundPreviewOpen) {
      renderRoundDraft(result.draft);
      return;
    }
    currentRoundDraft = result.draft;
    applyRoundPreviewIndicator(result.draft);
    renderRoundReviewers(result.draft.activeViewers);
    renderRoundApprovalActivity(result.draft);
    updateRoundDraftControls();
  } catch (error) {
    if (viewGeneration === roundDraftViewGeneration && !signedInPanel.hidden) {
      currentRoundDraft = null;
      selectedRoundPlayerId = '';
      selectedRoundFillerSlot = null;
      applyRoundPreviewIndicator(null);
      renderRoundApprovalActivity(null);
      updateRoundDraftControls();
      renderRoundReviewers([], 'Preview activity unavailable.');
      document.getElementById('round-preview-status').textContent =
        error.message || 'Could not refresh the Team Check draft.';
    }
  }
}

async function saveRoundDraftReview(vote) {
  if (!currentRoundDraft || roundDraftActionPending) return;
  const finalChecks = currentRoundDraft.checks?.final || {};
  const conflicts = [
    ['Avoid', finalChecks.avoidConflicts],
    ['previous pairing', finalChecks.previousConflicts],
    ['region', finalChecks.regionErrors]
  ].flatMap(([label, entries]) => {
    const count = Array.isArray(entries) ? entries.length : 0;
    return count ? [`${count} ${label} conflict${count === 1 ? '' : 's'}`] : [];
  });
  if (vote === 'approve' && conflicts.length) {
    roundDraftActionPending = true;
    updateRoundDraftControls();
    let confirmed = false;
    try {
      confirmed = await confirmRoundReviewWithConflicts(
        `This draft still has ${conflicts.join(', ')}. You are marking the list “Looks good” with these known conflicts. Approve anyway?`
      );
    } catch (error) {
      document.getElementById('round-preview-status').textContent =
        error.message || 'Could not open the conflict confirmation.';
    } finally {
      roundDraftActionPending = false;
      updateRoundDraftControls();
    }
    if (!confirmed) return;
  }
  if (!currentRoundDraft || roundDraftActionPending) return;
  const viewGeneration = roundDraftViewGeneration;
  roundDraftActionPending = true;
  document.getElementById('round-review-approve').disabled = true;
  document.getElementById('round-review-changes').disabled = true;
  document.getElementById('round-preview-status').textContent = 'Saving your review mark…';
  let reviewError = '';
  try {
    const result = await window.hoedown.reviewCurrentRoundDraft({
      generationId: currentRoundDraft.generationId,
      vote
    });
    if (viewGeneration !== roundDraftViewGeneration || signedInPanel.hidden) return;
    if (result.draft) renderRoundDraft(result.draft);
    if (!result.ok) throw new Error(result.error || 'Could not save your review mark.');
  } catch (error) {
    if (viewGeneration === roundDraftViewGeneration && !signedInPanel.hidden) {
      reviewError = error.message || 'Could not save your review mark.';
    }
  } finally {
    if (viewGeneration === roundDraftViewGeneration) {
      roundDraftActionPending = false;
      if (currentRoundDraft) renderRoundDraft(currentRoundDraft);
      if (reviewError) {
        document.getElementById('round-preview-status').textContent = reviewError;
      }
    }
  }
}

function showRoundDraftPlayerSwapImmediately(input) {
  const rows = [...document.querySelectorAll('#round-preview-teams li[data-team][data-slot-index]')];
  const sourceRow = input.sourceTeam && Number.isInteger(input.sourceSlotIndex)
    ? rows.find((row) => row.dataset.team === input.sourceTeam &&
      row.dataset.slotIndex === String(input.sourceSlotIndex) &&
      row.dataset.discordId === (input.sourceDiscordId || ''))
    : rows.find((row) => row.dataset.discordId === input.playerDiscordId);
  const targetRow = rows.find((row) =>
    row.dataset.team === input.targetTeam &&
    row.dataset.slotIndex === String(input.targetSlotIndex));
  if (!sourceRow || !targetRow || sourceRow === targetRow ||
      targetRow.dataset.discordId !== (input.targetDiscordId || '')) {
    return false;
  }

  const sourceChildren = [...sourceRow.children];
  const targetChildren = [...targetRow.children];
  sourceRow.replaceChildren(...targetChildren);
  targetRow.replaceChildren(...sourceChildren);
  sourceRow.dataset.discordId = input.targetDiscordId || '';
  targetRow.dataset.discordId = input.playerDiscordId;

  for (const row of [sourceRow, targetRow]) {
    const player = row.querySelector('.round-preview-player');
    if (!player) continue;
    player.classList.remove('dragging');
    player.dataset.team = row.dataset.team;
    player.dataset.slotIndex = row.dataset.slotIndex;
    if (row.dataset.discordId) {
      player.dataset.discordId = row.dataset.discordId;
      delete player.dataset.fillerSlot;
    } else {
      delete player.dataset.discordId;
      player.dataset.fillerSlot = 'true';
    }
    player.draggable = false;
    if (player.tagName === 'BUTTON') player.disabled = true;
  }
  if (!input.sourceDiscordId && input.sourceTeam && Number.isInteger(input.sourceSlotIndex)) {
    selectedRoundFillerSlot = {
      teamName: input.targetTeam,
      slotIndex: input.targetSlotIndex
    };
  }
  updateRoundPlayerSelection();
  updateRoundDraftConflictMarkers(
    document.getElementById('round-preview-teams'),
    currentRoundDraft?.pairingRelations
  );
  return true;
}

function confirmRoundReviewWithConflicts(message) {
  const dialog = document.getElementById('round-review-conflicts-confirmation');
  document.getElementById('round-review-conflicts-message').textContent = message;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'approve');
    }, { once: true });
    dialog.showModal();
  });
}

function confirmRoundApproval(message) {
  const dialog = document.getElementById('round-approve-confirmation');
  if (dialog.open) return Promise.resolve(false);
  document.getElementById('round-approve-confirmation-message').textContent = message;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'approve');
    }, { once: true });
    dialog.showModal();
  });
}

async function saveRoundDraftMutation(submitRequest, savingMessage, successMessage, onStart) {
  if (!currentRoundDraft || roundDraftActionPending) return;
  const viewGeneration = roundDraftViewGeneration;
  const generationId = currentRoundDraft.generationId;
  const actionStatus = document.getElementById('round-draft-action-status');
  roundDraftActionPending = true;
  actionStatus.textContent = savingMessage;
  document.getElementById('round-preview-status').textContent = savingMessage;
  updateRoundDraftControls();
  try {
    onStart?.();
    const result = await submitRequest(generationId);
    if (viewGeneration !== roundDraftViewGeneration || signedInPanel.hidden) return;
    if (result.draft) renderRoundDraft(result.draft);
    if (!result.ok) throw new Error(result.error || 'Could not save the team adjustment.');
    actionStatus.textContent = successMessage;
  } catch (error) {
    if (viewGeneration === roundDraftViewGeneration && !signedInPanel.hidden) {
      actionStatus.textContent = error.message || 'Could not save the team adjustment.';
    }
  } finally {
    if (viewGeneration === roundDraftViewGeneration) {
      roundDraftActionPending = false;
      if (currentRoundDraft) renderRoundDraft(currentRoundDraft);
    }
  }
}

async function approveCurrentRoundDraft() {
  const draft = currentRoundDraft;
  if (!draft || !['pending', 'approving'].includes(draft.status) || roundDraftActionPending) return;
  const finalChecks = draft.checks?.final || {};
  const avoidCount = Array.isArray(finalChecks.avoidConflicts) ? finalChecks.avoidConflicts.length : 0;
  const previousCount = Array.isArray(finalChecks.previousConflicts)
    ? finalChecks.previousConflicts.length
    : 0;
  const regionCount = Array.isArray(finalChecks.regionErrors) ? finalChecks.regionErrors.length : 0;
  const conflictCount = avoidCount + previousCount + regionCount;
  const conflictMessage = conflictCount
    ? ` This draft has ${avoidCount} Avoid conflict(s), ${previousCount} previous-pairing conflict(s), and ${regionCount} region conflict(s).`
    : '';
  const retryMessage = draft.status === 'approving'
    ? ' This will retry any incomplete approval steps.'
    : '';
  const confirmed = await confirmRoundApproval(
    `Approve Round #${draft.round}? This applies the configured Discord actions.${conflictMessage}${retryMessage}`
  );
  if (!confirmed || currentRoundDraft?.generationId !== draft.generationId) return;

  const viewGeneration = roundDraftViewGeneration;
  const actionStatus = document.getElementById('round-draft-action-status');
  roundDraftActionPending = true;
  draft.approvalActivity = {
    status: 'sending',
    actor: {
      username: document.getElementById('account-name').textContent || 'Your account',
      discordUsername: '',
      avatarUrl: ''
    }
  };
  renderRoundApprovalActivity(draft);
  actionStatus.textContent = `Approving Round #${draft.round} and applying configured Discord actions…`;
  document.getElementById('round-preview-status').textContent = actionStatus.textContent;
  updateRoundDraftControls();
  try {
    const result = await window.hoedown.approveCurrentRoundDraft({
      generationId: draft.generationId
    });
    if (viewGeneration !== roundDraftViewGeneration || signedInPanel.hidden) return;
    if (result.draft) renderRoundDraft(result.draft);
    if (!result.ok) throw new Error(result.error || 'Round approval is incomplete and can be retried.');
    actionStatus.textContent = result.message || `Round #${draft.round} approved successfully.`;
    stopRoundDraftViewerPresence(draft.generationId);
  } catch (error) {
    if (viewGeneration === roundDraftViewGeneration && !signedInPanel.hidden) {
      if (currentRoundDraft?.generationId === draft.generationId &&
          currentRoundDraft.approvalActivity?.status === 'sending') {
        currentRoundDraft.approvalActivity = {
          ...currentRoundDraft.approvalActivity,
          status: 'failed',
          error: error.message || 'Could not approve this round.'
        };
        renderRoundApprovalActivity(currentRoundDraft);
      }
      actionStatus.textContent = error.message || 'Could not approve this round.';
    }
  } finally {
    if (viewGeneration === roundDraftViewGeneration) {
      roundDraftActionPending = false;
      if (currentRoundDraft) renderRoundDraft(currentRoundDraft);
    }
  }
}

function saveRoundDraftPlayerSwap(input) {
  return saveRoundDraftMutation(
    (generationId) => window.hoedown.swapCurrentRoundDraftPlayers({ generationId, ...input }),
    'Saving the team adjustment and refreshing Discord…',
    'Team adjustment saved. The Discord preview is up to date.',
    () => {
      if (showRoundDraftPlayerSwapImmediately(input)) {
        document.getElementById('round-preview-status').textContent =
          'Swap shown. Saving the adjustment and refreshing Discord…';
      }
    }
  );
}

function saveRoundDraftFillerTeam() {
  return saveRoundDraftMutation(
    (generationId) => window.hoedown.addCurrentRoundDraftFillerTeam({ generationId }),
    'Adding a filler team and refreshing Discord…',
    'Filler team added. The Discord preview is up to date.',
    showRoundDraftFillerTeamImmediately
  );
}

function saveRoundDraftFillerTeamDeletion(teamName) {
  return saveRoundDraftMutation(
    (generationId) => window.hoedown.deleteCurrentRoundDraftFillerTeam({
      generationId,
      teamName
    }),
    `Deleting all-filler Team ${teamName} and refreshing Discord…`,
    `Team ${teamName} deleted. The Discord preview is up to date.`,
    () => {
      showRoundDraftFillerTeamDeletionImmediately(teamName);
    }
  );
}

function saveRoundDraftPlayerReplacement(member) {
  const playerDiscordId = selectedRoundPlayerId;
  const fillerSlot = selectedRoundFillerSlot ? { ...selectedRoundFillerSlot } : null;
  return saveRoundDraftMutation(
    (generationId) => fillerSlot
      ? window.hoedown.fillCurrentRoundDraftSlot({
        generationId,
        targetTeam: fillerSlot.teamName,
        targetSlotIndex: fillerSlot.slotIndex,
        replacementDiscordId: member.discordId
      })
      : window.hoedown.replaceCurrentRoundDraftPlayer({
        generationId,
        playerDiscordId,
        replacementDiscordId: member.discordId
      }),
    fillerSlot
      ? 'Filling the slot and refreshing Discord…'
      : 'Replacing the player and refreshing Discord…',
    fillerSlot
      ? 'Filler slot filled. The Discord preview is up to date.'
      : 'Player replaced. The Discord preview is up to date.',
    () => {
      if (showRoundDraftPlayerReplacementImmediately(member)) {
        document.getElementById('round-replacement-current').textContent =
          'Replacement shown. Saving the player change…';
      }
    }
  );
}

function saveRoundDraftPlayerWithFiller() {
  const playerDiscordId = selectedRoundPlayerId;
  return saveRoundDraftMutation(
    (generationId) => window.hoedown.replaceCurrentRoundDraftPlayerWithFiller({
      generationId,
      playerDiscordId
    }),
    'Replacing the player with a filler and refreshing Discord…',
    'Player replaced with a filler. The Discord preview is up to date.',
    () => {
      showRoundDraftPlayerFillerImmediately();
    }
  );
}

document.getElementById('app-navigation').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;
  const page = pages[button.dataset.tab];
  if (!page) return;
  if (button.dataset.tab === 'rounds') void refreshRoundDraftStatus();

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
  const isRounds = button.dataset.tab === 'rounds';
  const isTickets = button.dataset.tab === 'tickets';
  const isSettings = button.dataset.tab === 'settings';
  if (!isRounds && roundPreviewOpen) closeRoundDraftPreview();
  document.getElementById('members-view').hidden = !isMembers;
  document.getElementById('avoids-view').hidden = !isAvoids;
  document.getElementById('rounds-view').hidden = !isRounds;
  document.getElementById('tickets-view').hidden = !isTickets;
  document.getElementById('settings-view').hidden = !isSettings;
  if (isRounds) void refreshRoundActionStatus();
  document.getElementById('page-card').hidden = isMembers || isAvoids || isRounds || isTickets || isSettings;
  selfPasswordForm.hidden = true;
  showStatus('');
  if (isMembers && !membersLoaded && !membersLoading) void loadMembers();
  if (isAvoids && !avoidsLoaded && !avoidsLoading) void loadAvoids();
  if (isSettings && !settingsLoaded && !settingsLoading) void loadSettings();
  if (isTickets && !ticketsLoaded && !ticketsLoading) void loadTickets(1);
  else if (isTickets && selectedPersonSummary) {
    if (selectedTicketSummary && !document.getElementById('ticket-detail-view').hidden) {
      void openTicket(selectedTicketSummary, { preserveScroll: true });
    } else {
      void loadPersonTickets(selectedPersonSummary);
    }
  }
});

document.querySelectorAll('[data-theme-color]').forEach((input) => {
  input.addEventListener('input', () => {
    applyThemeColors(readThemeColorsFromInputs());
    setSettingsFeedback('Previewing changes. Save colors to keep them on your account.');
  });
});
document.getElementById('save-theme-colors').addEventListener('click', () => {
  void saveThemeColors();
});
document.getElementById('reset-theme-colors').addEventListener('click', () => {
  void resetThemeColors();
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
  if (fieldName === 'streamLink' && value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
    if (url && ['http:', 'https:'].includes(url.protocol)) {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = value;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void window.hoedown.openExternalUrl(url.href).catch((error) => {
          showStatus(error.message || 'Could not open the stream link.');
        });
      });
      description.append(link);
    } else {
      description.textContent = value;
    }
  } else {
    description.textContent = value || '—';
  }
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
    renderRoundReplacementMembers();
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
  renderRoundReplacementMembers();
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
    renderRoundReplacementMembers();
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
    updateRoundDraftControls();
    renderRoundReplacementMembers();
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

function confirmAvoidRemoval(avoiderName, avoidedName) {
  const dialog = document.getElementById('avoid-remove-confirmation');
  document.getElementById('avoid-remove-confirmation-message').textContent =
    `Remove ${avoidedName} from ${avoiderName}'s Avoiding list?`;
  dialog.returnValue = '';
  return new Promise((resolve, reject) => {
    const onClose = () => resolve(dialog.returnValue === 'remove');
    dialog.addEventListener('close', onClose, { once: true });
    try {
      dialog.showModal();
    } catch (error) {
      dialog.removeEventListener('close', onClose);
      reject(error);
    }
  });
}

async function removeAvoidRelationship(group, member) {
  const key = `${group.avoiderDiscordId}\0${member.discordId}`;
  if (pendingAvoidRemovals.has(key)) return;
  try {
    if (!await confirmAvoidRemoval(group.avoiderName, member.name)) return;
  } catch (error) {
    setAvoidsFeedback(error.message || 'Could not open the confirmation dialog.', true);
    return;
  }

  pendingAvoidRemovals.add(key);
  renderAvoids();
  setAvoidsFeedback(`Removing ${member.name} from ${group.avoiderName}'s Avoiding list…`);
  try {
    const result = await window.hoedown.removeAvoid({
      avoiderDiscordId: group.avoiderDiscordId,
      avoidedDiscordId: member.discordId
    });
    if (!result.ok) throw new Error(result.error || 'Could not remove the Avoid relationship.');
    avoidRecords = avoidRecords.filter((pair) =>
      pair.avoiderDiscordId !== group.avoiderDiscordId ||
      pair.avoidedDiscordId !== member.discordId);
    if (!avoidRecords.some((pair) => pair.avoiderDiscordId === group.avoiderDiscordId)) {
      editingAvoiderIds.delete(group.avoiderDiscordId);
    }
    renderAvoids();
    setAvoidsFeedback(`Removed ${member.name} from ${group.avoiderName}'s Avoiding list.`);
  } catch (error) {
    setAvoidsFeedback(error.message || 'Could not remove the Avoid relationship.', true);
  } finally {
    pendingAvoidRemovals.delete(key);
    renderAvoids();
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
    const isEditing = editingAvoiderIds.has(group.avoiderDiscordId);
    const avoider = document.createElement('div');
    avoider.className = 'avoid-player';
    const avoiderHeading = document.createElement('div');
    avoiderHeading.className = 'avoid-player-heading';
    const avoiderLabel = document.createElement('span');
    avoiderLabel.className = 'avoid-player-label';
    avoiderLabel.textContent = 'Avoider';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'secondary icon-button avoid-edit-button';
    editButton.textContent = isEditing ? 'Done' : '✎';
    editButton.setAttribute('aria-label', isEditing
      ? `Finish editing ${group.avoiderName}'s Avoids`
      : `Edit ${group.avoiderName}'s Avoids`);
    editButton.title = isEditing ? 'Done editing Avoids' : 'Edit Avoiding list';
    editButton.setAttribute('aria-pressed', String(isEditing));
    editButton.addEventListener('click', () => {
      if (isEditing) editingAvoiderIds.delete(group.avoiderDiscordId);
      else editingAvoiderIds.add(group.avoiderDiscordId);
      renderAvoids();
    });
    avoiderHeading.append(avoiderLabel, editButton);
    const avoiderName = document.createElement('strong');
    avoiderName.textContent = group.avoiderNickname || group.avoiderUsername || 'No nickname set';
    const avoiderUsername = document.createElement('small');
    avoiderUsername.textContent = group.avoiderUsername ? `@${group.avoiderUsername}` : 'No username listed';
    const avoiderId = document.createElement('small');
    avoiderId.textContent = group.avoiderDiscordId || '';
    avoider.append(avoiderHeading, avoiderName, avoiderUsername, avoiderId);

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
      const identity = document.createElement('div');
      identity.className = 'avoid-target-identity';
      const name = document.createElement('strong');
      name.textContent = member.nickname || member.username || 'No nickname set';
      const username = document.createElement('small');
      username.textContent = member.username ? `@${member.username}` : 'No username listed';
      const discordId = document.createElement('small');
      discordId.textContent = member.discordId || '';
      identity.append(name, username, discordId);
      item.append(identity);
      if (isEditing) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'avoid-remove-button';
        removeButton.textContent = '−';
        removeButton.setAttribute('aria-label', `Remove ${member.name} from ${group.avoiderName}'s Avoiding list`);
        removeButton.title = 'Remove Avoid relationship';
        removeButton.disabled = pendingAvoidRemovals.has(
          `${group.avoiderDiscordId}\0${member.discordId}`
        );
        removeButton.addEventListener('click', () => {
          void removeAvoidRelationship(group, member);
        });
        item.append(removeButton);
      }
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
      void openTicket(selectedTicketSummary, { preserveScroll: true });
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
      void openTicket(selectedTicketSummary, { preserveScroll: true });
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

async function openTicket(ticketSummary, { preserveScroll = false } = {}) {
  selectedTicketSummary = ticketSummary;
  const generation = ++ticketDetailGeneration;
  const detailView = document.getElementById('ticket-detail-view');
  const content = document.getElementById('ticket-detail-content');
  const state = document.getElementById('ticket-detail-state');
  const chatSyncWarning = document.getElementById('ticket-chat-sync-warning');
  const replyForm = document.getElementById('ticket-reply-form');
  const replyUnavailable = document.getElementById('ticket-reply-unavailable');
  const replyStatus = document.getElementById('ticket-reply-status');
  const closeStatus = document.getElementById('ticket-close-status');
  document.getElementById('ticket-list-view').hidden = true;
  document.getElementById('person-tickets-view').hidden = true;
  detailView.hidden = false;
  if (preserveScroll) {
    state.hidden = true;
  } else {
    content.replaceChildren();
    replyForm.hidden = true;
    replyUnavailable.hidden = true;
    document.getElementById('ticket-message-mode').value = 'reply';
    updateTicketMessageMode();
    document.getElementById('ticket-reply-input').value = '';
    replyStatus.textContent = '';
    replyStatus.dataset.error = 'false';
    chatSyncWarning.hidden = true;
    chatSyncWarning.textContent = '';
    closeStatus.hidden = true;
    closeStatus.textContent = '';
    closeStatus.dataset.error = 'false';
    state.hidden = false;
    state.textContent = 'Loading ticket transcript…';
  }

  try {
    const result = await window.hoedown.getTicket(
      ticketSummary.collectionName,
      ticketSummary.ticketId,
      { syncStaffChat: !preserveScroll }
    );
    if (generation !== ticketDetailGeneration) return;
    if (!result.ok) throw new Error(result.error || 'Could not load the ticket transcript.');
    const ticket = result.ticket;
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
    const ticketIsOpen = ticket.status?.toLocaleLowerCase('en') === 'open';
    const canReply = result.canReply === true;
    for (const message of ticket.messages) {
      const item = document.createElement('li');
      const isStaffChat = message.messageType === 'staff-chat';
      item.className = isStaffChat
        ? 'ticket-message ticket-message-staff-chat'
        : 'ticket-message';
      const messageHeader = document.createElement('header');
      const author = document.createElement('strong');
      author.textContent = message.authorName || message.authorID || 'Unknown author';
      const authorBlock = document.createElement('span');
      authorBlock.className = 'ticket-message-author';
      if (typeof message.authorAvatarUrl === 'string' &&
          /^https:\/\/cdn\.discordapp\.com\//.test(message.authorAvatarUrl)) {
        const avatar = document.createElement('img');
        avatar.className = 'ticket-message-author-avatar';
        avatar.src = message.authorAvatarUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        authorBlock.append(avatar);
      }
      authorBlock.append(author);
      const timestamp = document.createElement('time');
      timestamp.textContent = message.timestamp || 'Time unavailable';
      messageHeader.append(authorBlock, timestamp);
      const authorId = document.createElement('small');
      authorId.textContent = message.authorID?.startsWith('app:')
        ? 'App account'
        : message.authorID ? `Discord ID: ${message.authorID}` : '';
      if (isStaffChat) {
        const messageType = document.createElement('small');
        messageType.className = 'ticket-message-type';
        messageType.textContent = 'Staff chat · not sent to the member';
        item.append(messageHeader, authorId, messageType);
      } else {
        item.append(messageHeader, authorId);
      }
      const body = document.createElement('p');
      body.className = 'ticket-message-content';
      body.textContent = message.content || '[No message content]';
      item.append(body);
      if (message.editedByName) {
        const editNote = document.createElement('small');
        editNote.className = 'ticket-message-edit-note';
        const editedAt = message.editedAt ? new Date(message.editedAt) : null;
        const editTime = editedAt && !Number.isNaN(editedAt.getTime())
          ? ` · ${editedAt.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            timeZoneName: 'short'
          })}`
          : '';
        editNote.textContent = `Last edited by ${message.editedByName}${editTime}`;
        item.append(editNote);
      }
      if (ticketIsOpen && canReply && message.canEdit === true && message.mirrorMessageID) {
        const actions = document.createElement('div');
        actions.className = 'ticket-message-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'secondary ticket-message-edit';
        editButton.textContent = 'Edit reply';
        const editor = document.createElement('form');
        editor.className = 'ticket-message-editor';
        editor.hidden = true;
        const editInput = document.createElement('textarea');
        editInput.maxLength = 1800;
        editInput.rows = 3;
        editInput.required = true;
        editInput.value = message.content || '';
        const editActions = document.createElement('div');
        editActions.className = 'ticket-message-editor-actions';
        const editStatus = document.createElement('p');
        editStatus.className = 'ticket-message-editor-status';
        editStatus.setAttribute('role', 'status');
        editStatus.setAttribute('aria-live', 'polite');
        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.textContent = 'Save edit';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'secondary';
        cancelButton.textContent = 'Cancel';
        editActions.append(saveButton, cancelButton);
        editor.append(editInput, editActions, editStatus);
        editButton.addEventListener('click', () => {
          editor.hidden = false;
          editButton.hidden = true;
          editInput.focus();
        });
        cancelButton.addEventListener('click', () => {
          editInput.value = message.content || '';
          editStatus.textContent = '';
          editStatus.dataset.error = 'false';
          editor.hidden = true;
          editButton.hidden = false;
        });
        editor.addEventListener('submit', async (event) => {
          event.preventDefault();
          const replyText = editInput.value.trim();
          if (!replyText) {
            editStatus.dataset.error = 'true';
            editStatus.textContent = 'A reply cannot be empty.';
            return;
          }
          saveButton.disabled = true;
          cancelButton.disabled = true;
          editInput.disabled = true;
          editStatus.dataset.error = 'false';
          editStatus.textContent = 'Updating Discord messages…';
          try {
            const result = await window.hoedown.editTicketReply({
              collectionName: ticketSummary.collectionName,
              ticketId: ticketSummary.ticketId,
              mirrorMessageID: message.mirrorMessageID,
              replyText
            });
            if (!result.ok) {
              editStatus.dataset.error = 'true';
              editStatus.textContent = result.error || 'Could not edit this reply.';
              return;
            }
            if (selectedTicketSummary?.collectionName === ticketSummary.collectionName &&
                selectedTicketSummary?.ticketId === ticketSummary.ticketId &&
                !document.getElementById('ticket-detail-view').hidden) {
              void openTicket(ticketSummary, { preserveScroll: true });
            }
          } catch (error) {
            editStatus.dataset.error = 'true';
            editStatus.textContent = error.message || 'Could not edit this reply.';
          } finally {
            saveButton.disabled = false;
            cancelButton.disabled = false;
            editInput.disabled = false;
          }
        });
        actions.append(editButton, editor);
        item.append(actions);
      }
      transcript.append(item);
    }
    const previousScrollTop = detailView.scrollTop;
    const wasAtBottom = detailView.scrollHeight - detailView.clientHeight - previousScrollTop <= 32;
    state.hidden = true;
    replyForm.hidden = !ticketIsOpen || !canReply;
    replyUnavailable.hidden = !ticketIsOpen || canReply;
    chatSyncWarning.hidden = !result.syncWarning;
    chatSyncWarning.textContent = result.syncWarning || '';
    content.replaceChildren(heading, summary, metadata, staffHeading, staffList, transcriptHeading, transcript);
    if (preserveScroll) {
      const maxScrollTop = Math.max(0, detailView.scrollHeight - detailView.clientHeight);
      detailView.scrollTop = wasAtBottom ? maxScrollTop : Math.min(previousScrollTop, maxScrollTop);
    }
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

document.getElementById('confirm-avoid-remove').addEventListener('click', () => {
  const dialog = document.getElementById('avoid-remove-confirmation');
  dialog.returnValue = 'remove';
  dialog.close();
});
document.getElementById('cancel-avoid-remove').addEventListener('click', () => {
  const dialog = document.getElementById('avoid-remove-confirmation');
  dialog.returnValue = 'cancel';
  dialog.close();
});

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
    setAvoidsFeedback(`Saved ${result.mongodb.relationshipCount} Avoid relationship(s) to MongoDB.`);
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
document.getElementById('open-round-preview').addEventListener('click', async (event) => {
  if (roundDraftActionPending) return;
  const viewGeneration = roundDraftViewGeneration;
  const requestGeneration = ++roundPreviewRequestGeneration;
  const expectedGenerationId = currentRoundDraft?.generationId || '';
  const button = event.currentTarget;
  const panel = document.getElementById('round-preview-panel');
  const previewStatus = document.getElementById('round-preview-status');
  button.disabled = true;
  panel.hidden = false;
  roundPreviewOpen = true;
  currentRoundDraft = null;
  selectedRoundPlayerId = '';
  selectedRoundFillerSlot = null;
  draggedRoundSlot = null;
  document.getElementById('round-preview-teams').replaceChildren();
  document.getElementById('round-reviewers').replaceChildren();
  previewStatus.textContent = 'Loading the current Team Check draft…';
  try {
    const result = await window.hoedown.openCurrentRoundDraft();
    if (viewGeneration !== roundDraftViewGeneration || signedInPanel.hidden ||
        requestGeneration !== roundPreviewRequestGeneration || !roundPreviewOpen) {
      if (result.draft?.generationId) stopRoundDraftViewerPresence(result.draft.generationId);
      return;
    }
    if (result.draft) renderRoundDraft(result.draft);
    if (!result.ok) throw new Error(result.error || 'Could not open the Team Check draft.');
    roundDraftPresenceGenerationId = result.draft.generationId;
  } catch (error) {
    if (viewGeneration === roundDraftViewGeneration && !signedInPanel.hidden) {
      previewStatus.textContent = error.message || 'Could not open the Team Check draft.';
    }
    if (expectedGenerationId) stopRoundDraftViewerPresence(expectedGenerationId);
  } finally {
    if (viewGeneration === roundDraftViewGeneration) button.disabled = false;
  }
});
document.getElementById('close-round-preview').addEventListener('click', () => {
  closeRoundDraftPreview();
});
document.getElementById('round-add-filler-team').addEventListener('click', () => {
  void saveRoundDraftFillerTeam();
});
document.getElementById('round-open-replacement').addEventListener('click', () => {
  if ((!selectedRoundPlayerId && !selectedRoundFillerSlot) || roundDraftActionPending) return;
  const panel = document.getElementById('round-replacement-panel');
  panel.hidden = false;
  document.getElementById('round-replacement-search').value = '';
  renderRoundReplacementMembers();
  document.getElementById('round-replacement-search').focus();
  if (!membersLoaded && !membersLoading) void loadMembers();
});
document.getElementById('round-close-replacement').addEventListener('click', () => {
  document.getElementById('round-replacement-panel').hidden = true;
});
document.getElementById('round-replace-with-filler').addEventListener('click', () => {
  if (!selectedRoundPlayerId || roundDraftActionPending) return;
  void saveRoundDraftPlayerWithFiller();
});
document.getElementById('round-replacement-search').addEventListener('input', () => {
  renderRoundReplacementMembers();
});
document.getElementById('round-replacement-results').addEventListener('click', (event) => {
  const choice = event.target.closest('button[data-discord-id]');
  if (!choice || roundDraftActionPending) return;
  const member = memberRecords.find((entry) => entry.discordId === choice.dataset.discordId);
  if (member) void saveRoundDraftPlayerReplacement(member);
});
const roundPreviewTeams = document.getElementById('round-preview-teams');
roundPreviewTeams.addEventListener('click', (event) => {
  const deleteTeamButton = event.target.closest('.round-preview-delete-filler-team');
  if (deleteTeamButton) {
    const teamCard = deleteTeamButton.closest('.round-preview-team[data-team]');
    if (teamCard && !roundDraftActionPending) {
      void saveRoundDraftFillerTeamDeletion(teamCard.dataset.team);
    }
    return;
  }
  const player = event.target.closest('.round-preview-player[data-discord-id]');
  const filler = event.target.closest('.round-preview-player[data-filler-slot="true"]');
  if ((!player && !filler) || roundDraftActionPending) return;
  if (filler) {
    const sameFiller = selectedRoundFillerSlot?.teamName === filler.dataset.team &&
      selectedRoundFillerSlot.slotIndex === Number(filler.dataset.slotIndex);
    selectedRoundPlayerId = '';
    selectedRoundFillerSlot = sameFiller
      ? null
      : { teamName: filler.dataset.team, slotIndex: Number(filler.dataset.slotIndex) };
  } else {
    selectedRoundPlayerId = selectedRoundPlayerId === player.dataset.discordId
      ? ''
      : player.dataset.discordId;
    selectedRoundFillerSlot = null;
  }
  if (!selectedRoundPlayerId && !selectedRoundFillerSlot) {
    document.getElementById('round-replacement-panel').hidden = true;
  }
  updateRoundPlayerSelection();
  if (selectedRoundPlayerId) highlightRoundDraftRelations(selectedRoundPlayerId);
  else clearRoundDraftRelationshipHighlights();
});
roundPreviewTeams.addEventListener('dragstart', (event) => {
  const player = event.target.closest('.round-preview-player');
  if ((!player?.dataset.discordId && player?.dataset.fillerSlot !== 'true') ||
      roundDraftActionPending) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  const sourceRow = player.closest('li[data-team][data-slot-index]');
  const sourceDiscordId = player.dataset.discordId || '';
  event.dataTransfer.setData('text/plain', sourceDiscordId);
  draggedRoundPlayerId = sourceDiscordId;
  draggedRoundSlot = {
    teamName: sourceRow.dataset.team,
    slotIndex: Number(sourceRow.dataset.slotIndex),
    discordId: sourceDiscordId
  };
  selectedRoundPlayerId = sourceDiscordId;
  selectedRoundFillerSlot = sourceDiscordId
    ? null
    : { teamName: draggedRoundSlot.teamName, slotIndex: draggedRoundSlot.slotIndex };
  updateRoundPlayerSelection();
  player.classList.add('dragging');
  if (draggedRoundPlayerId) highlightRoundDraftRelations(draggedRoundPlayerId);
  else clearRoundDraftRelationshipHighlights();
});
roundPreviewTeams.addEventListener('dragend', (event) => {
  event.target.closest('.round-preview-player')?.classList.remove('dragging');
  if (selectedRoundPlayerId) highlightRoundDraftRelations(selectedRoundPlayerId);
  else clearRoundDraftRelationshipHighlights();
  draggedRoundPlayerId = '';
  draggedRoundSlot = null;
  roundPreviewTeams.querySelectorAll('.drop-target').forEach((target) => {
    target.classList.remove('drop-target');
  });
});
roundPreviewTeams.addEventListener('dragover', (event) => {
  const target = event.target.closest('li[data-team][data-slot-index]');
  const draggedPlayer = roundPreviewTeams.querySelector('.round-preview-player.dragging');
  if (!target || !draggedPlayer ||
      target.dataset.team === draggedPlayer.dataset.team ||
      (draggedPlayer.dataset.fillerSlot === 'true' && !target.dataset.discordId) ||
      roundDraftActionPending) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  target.classList.add('drop-target');
});
roundPreviewTeams.addEventListener('dragleave', (event) => {
  const target = event.target.closest('li[data-team][data-slot-index]');
  if (target && !target.contains(event.relatedTarget)) {
    target.classList.remove('drop-target');
  }
});
roundPreviewTeams.addEventListener('drop', async (event) => {
  const target = event.target.closest('li[data-team][data-slot-index]');
  const source = draggedRoundSlot;
  const sourceDiscordId = source?.discordId || '';
  const sourceTeam = currentRoundDraft?.teams.find((team) =>
    team.name === source?.teamName);
  if (!target || !source || !sourceTeam || target.dataset.team === sourceTeam.name ||
      (source.discordId === '' && !target.dataset.discordId) ||
      roundDraftActionPending || !currentRoundDraft) return;
  event.preventDefault();
  target.classList.remove('drop-target');
  await saveRoundDraftPlayerSwap({
    playerDiscordId: sourceDiscordId,
    sourceTeam: source.teamName,
    sourceSlotIndex: source.slotIndex,
    sourceDiscordId,
    targetTeam: target.dataset.team,
    targetSlotIndex: Number(target.dataset.slotIndex),
    targetDiscordId: target.dataset.discordId || ''
  });
});
document.getElementById('round-review-approve').addEventListener('click', () => {
  void saveRoundDraftReview('approve');
});
document.getElementById('round-approve-final').addEventListener('click', () => {
  void approveCurrentRoundDraft();
});
document.getElementById('cancel-round-approve').addEventListener('click', () => {
  document.getElementById('round-approve-confirmation').close('cancel');
});
document.getElementById('confirm-round-approve').addEventListener('click', () => {
  document.getElementById('round-approve-confirmation').close('approve');
});
document.getElementById('cancel-round-review-conflicts').addEventListener('click', () => {
  document.getElementById('round-review-conflicts-confirmation').close('cancel');
});
document.getElementById('confirm-round-review-conflicts').addEventListener('click', () => {
  document.getElementById('round-review-conflicts-confirmation').close('approve');
});
document.getElementById('round-review-changes').addEventListener('click', () => {
  void saveRoundDraftReview('changes');
});
document.getElementById('grab-round-reactions').addEventListener('click', async (event) => {
  if (roundActionState.running || localRoundActionPending) return;
  localRoundActionPending = true;
  const actionStatus = document.getElementById('rounds-action-status');
  applyRoundActionState(roundActionState);
  actionStatus.hidden = false;
  actionStatus.textContent = 'Searching the Opt-In channel and generating the Team Check draft…';
  try {
    const result = await window.hoedown.grabRoundReactions();
    if (result.roundActionState) applyRoundActionState(result.roundActionState);
    if (!result.ok) throw new Error(result.error || 'Could not generate the next round draft.');
    const displayedConflicts = result.conflictDetails.slice(0, 5).join('; ');
    const additionalConflictCount = result.conflictDetails.length - 5;
    const conflictStatus = result.conflictsFound
      ? `Conflicts found: ${displayedConflicts}${additionalConflictCount > 0 ? `; and ${additionalConflictCount} more` : ''}.`
      : 'No Conflicts found.';
    const previewStatus = result.postingStatus === 'posted'
      ? 'The Team Check channel was cleared and the current preview was posted.'
      : 'Team Check preview posting is disabled.';
    actionStatus.textContent = `Round #${result.round} draft saved. ${conflictStatus} ${previewStatus}`;
  } catch (error) {
    actionStatus.textContent = error.message || 'Could not generate the next round draft.';
  } finally {
    localRoundActionPending = false;
    applyRoundActionState(roundActionState);
    void refreshRoundActionStatus();
  }
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

function updateTicketMessageMode() {
  const mode = document.getElementById('ticket-message-mode').value;
  const internal = mode === 'staff-chat';
  document.getElementById('ticket-message-input-label').textContent = internal
    ? 'Staff chat message'
    : 'Reply to member';
  document.getElementById('ticket-message-mode-help').textContent = internal
    ? 'This is posted only in the private staff ticket channel. It will not be sent to the member.'
    : 'This will be sent to the member’s DMs and mirrored in the ticket channel.';
  document.getElementById('ticket-message-submit').textContent = internal
    ? 'Send staff message'
    : 'Send reply';
}

function confirmMemberReply() {
  if (memberReplyConfirmationPromise) return memberReplyConfirmationPromise;
  const dialog = document.getElementById('member-reply-confirmation');
  memberReplyConfirmationPromise = new Promise((resolve) => {
    memberReplyConfirmationResolver = resolve;
    dialog.showModal();
  });
  return memberReplyConfirmationPromise;
}

function finishMemberReplyConfirmation(confirmed) {
  if (!memberReplyConfirmationResolver) return;
  const resolve = memberReplyConfirmationResolver;
  memberReplyConfirmationResolver = null;
  memberReplyConfirmationPromise = null;
  const dialog = document.getElementById('member-reply-confirmation');
  if (dialog.open) dialog.close();
  resolve(confirmed);
}

document.getElementById('confirm-member-reply').addEventListener('click', () => {
  finishMemberReplyConfirmation(true);
});
document.getElementById('cancel-member-reply').addEventListener('click', () => {
  finishMemberReplyConfirmation(false);
});
document.getElementById('member-reply-confirmation').addEventListener('cancel', (event) => {
  event.preventDefault();
  finishMemberReplyConfirmation(false);
});

document.getElementById('ticket-message-mode').addEventListener('change', () => {
  updateTicketMessageMode();
  const status = document.getElementById('ticket-reply-status');
  status.textContent = '';
  status.dataset.error = 'false';
});

document.getElementById('close-ticket-button').addEventListener('click', () => {
  const dialog = document.getElementById('ticket-close-options');
  if (selectedTicketSummary && !ticketActionInProgress && !dialog.open) dialog.showModal();
});
document.getElementById('cancel-ticket-close').addEventListener('click', () => {
  document.getElementById('ticket-close-options').close();
});
function confirmTicketClose(mode) {
  const modeLabel = mode === 'normal' ? 'normally' : 'silently';
  const dialog = document.getElementById('ticket-close-confirmation');
  document.getElementById('ticket-close-confirmation-message').textContent =
    `Are you sure you want to close this ticket ${modeLabel}?`;
  document.getElementById('confirm-ticket-close').textContent =
    mode === 'normal' ? 'Close Normally' : 'Close Silently';
  dialog.showModal();
  return new Promise((resolve) => {
    ticketCloseConfirmationResolver = resolve;
  });
}
function finishTicketCloseConfirmation(confirmed) {
  const resolve = ticketCloseConfirmationResolver;
  ticketCloseConfirmationResolver = null;
  const dialog = document.getElementById('ticket-close-confirmation');
  if (dialog.open) dialog.close();
  if (resolve) resolve(confirmed);
}
document.getElementById('confirm-ticket-close').addEventListener('click', () => {
  finishTicketCloseConfirmation(true);
});
document.getElementById('cancel-ticket-close-confirmation').addEventListener('click', () => {
  finishTicketCloseConfirmation(false);
});
document.getElementById('ticket-close-confirmation').addEventListener('cancel', (event) => {
  event.preventDefault();
  finishTicketCloseConfirmation(false);
});
document.querySelectorAll('[data-close-mode]').forEach((button) => {
  button.addEventListener('click', async () => {
    const mode = button.dataset.closeMode;
    const modeLabel = mode === 'normal' ? 'normally' : 'silently';
    document.getElementById('ticket-close-options').close();
    if (!await confirmTicketClose(mode)) return;

    const ticket = selectedTicketSummary;
    const status = document.getElementById('ticket-close-status');
    const closeButton = document.getElementById('close-ticket-button');
    const input = document.getElementById('ticket-reply-input');
    const modeSelect = document.getElementById('ticket-message-mode');
    const submitButton = document.getElementById('ticket-message-submit');
    if (!ticket || ticketActionInProgress) return;
    ticketActionInProgress = true;
    closeButton.disabled = true;
    submitButton.disabled = true;
    input.disabled = true;
    modeSelect.disabled = true;
    document.querySelectorAll('[data-close-mode]').forEach((option) => { option.disabled = true; });
    status.hidden = false;
    status.dataset.error = 'false';
    status.textContent = `Closing ticket ${modeLabel}…`;
    try {
      const result = await window.hoedown.closeTicket({
        collectionName: ticket.collectionName,
        ticketId: ticket.ticketId,
        mode
      });
      if (!result.ok && !result.partial) throw new Error(result.error || 'Could not close this ticket.');

      if (selectedPersonSummary) {
        await loadPersonTickets(selectedPersonSummary, { preserve: true });
      }
      if (selectedTicketSummary?.collectionName === ticket.collectionName &&
          selectedTicketSummary?.ticketId === ticket.ticketId &&
          !document.getElementById('ticket-detail-view').hidden) {
        await openTicket(selectedTicketSummary, { preserveScroll: true });
      }

      if (!result.ok) {
        status.dataset.error = 'true';
        status.textContent = result.error || 'The ticket was only partially closed.';
        return;
      }
      status.dataset.error = result.warning ? 'true' : 'false';
      status.textContent = result.warning || `Ticket closed ${modeLabel}.`;
    } catch (error) {
      status.dataset.error = 'true';
      status.textContent = error.message || 'Could not close this ticket.';
    } finally {
      ticketActionInProgress = false;
      closeButton.disabled = false;
      submitButton.disabled = false;
      input.disabled = false;
      modeSelect.disabled = false;
      document.querySelectorAll('[data-close-mode]').forEach((option) => { option.disabled = false; });
    }
  });
});

document.getElementById('ticket-reply-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = document.getElementById('ticket-reply-input');
  const status = document.getElementById('ticket-reply-status');
  const button = form.querySelector('button[type="submit"]');
  const closeButton = document.getElementById('close-ticket-button');
  const modeSelect = document.getElementById('ticket-message-mode');
  const ticket = selectedTicketSummary;
  const replyText = input.value.trim();
  const mode = modeSelect.value;
  if (!ticket || !replyText || ticketActionInProgress) return;
  if (mode === 'reply' && !await confirmMemberReply()) return;

  ticketActionInProgress = true;
  button.disabled = true;
  closeButton.disabled = true;
  modeSelect.disabled = true;
  input.disabled = true;
  status.dataset.error = 'false';
  status.textContent = mode === 'staff-chat' ? 'Sending staff message…' : 'Sending reply…';
  try {
    const request = mode === 'staff-chat'
      ? window.hoedown.sendTicketStaffMessage
      : window.hoedown.sendTicketReply;
    const result = await request({
      collectionName: ticket.collectionName,
      ticketId: ticket.ticketId,
      ...(mode === 'staff-chat' ? { messageText: replyText } : { replyText })
    });
    if (!result.ok) {
      status.dataset.error = 'true';
      status.textContent = result.error ||
        (mode === 'staff-chat' ? 'Could not send this staff message.' : 'Could not send this reply.');
      if (result.partial) input.value = '';
      return;
    }

    input.value = '';
    status.textContent = mode === 'staff-chat'
      ? `Staff message sent as ${result.authorName}.`
      : `Reply sent as ${result.authorName}.`;
    if (selectedTicketSummary?.collectionName === ticket.collectionName &&
        selectedTicketSummary?.ticketId === ticket.ticketId &&
        !document.getElementById('ticket-detail-view').hidden) {
      void openTicket(ticket, { preserveScroll: true });
    }
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message ||
      (mode === 'staff-chat' ? 'Could not send this staff message.' : 'Could not send this reply.');
  } finally {
    ticketActionInProgress = false;
    button.disabled = false;
    closeButton.disabled = false;
    modeSelect.disabled = false;
    input.disabled = false;
  }
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

document.getElementById('add-profile').addEventListener('click', async () => {
  const button = document.getElementById('add-profile');
  button.disabled = true;
  profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = true; });
  try {
    applyAuthState(await window.hoedown.createProfile());
  } catch (error) {
    connection.textContent = error.message || 'Could not create a profile.';
    connection.hidden = false;
  } finally {
    if (!profilePicker.hidden) {
      button.disabled = false;
      profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = false; });
    }
  }
});

const profileDeleteDialog = document.getElementById('profile-delete-confirmation');
profileDeleteDialog.addEventListener('close', () => {
  profilePendingDeletion = null;
});
document.getElementById('cancel-profile-delete').addEventListener('click', () => {
  profileDeleteDialog.close();
});
document.getElementById('confirm-profile-delete').addEventListener('click', async (event) => {
  if (!profilePendingDeletion) return;
  const button = event.currentTarget;
  const profile = profilePendingDeletion;
  profilePendingDeletion = null;
  button.disabled = true;
  profileDeleteDialog.close();
  profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = true; });
  showStatus('Deleting saved profile…');
  try {
    const result = await window.hoedown.deleteProfile(profile.id);
    applyAuthState(result);
    if (result.profileDeleted) {
      showStatus('Profile deleted from this device. The account and service session were not changed.');
    }
  } catch (error) {
    showStatus(error.message || 'Could not delete the saved profile.');
    profileList.querySelectorAll('button').forEach((choice) => { choice.disabled = false; });
  } finally {
    button.disabled = false;
  }
});

async function returnToProfiles(button) {
  button.disabled = true;
  resetToken = null;
  passwordForm.reset();
  try {
    applyAuthState(await window.hoedown.backToProfiles());
  } catch (error) {
    showStatus(error.message || 'Could not return to profiles.');
  } finally {
    button.disabled = false;
  }
}

document.getElementById('back-to-profiles').addEventListener('click', (event) => {
  void returnToProfiles(event.currentTarget);
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
  document.getElementById('account-settings-dialog').close();
  try {
    const result = await window.hoedown.logout();
    applyAuthState(result);
    showStatus(result.warning || 'Signed out.');
  } catch (error) {
    showStatus(error.message || 'Could not sign out.');
  }
});

document.getElementById('open-password-form').addEventListener('click', () => {
  document.getElementById('account-settings-dialog').close();
  selfPasswordForm.hidden = !selfPasswordForm.hidden;
  showStatus('');
});

const accountSettingsDialog = document.getElementById('account-settings-dialog');
document.getElementById('open-account-settings').addEventListener('click', () => {
  accountSettingsDialog.showModal();
});
document.getElementById('close-account-settings').addEventListener('click', () => {
  accountSettingsDialog.close();
});
document.getElementById('switch-account').addEventListener('click', (event) => {
  accountSettingsDialog.close();
  void returnToProfiles(event.currentTarget);
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
window.hoedown.onRoundActionStatus(applyRoundActionState);
window.hoedown.onRoundDraftUpdated(() => {
  void refreshRoundDraftStatus();
});
window.hoedown.onStatus(applyAuthState);
setInterval(() => {
  if (signedInPanel.hidden || document.getElementById('rounds-view').hidden ||
      roundDraftActionPending) {
    return;
  }
  if (roundPreviewOpen) void renewRoundDraftViewerPresence();
  else void refreshRoundDraftStatus();
}, 15_000);
window.hoedown.getStatus()
  .then(applyAuthState)
  .catch((error) => applyAuthState({ signedIn: false, error: error.message }));
