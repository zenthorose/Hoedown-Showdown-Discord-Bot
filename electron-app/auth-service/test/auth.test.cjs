const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const test = require('node:test');
const { createApp, makeToken, normalizeUsername, readToken, validPassword } = require('../server.cjs');
const { DEFAULT_BOT_SETTINGS } = require('../../../database/botSettings');

class MemoryCollection {
  constructor(items = []) {
    this.items = items;
  }

  matches(item, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$ne' in value) return item[key] !== value.$ne;
      if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(item[key]);
      if (value instanceof ObjectId) return String(item[key]) === String(value);
      return item[key] === value;
    });
  }

  async findOne(filter) {
    return this.items.find((item) => this.matches(item, filter)) || null;
  }

  async insertOne(item) {
    this.items.push({ _id: new ObjectId(), ...item });
    return { insertedId: this.items[this.items.length - 1]._id };
  }

  async updateOne(filter, update, options = {}) {
    let item = this.items.find((entry) => this.matches(entry, filter));
    if (!item && options.upsert) {
      item = {};
      for (const [key, value] of Object.entries(filter)) {
        if (!(value && typeof value === 'object' && '$ne' in value)) item[key] = value;
      }
      this.items.push(item);
    }
    if (!item) return { matchedCount: 0 };
    let modifiedCount = 0;
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key.startsWith('messages.$[message].')) {
        const field = key.slice('messages.$[message].'.length);
        const arrayFilter = options.arrayFilters && options.arrayFilters[0] || {};
        const target = Array.isArray(item.messages)
          ? item.messages.find((message) => Object.entries(arrayFilter).every(([filterKey, filterValue]) =>
            message[filterKey.replace(/^message\./, '')] === filterValue))
          : null;
        if (target && target[field] !== value) {
          target[field] = value;
          modifiedCount += 1;
        }
      } else {
        const path = key.split('.');
        let target = item;
        for (const field of path.slice(0, -1)) {
          if (!target[field] || typeof target[field] !== 'object') target[field] = {};
          target = target[field];
        }
        if (target[path[path.length - 1]] !== value) modifiedCount += 1;
        target[path[path.length - 1]] = value;
      }
    }
    for (const key of Object.keys(update.$unset || {})) {
      const path = key.split('.');
      let target = item;
      for (const field of path.slice(0, -1)) {
        target = target[field];
        if (!target || typeof target !== 'object') break;
      }
      if (target) delete target[path[path.length - 1]];
    }
    for (const [key, value] of Object.entries(update.$inc || {})) {
      item[key] = (item[key] || 0) + value;
      modifiedCount += 1;
    }
    return { matchedCount: 1, modifiedCount };
  }

  find(filter = {}) {
    this.lastFindFilter = filter;
    let items = this.items.filter((item) => this.matches(item, filter));
    const cursor = {
      sort: () => cursor,
      limit: (count) => { items = items.slice(0, count); return cursor; },
      toArray: async () => items
    };
    return cursor;
  }
}

class MemoryTicketDatabase {
  constructor(collections = {}) {
    this.collections = new Map(Object.entries(collections).map(([name, items]) => [
      name,
      new MemoryCollection(items)
    ]));
  }

  listCollections(filter = {}) {
    const requestedName = filter.name;
    const matches = [...this.collections.keys()]
      .filter((name) => typeof requestedName === 'string'
        ? name === requestedName
        : requestedName && requestedName.$regex
          ? new RegExp(requestedName.$regex).test(name)
          : true)
      .map((name) => ({ name }));
    return { toArray: async () => matches };
  }

  collection(name) {
    return this.collections.get(name) || new MemoryCollection();
  }
}

const deviceInfo = (deviceId, launchId) => ({
  deviceId,
  launchId,
  deviceName: 'Test device',
  platform: 'win32'
});

async function withServer(run, options = {}) {
  const { memberChangeStream, avoidsChangeStream } = options;
  const discordNicknameUpdates = [];
  const username = 'cowboy';
  const password = 'InitialPassword!123';
  const user = {
    _id: new ObjectId(),
    username,
    passwordHash: await bcrypt.hash(password, 4),
    active: true,
    tokenVersion: 0,
    mustChangePassword: false,
    ...(options.discordId ? { discordId: options.discordId } : {})
  };
  const users = new MemoryCollection([user]);
  const devices = new MemoryCollection();
  const audit = new MemoryCollection();
  const botSettings = new MemoryCollection(options.botSettingsDocuments || []);
  const members = new MemoryCollection(options.memberRecords || [{
    _id: '123456789012345678',
    discordId: '123456789012345678',
    username: 'test.player',
    nickname: 'Test Player',
    region: 'East',
    steamId: 'steam-test',
    streamLink: 'https://example.test/player',
    gender: 'not exposed'
  }]);
  const avoids = new MemoryCollection(options.avoidDocuments || []);
  if (avoidsChangeStream) avoids.watch = () => avoidsChangeStream;
  const ticketDatabase = options.ticketDatabase || new MemoryTicketDatabase();
  const googleSheetsAvoidUpdates = [];
  const mongoAvoidUpdates = [];
  const avoidUpdateOrder = [];
  const updateAvoidsInGoogleSheets = options.updateAvoidsInGoogleSheets || (async (users) => {
    googleSheetsAvoidUpdates.push(users);
    avoidUpdateOrder.push('google-sheets');
    return { success: true, addedPairs: users.length - 1, skippedPairs: 0 };
  });
  const saveAvoidRelationships = options.saveAvoidRelationships || (async (users) => {
    mongoAvoidUpdates.push(users);
    avoidUpdateOrder.push('mongodb');
    return { collectionName: 'Avoids', relationshipCount: users.length - 1 };
  });
  if (memberChangeStream) members.watch = () => memberChangeStream;
  const updateDiscordNickname = options.updateDiscordNickname || (async (discordId, nickname) => {
    discordNicknameUpdates.push({ discordId, nickname });
  });
  const jwtSecret = 'test-secret-that-is-long-enough-to-sign-test-tokens';
  const app = createApp({
    users,
    devices,
    audit,
    members,
    avoids,
    ticketDatabase,
    botSettings,
    jwtSecret,
    adminApiKey: 'test-admin-key-that-is-at-least-thirty-two-characters',
    dummyPasswordHash: await bcrypt.hash('not-a-real-password', 4),
    updateDiscordNickname,
    getDiscordProfile: options.getDiscordProfile,
    sendTicketReply: options.sendTicketReply,
    sendTicketStaffMessage: options.sendTicketStaffMessage,
    syncTicketStaffChat: options.syncTicketStaffChat,
    editTicketReply: options.editTicketReply,
    closeTicket: options.closeTicket,
    grabRoundReactions: options.grabRoundReactions,
    canGrabRoundReactions: options.canGrabRoundReactions,
    updateAvoidsInGoogleSheets,
    saveAvoidRelationships
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    await run({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      user,
      users,
      devices,
      audit,
      botSettings,
      members,
      avoids,
      ticketDatabase,
      googleSheetsAvoidUpdates,
      mongoAvoidUpdates,
      avoidUpdateOrder,
      discordNicknameUpdates,
      password,
      jwtSecret,
      app
    });
  } finally {
    await app.locals.closeMembersLiveUpdates();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('admin bot settings require authorization and return the built-in defaults', async () => {
  await withServer(async ({ baseUrl }) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/bot-settings`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/api/admin/bot-settings`, {
      headers: { Authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters' }
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.settings, DEFAULT_BOT_SETTINGS);
    assert.equal(result.updatedAt, null);
    assert.equal(result.updatedBy, null);
  });
});

test('admin bot settings save complete boolean values and record an audit event', async () => {
  await withServer(async ({ baseUrl, audit, botSettings }) => {
    const settings = {
      grabReactions: { ...DEFAULT_BOT_SETTINGS.grabReactions, ENABLE_TEAM_CHECK_POSTING: false },
      approveRound: { ...DEFAULT_BOT_SETTINGS.approveRound, ENABLE_DISCORD_POSTING: false },
      hoedownReset: { ...DEFAULT_BOT_SETTINGS.hoedownReset, ENABLE_LOGGING: true },
      channels: {
        ...DEFAULT_BOT_SETTINGS.channels,
        LOG_CHANNEL_ID: '12345678901234567',
        roundChannels: { '1': '12345678901234568' },
        teamChannels: { 'Team A': '12345678901234569' }
      }
    };
    const response = await fetch(`${baseUrl}/api/admin/bot-settings`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ settings })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.settings, settings);
    assert.equal(result.auditLogged, true);
    assert.equal(botSettings.items[0]._id, 'global');
    assert.deepEqual(botSettings.items[0].settings, settings);
    assert.equal(audit.items.some((entry) =>
      entry.action === 'update-bot-settings' && entry.username === 'global'), true);
    const auditEntry = audit.items.find((entry) => entry.action === 'update-bot-settings');
    assert.ok(auditEntry.details.changedSettings.some((change) =>
      change.setting === 'approveRound.ENABLE_DISCORD_POSTING' && change.from === true && change.to === false));
    assert.ok(auditEntry.details.changedSettings.some((change) =>
      change.setting === 'channels.LOG_CHANNEL_ID' && change.from === '' && change.to === '12345678901234567'));

    const loaded = await fetch(`${baseUrl}/api/admin/bot-settings`, {
      headers: { Authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters' }
    });
    assert.deepEqual((await loaded.json()).settings, settings);

    const auditResponse = await fetch(`${baseUrl}/api/admin/audit`, {
      headers: { Authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters' }
    });
    const auditResult = await auditResponse.json();
    assert.deepEqual(auditResult.events[0].details, auditEntry.details);
  });
});

test('admin bot settings reject incomplete and non-boolean updates without saving', async () => {
  await withServer(async ({ baseUrl, audit, botSettings }) => {
    const response = await fetch(`${baseUrl}/api/admin/bot-settings`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        settings: {
          grabReactions: DEFAULT_BOT_SETTINGS.grabReactions,
          approveRound: { ...DEFAULT_BOT_SETTINGS.approveRound, ENABLE_DISCORD_POSTING: 'false' },
          hoedownReset: DEFAULT_BOT_SETTINGS.hoedownReset
        }
      })
    });
    assert.equal(response.status, 400);
    assert.equal(botSettings.items.length, 0);
    assert.equal(audit.items.length, 0);
  });
});

test('normalizes account names and enforces password requirements', () => {
  assert.equal(normalizeUsername('  CowBoy  '), 'cowboy');
  assert.equal(validPassword('a sufficiently long password'), true);
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('x'.repeat(73)), false);
});

test('signed sessions reject tampering and expiration', () => {
  const token = makeToken({
    sub: new ObjectId().toString(),
    ver: 4,
    deviceId: '01234567-89ab-42cd-8abc-0123456789ab',
    purpose: 'session'
  }, 'a-secret-that-is-long-enough-to-sign-test-tokens', 100, 60);
  assert.equal(readToken(token, 'a-secret-that-is-long-enough-to-sign-test-tokens', 120).ver, 4);
  assert.equal(readToken(token, 'a-secret-that-is-long-enough-to-sign-test-tokens', 161), null);
  assert.equal(readToken(`${token.slice(0, -1)}x`, 'a-secret-that-is-long-enough-to-sign-test-tokens', 120), null);
});

test('a later login invalidates the previously active session', async () => {
  await withServer(async ({ baseUrl, password }) => {
    const device = deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab');
    const login = async (launchId) => fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', password, ...deviceInfo(device.deviceId, launchId) })
    });
    const first = await (await login(device.launchId)).json();
    const second = await (await login('21234567-89ab-42cd-8abc-0123456789ab')).json();
    assert.equal(typeof first.token, 'string');
    assert.equal(typeof second.token, 'string');
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: {
        authorization: `Bearer ${first.token}`,
        'x-app-device-id': device.deviceId,
        'x-app-launch-id': device.launchId,
        'x-app-device-name': 'Test device',
        'x-app-platform': 'win32'
      }
    });
    assert.equal(response.status, 401);
  });
});

test('theme colors are authenticated account settings and can be reset', async () => {
  await withServer(async ({ baseUrl, password, user }) => {
    const colors = {
      background: '#101413',
      surface: '#171d19',
      accent: '#a8863b',
      accentText: '#f0d58f',
      text: '#f2f5ef',
      muted: '#a5aea6',
      border: '#536044'
    };
    const unauthorized = await fetch(`${baseUrl}/api/settings`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}` };

    const defaults = await fetch(`${baseUrl}/api/settings`, { headers });
    assert.equal(defaults.status, 200);
    assert.equal((await defaults.json()).themeColors, null);

    const saved = await fetch(`${baseUrl}/api/settings/theme-colors`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ colors })
    });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).themeColors, colors);
    assert.deepEqual(user.settings.themeColors, colors);

    const invalid = await fetch(`${baseUrl}/api/settings/theme-colors`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ colors: { ...colors, accent: 'gold' } })
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(user.settings.themeColors, colors);

    user.settings.notificationSound = 'future-preference';
    const reset = await fetch(`${baseUrl}/api/settings/theme-colors`, {
      method: 'DELETE',
      headers
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).themeColors, null);
    assert.equal(user.settings.themeColors, undefined);
    assert.equal(user.settings.notificationSound, 'future-preference');
  });
});

test('member directory requires a session and returns only approved profile fields', async () => {
  await withServer(async ({ baseUrl, password, members, discordNicknameUpdates }) => {
    const unauthorized = await fetch(`${baseUrl}/api/members`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });

    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/members`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(result.members, [{
      discordId: '123456789012345678',
      username: 'test.player',
      nickname: 'Test Player',
      region: 'East',
      steamId: 'steam-test',
      streamLink: 'https://example.test/player'
    }]);

    const unauthorizedEdit = await fetch(`${baseUrl}/api/members/123456789012345678`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'edited.player' })
    });
    assert.equal(unauthorizedEdit.status, 401);

    const edit = await fetch(`${baseUrl}/api/members/123456789012345678`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nickname: 'Edited Player',
        region: 'West',
        steamId: 'steam-updated',
        streamLink: 'https://example.test/edited'
      })
    });
    const edited = await edit.json();
    assert.equal(edit.status, 200);
    assert.deepEqual(edited.member, {
      discordId: '123456789012345678',
      username: 'test.player',
      nickname: 'Edited Player',
      region: 'West',
      steamId: 'steam-updated',
      streamLink: 'https://example.test/edited'
    });
    assert.deepEqual(discordNicknameUpdates, [{
      discordId: '123456789012345678',
      nickname: 'Edited Player'
    }]);
    assert.equal(members.items[0].gender, 'not exposed');

    const usernameEdit = await fetch(`${baseUrl}/api/members/123456789012345678`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ username: 'not-allowed' })
    });
    assert.equal(usernameEdit.status, 400);
    assert.equal(members.items[0].username, 'test.player');

    const invalidEdit = await fetch(`${baseUrl}/api/members/123456789012345678`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ streamLink: 'javascript:alert(1)' })
    });
    assert.equal(invalidEdit.status, 400);
    assert.equal(members.items[0].streamLink, 'https://example.test/edited');
  });
});

test('avoid directory requires a session and returns directional pairs with name fallbacks', async () => {
  await withServer(async ({ baseUrl, password }) => {
    const unauthorized = await fetch(`${baseUrl}/api/avoids`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/avoids`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(result.pairs, [{
      avoiderDiscordId: '123456789012345678',
      avoiderNickname: 'Test Player',
      avoiderUsername: 'test.player',
      avoiderName: 'Test Player',
      avoidedDiscordId: '345678901234567890',
      avoidedNickname: '',
      avoidedUsername: 'fallback.player',
      avoidedName: 'fallback.player'
    }, {
      avoiderDiscordId: '123456789012345678',
      avoiderNickname: 'Test Player',
      avoiderUsername: 'test.player',
      avoiderName: 'Test Player',
      avoidedDiscordId: '234567890123456789',
      avoidedNickname: 'Target Nick',
      avoidedUsername: 'target.player',
      avoidedName: 'Target Nick'
    }]);
  }, {
    avoidDocuments: [{
      _id: '123456789012345678',
      name: 'stale.avoider',
      avoids: [
        { discordId: '234567890123456789', name: 'old-target-name' },
        { discordId: '345678901234567890', name: 'fallback.player' }
      ]
    }],
    memberRecords: [{
      _id: '123456789012345678',
      discordId: '123456789012345678',
      username: 'test.player',
      nickname: 'Test Player'
    }, {
      _id: '234567890123456789',
      discordId: '234567890123456789',
      username: 'target.player',
      nickname: 'Target Nick'
    }]
  });
});

test('Rounds action requires a session and an allowed linked Discord role', async () => {
  let allowed = false;
  let generationCount = 0;
  await withServer(async ({ baseUrl, password }) => {
    const unauthorized = await fetch(`${baseUrl}/api/rounds/grab-reactions`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}` };

    const denied = await fetch(`${baseUrl}/api/rounds/grab-reactions`, {
      method: 'POST',
      headers
    });
    assert.equal(denied.status, 403);
    assert.equal(generationCount, 0);

    allowed = true;
    const response = await fetch(`${baseUrl}/api/rounds/grab-reactions`, {
      method: 'POST',
      headers
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(result, {
      round: 4,
      reactedPlayerCount: 6,
      eligiblePlayerCount: 5,
      excludedPlayerCount: 1,
      postingStatus: 'posted'
    });
    assert.equal(generationCount, 1);
  }, {
    discordId: '123456789012345678',
    canGrabRoundReactions: async () => allowed,
    grabRoundReactions: async () => {
      generationCount += 1;
      return {
        draft: {
          round: 4,
          reactedPlayerCount: 6,
          eligiblePlayerCount: 5,
          excludedPlayers: [{}]
        },
        postingStatus: 'posted'
      };
    }
  });
});

test('ticket archive requires a session, filters summaries, and returns selected transcripts', async () => {
  const firstTicketId = new ObjectId('656565656565656565656565');
  const secondTicketId = new ObjectId('666666666666666666666666');
  const ticketDatabase = new MemoryTicketDatabase({
    cowboy_Tickets: [{
      _id: firstTicketId,
      ticketID: 'urgent follow-up',
      username: 'cowboy',
      userID: '123456789012345678',
      createdAt: '11/21/2026, 03:00 PM',
      closedAt: '11/21/2026, 04:00 PM EST',
      status: 'Closed',
      staffIDs: ['987654321098765432'],
      messages: [{
        authorID: '123456789012345678',
        authorName: 'Cowboy',
        content: 'I need help.',
        timestamp: '11/21/2026, 03:00 PM'
      }]
    }, {
      _id: new ObjectId('696969696969696969696969'),
      ticketID: 'open ticket',
      username: 'cowboy',
      userID: '123456789012345678',
      createdAt: '11/22/2026, 01:00 PM',
      status: 'Open',
      staffIDs: []
    }],
    player_Tickets: [{
      _id: secondTicketId,
      ticketID: 'older ticket',
      username: 'player',
      userID: '234567890123456789',
      createdAt: '11/20/2026, 10:00 AM',
      status: 'Closed',
      staffIDs: []
    }],
    cowboy_old_Tickets: [{
      _id: new ObjectId('606060606060606060606060'),
      ticketID: 'earlier ticket',
      username: 'cowboy.old',
      userID: '123456789012345678',
      createdAt: '11/19/2026, 01:00 PM',
      status: 'Closed',
      staffIDs: []
    }],
    active_Tickets: [{
      _id: new ObjectId('686868686868686868686868'),
      ticketID: 'active ticket',
      username: 'active',
      userID: '345678901234567890',
      createdAt: '11/22/2026, 01:00 PM',
      status: 'Open',
      staffIDs: ['987654321098765432']
    }],
    'josé_Tickets': [{
      _id: new ObjectId('676767676767676767676767'),
      ticketID: 'unrelated archived ticket',
      username: 'josé',
      userID: '456789012345678901',
      createdAt: '11/21/2026, 01:00 PM',
      status: 'Closed',
      staffIDs: []
    }]
  });
  await withServer(async ({ baseUrl, password }) => {
    const unauthorized = await fetch(`${baseUrl}/api/tickets`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}` };
    const response = await fetch(
      `${baseUrl}/api/tickets?search=urgent&from=2026-11-21&to=2026-11-21`,
      { headers }
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(result.total, 1);
    assert.equal(result.collectionCount, 5);
    assert.deepEqual(result.tickets, [{
      collectionName: 'cowboy_Tickets',
      ticketId: firstTicketId.toHexString(),
      ticketID: 'urgent follow-up',
      username: 'cowboy',
      userID: '123456789012345678',
      createdAt: '11/21/2026, 03:00 PM',
      closedAt: '11/21/2026, 04:00 PM EST',
      status: 'Closed',
      staffIDs: ['987654321098765432']
    }]);

    const openTicketsResponse = await fetch(`${baseUrl}/api/tickets?search=Open`, { headers });
    const openTickets = await openTicketsResponse.json();
    assert.equal(openTicketsResponse.status, 200);
    assert.equal(openTickets.total, 2);
    assert.equal(openTickets.tickets.every((ticket) => ticket.status === 'Open'), true);

    const unauthorizedPeople = await fetch(`${baseUrl}/api/ticket-people`);
    assert.equal(unauthorizedPeople.status, 401);
    const peopleResponse = await fetch(`${baseUrl}/api/ticket-people?search=cowboy`, { headers });
    const peopleResult = await peopleResponse.json();
    assert.equal(peopleResponse.status, 200);
    assert.equal(peopleResult.total, 1);
    assert.deepEqual(peopleResult.people[0], {
      personId: '123456789012345678',
      userID: '123456789012345678',
      username: 'cowboy',
      latestCreatedAt: '11/22/2026, 01:00 PM',
      ticketCount: 3,
      openTicketCount: 1,
      closedTicketCount: 2,
      collectionNames: ['cowboy_Tickets', 'cowboy_old_Tickets']
    });

    const unauthorizedPersonHistory = await fetch(
      `${baseUrl}/api/ticket-people/123456789012345678/tickets`
    );
    assert.equal(unauthorizedPersonHistory.status, 401);
    const personTicketsResponse = await fetch(
      `${baseUrl}/api/ticket-people/123456789012345678/tickets`,
      { headers }
    );
    const personTickets = await personTicketsResponse.json();
    assert.equal(personTicketsResponse.status, 200);
    assert.equal(personTickets.total, 3);
    assert.deepEqual(personTickets.tickets.map((ticket) => ticket.status), ['Open', 'Closed', 'Closed']);

    const unauthorizedDetail = await fetch(
      `${baseUrl}/api/tickets/cowboy_Tickets/${firstTicketId.toHexString()}`
    );
    assert.equal(unauthorizedDetail.status, 401);

    const detailResponse = await fetch(
      `${baseUrl}/api/tickets/cowboy_Tickets/${firstTicketId.toHexString()}`,
      { headers }
    );
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.ticket.ticketID, 'urgent follow-up');
    assert.deepEqual(detail.ticket.messages, [{
      authorID: '123456789012345678',
      authorName: 'Cowboy',
      content: 'I need help.',
      timestamp: '11/21/2026, 03:00 PM',
      authorAvatarUrl: '',
      mirrorMessageID: '',
      editedByID: '',
      editedByName: '',
      editedAt: '',
      canEdit: false
    }]);

    const invalidCollection = await fetch(
      `${baseUrl}/api/tickets/users/cowboy/${firstTicketId.toHexString()}`,
      { headers }
    );
    assert.equal(invalidCollection.status, 404);
  }, { ticketDatabase });
});

test('ticket replies require a session, use the app username, and reject closed tickets', async () => {
  const openTicketId = new ObjectId();
  const closedTicketId = new ObjectId();
  const ticketDatabase = new MemoryTicketDatabase({
    'player_Tickets': [
      {
        _id: openTicketId,
        username: 'player',
        userID: '123456789012345678',
        ticketChannelID: '234567890123456789',
        status: 'Open',
        messages: [{
          authorID: '123456789012345678',
          authorName: 'player',
          authorAvatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/player.png',
          content: 'Hello',
          timestamp: '11/22/2026'
        }]
      },
      {
        _id: closedTicketId,
        username: 'player',
        userID: '123456789012345678',
        ticketChannelID: '234567890123456789',
        status: 'Closed'
      }
    ]
  });
  const replies = [];
  await withServer(async ({ baseUrl, password }) => {
    const body = JSON.stringify({ replyText: 'We can help with that.' });
    const unauthorized = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${openTicketId.toHexString()}/reply`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body }
    );
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const detailResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${openTicketId.toHexString()}`,
      { headers }
    );
    const detail = await detailResponse.json();
    assert.equal(detail.canReply, true);
    assert.equal(detail.ticket.messages[0].authorAvatarUrl, 'https://cdn.discordapp.com/avatars/123456789012345678/player.png');
    const openResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${openTicketId.toHexString()}/reply`,
      { method: 'POST', headers, body }
    );
    const openResult = await openResponse.json();
    assert.equal(openResponse.status, 200);
    assert.deepEqual(openResult, { authorName: 'linked#0001' });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].collectionName, 'player_Tickets');
    assert.equal(replies[0].appUsername, 'cowboy');
    assert.equal(replies[0].staffDiscordId, '123456789012345678');
    assert.equal(replies[0].replyText, 'We can help with that.');

    const closedResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${closedTicketId.toHexString()}/reply`,
      { method: 'POST', headers, body }
    );
    assert.equal(closedResponse.status, 409);
    assert.equal(replies.length, 1);
  }, {
    ticketDatabase,
    discordId: '123456789012345678',
    sendTicketReply: async (reply) => {
      replies.push(reply);
      return { ok: true, authorName: 'linked#0001' };
    }
  });

});

test('ticket replies require an administrator-linked Discord account', async () => {
  const openTicketId = new ObjectId();
  const ticketDatabase = new MemoryTicketDatabase({
    player_Tickets: [{
      _id: openTicketId,
        ticketID: 'player ticket',
        username: 'player',
        userID: '123456789012345678',
        ticketChannelID: '987654321098765432',
        status: 'Open',
        messages: []
      }]
  });
  let sendCalls = 0;
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'cowboy',
          password,
          ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
        })
    });
    const { token } = await login.json();
    const detailResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${openTicketId.toHexString()}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    assert.equal((await detailResponse.json()).canReply, false);
    const response = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${openTicketId.toHexString()}/reply`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ replyText: 'Reply without linked Discord' })
      }
    );
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /administrator must link/i);
    assert.equal(sendCalls, 0);
  }, {
    ticketDatabase,
    sendTicketReply: async () => {
      sendCalls += 1;
      return { ok: true };
    }
  });
});

test('staff chat is stored as internal channel content without invoking customer replies', async () => {
  const ticketId = new ObjectId();
  const staffId = '987654321098765432';
  const ticket = {
    _id: ticketId,
    ticketID: 'player ticket',
    username: 'player',
    userID: '123456789012345678',
    ticketChannelID: '234567890123456789',
    status: 'Open',
    staffIDs: [staffId],
    messages: []
  };
  const ticketDatabase = new MemoryTicketDatabase({ player_Tickets: [ticket] });
  const staffMessages = [];
  let replyCalls = 0;
  let syncCalls = 0;
  await withServer(async ({ baseUrl, password, user }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const sent = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/staff-chat`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageText: 'I will check this with the team.' })
      }
    );
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { authorName: 'linked#0001' });
    assert.equal(staffMessages.length, 1);
    assert.equal(staffMessages[0].staffDiscordId, staffId);
    assert.equal(staffMessages[0].messageText, 'I will check this with the team.');
    assert.equal(replyCalls, 0);

    const detailResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}?syncStaffChat=true`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(syncCalls, 1);
    assert.equal(detail.ticket.messages.length, 2);
    assert.ok(detail.ticket.messages.every((message) =>
      message.messageType === 'staff-chat' && message.canEdit === false));
    delete user.discordId;
    const unlinked = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/staff-chat`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageText: 'This should not be sent.' })
      }
    );
    assert.equal(unlinked.status, 409);
    assert.equal(staffMessages.length, 1);
    assert.equal(replyCalls, 0);
  }, {
    ticketDatabase,
    discordId: staffId,
    sendTicketReply: async () => {
      replyCalls += 1;
      return { ok: true, authorName: 'linked#0001' };
    },
    sendTicketStaffMessage: async ({ ticket: currentTicket, ...input }) => {
      staffMessages.push(input);
      currentTicket.messages.push({
        sourceMessageID: '456789012345678901',
        mirrorMessageID: '456789012345678901',
        authorID: input.staffDiscordId,
        authorName: 'linked#0001',
        messageType: 'staff-chat',
        content: input.messageText,
        timestamp: '11/22/2026, 12:00 AM'
      });
      return { ok: true, authorName: 'linked#0001' };
    },
    syncTicketStaffChat: async ({ ticket: currentTicket }) => {
      syncCalls += 1;
      currentTicket.messages.push({
        sourceMessageID: '345678901234567890',
        mirrorMessageID: '345678901234567890',
        authorID: staffId,
        authorName: 'linked#0001',
        messageType: 'staff-chat',
        content: 'Earlier internal message.',
        timestamp: '11/21/2026, 11:00 PM'
      });
      return { ok: true };
    }
  });
});

test('open tickets can be closed normally or silently by linked staff', async () => {
  const normalTicketId = new ObjectId();
  const silentTicketId = new ObjectId();
  const ticketDatabase = new MemoryTicketDatabase({
    player_Tickets: [
      {
        _id: normalTicketId,
        username: 'player',
        userID: '123456789012345678',
        ticketChannelID: '234567890123456789',
        status: 'Open'
      },
      {
        _id: silentTicketId,
        username: 'player',
        userID: '123456789012345678',
        ticketChannelID: '345678901234567890',
        status: 'Open'
      }
    ]
  });
  const closeCalls = [];
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const close = async (ticketId, mode) => fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/close`,
      { method: 'POST', headers, body: JSON.stringify({ mode }) }
    );

    const invalidMode = await close(normalTicketId, 'unexpected');
    assert.equal(invalidMode.status, 400);
    const normalResponse = await close(normalTicketId, 'normal');
    assert.equal(normalResponse.status, 200);
    assert.deepEqual(await normalResponse.json(), { mode: 'normal', warning: '' });
    const silentResponse = await close(silentTicketId, 'silent');
    assert.equal(silentResponse.status, 200);
    assert.deepEqual(await silentResponse.json(), { mode: 'silent', warning: '' });
    assert.deepEqual(closeCalls.map(({ mode }) => mode), ['normal', 'silent']);
    assert.ok(closeCalls.every(({ closedByID }) => closedByID === '123456789012345678'));
    assert.equal(ticketDatabase.collection('player_Tickets').items.every((ticket) => ticket.status === 'Closed'), true);

    const alreadyClosed = await close(normalTicketId, 'normal');
    assert.equal(alreadyClosed.status, 409);
    assert.equal(closeCalls.length, 2);
  }, {
    ticketDatabase,
    discordId: '123456789012345678',
    closeTicket: async ({ ticket, collectionName, mode, closedByID }) => {
      closeCalls.push({ ticket, collectionName, mode, closedByID });
      ticket.status = 'Closed';
      return { ok: true };
    }
  });
});

test('ticket closing requires an administrator-linked Discord account', async () => {
  const ticketId = new ObjectId();
  const ticketDatabase = new MemoryTicketDatabase({
    player_Tickets: [{
      _id: ticketId,
      userID: '123456789012345678',
      ticketChannelID: '234567890123456789',
      status: 'Open'
    }]
  });
  let closeCalls = 0;
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/close`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'silent' })
      }
    );
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /administrator must link/i);
    assert.equal(closeCalls, 0);
  }, {
    ticketDatabase,
    closeTicket: async () => {
      closeCalls += 1;
      return { ok: true };
    }
  });
});

test('staff replies can be edited in place, but customer messages cannot', async () => {
  const ticketId = new ObjectId();
  const staffId = '987654321098765432';
  const customerId = '123456789012345678';
  const staffMirrorId = '234567890123456789';
  const customerMirrorId = '345678901234567890';
  const ticket = {
    _id: ticketId,
    ticketID: 'player ticket',
    username: 'player',
    userID: customerId,
    ticketChannelID: '876543210987654321',
    status: 'Open',
    staffIDs: [staffId, customerId],
    messages: [
      {
        sourceMessageID: '456789012345678901',
        mirrorMessageID: staffMirrorId,
        authorID: staffId,
        authorName: 'helper#0001',
        content: 'Original staff reply',
        timestamp: '11/21/2026, 01:00 PM'
      },
      {
        sourceMessageID: '567890123456789012',
        mirrorMessageID: customerMirrorId,
        authorID: customerId,
        authorName: 'player#0001',
        content: 'Customer message',
        timestamp: '11/21/2026, 01:01 PM'
      }
    ]
  };
  const ticketDatabase = new MemoryTicketDatabase({ player_Tickets: [ticket] });
  const editCalls = [];
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const detailResponse = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}`,
      { headers }
    );
    const detail = await detailResponse.json();
    assert.equal(detail.ticket.messages[0].canEdit, true);
    assert.equal(detail.ticket.messages[1].canEdit, false);

    const edited = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/messages/${staffMirrorId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ replyText: 'Corrected staff reply' })
      }
    );
    assert.equal(edited.status, 200);
    assert.equal(ticket.messages[0].content, 'Corrected staff reply');
    assert.equal(ticket.messages[0].editedByID, staffId);
    assert.equal(ticket.messages[0].editedByName, 'cowboy#0001');
    assert.equal(ticket.messages[0].editedAt, editCalls[0].editedAt);
    assert.equal(editCalls.length, 1);
    assert.equal(editCalls[0].message.mirrorMessageID, staffMirrorId);
    assert.equal(editCalls[0].editorDiscordId, staffId);
    const refreshedTranscript = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}`,
      { headers }
    );
    const refreshedTicket = await refreshedTranscript.json();
    assert.equal(refreshedTicket.ticket.messages[0].editedByName, 'cowboy#0001');

    const customerEdit = await fetch(
      `${baseUrl}/api/tickets/player_Tickets/${ticketId.toHexString()}/messages/${customerMirrorId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ replyText: 'Attempt to edit customer' })
      }
    );
    assert.equal(customerEdit.status, 403);
    assert.equal(editCalls.length, 1);
  }, {
    ticketDatabase,
    discordId: staffId,
    editTicketReply: async (input) => {
      editCalls.push(input);
      return {
        ok: true,
        editedByID: input.editorDiscordId,
        editedByName: 'cowboy#0001',
        editedAt: input.editedAt
      };
    }
  });
});

test('avoid pairing creation updates Google Sheets before MongoDB using selected member usernames', async () => {
  await withServer(async ({
    baseUrl,
    password,
    googleSheetsAvoidUpdates,
    mongoAvoidUpdates,
    avoidUpdateOrder
  }) => {
    const unauthorized = await fetch(`${baseUrl}/api/avoids`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        avoiderDiscordId: '123456789012345678',
        avoidedDiscordIds: ['234567890123456789']
      })
    });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/avoids`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        avoiderDiscordId: '123456789012345678',
        avoidedDiscordIds: ['234567890123456789']
      })
    });
    const result = await response.json();
    const selectedUsers = [
      { id: '123456789012345678', username: 'test.player' },
      { id: '234567890123456789', username: 'target.player' }
    ];

    assert.equal(response.status, 200);
    assert.deepEqual(result, {
      success: true,
      googleSheets: { addedPairs: 1, skippedPairs: 0 },
      mongodb: { relationshipCount: 1 }
    });
    assert.deepEqual(googleSheetsAvoidUpdates, [selectedUsers]);
    assert.deepEqual(mongoAvoidUpdates, [selectedUsers]);
    assert.deepEqual(avoidUpdateOrder, ['google-sheets', 'mongodb']);
  }, {
    memberRecords: [{
      _id: '123456789012345678',
      discordId: '123456789012345678',
      username: 'test.player',
      nickname: 'Test Player'
    }, {
      _id: '234567890123456789',
      discordId: '234567890123456789',
      username: 'target.player',
      nickname: 'Target Player'
    }]
  });
});

test('avoid pairing rejects self-avoid requests before either write', async () => {
  await withServer(async ({ baseUrl, password, googleSheetsAvoidUpdates, mongoAvoidUpdates }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/avoids`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        avoiderDiscordId: '123456789012345678',
        avoidedDiscordIds: ['123456789012345678']
      })
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cannot also be selected/);
    assert.deepEqual(googleSheetsAvoidUpdates, []);
    assert.deepEqual(mongoAvoidUpdates, []);
  });
});

test('avoid pairing reports a partial Google Sheets update if MongoDB sync fails', async () => {
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/avoids`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        avoiderDiscordId: '123456789012345678',
        avoidedDiscordIds: ['234567890123456789']
      })
    });
    const result = await response.json();

    assert.equal(response.status, 502);
    assert.match(result.error, /Google Sheets updated, but MongoDB Avoids sync failed/);
  }, {
    memberRecords: [{
      _id: '123456789012345678',
      discordId: '123456789012345678',
      username: 'test.player'
    }, {
      _id: '234567890123456789',
      discordId: '234567890123456789',
      username: 'target.player'
    }],
    saveAvoidRelationships: async () => {
      throw new Error('test MongoDB failure');
    }
  });
});

test('avoid pairing does not update MongoDB when Google Sheets rejects the write', async () => {
  let mongoWriteAttempted = false;
  await withServer(async ({ baseUrl, password }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/avoids`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        avoiderDiscordId: '123456789012345678',
        avoidedDiscordIds: ['234567890123456789']
      })
    });

    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Google Sheets update failed/);
    assert.equal(mongoWriteAttempted, false);
  }, {
    memberRecords: [{
      _id: '123456789012345678',
      discordId: '123456789012345678',
      username: 'test.player'
    }, {
      _id: '234567890123456789',
      discordId: '234567890123456789',
      username: 'target.player'
    }],
    updateAvoidsInGoogleSheets: async () => {
      throw new Error('test Google Sheets failure');
    },
    saveAvoidRelationships: async () => {
      mongoWriteAttempted = true;
      return { collectionName: 'Avoids', relationshipCount: 1 };
    }
  });
});

test('a Discord nickname failure prevents the MongoDB profile update', async () => {
  const failure = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  await withServer(async ({ baseUrl, password, members }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'cowboy',
        password,
        ...deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab')
      })
    });
    const { token } = await login.json();
    const response = await fetch(`${baseUrl}/api/members/123456789012345678`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ nickname: 'New Nickname' })
    });
    const result = await response.json();

    assert.equal(response.status, 502);
    assert.match(result.error, /Manage Nicknames permission/);
    assert.equal(members.items[0].nickname, 'Test Player');
  }, {
    updateDiscordNickname: async () => {
      throw failure;
    }
  });
});

test('authenticated event stream publishes member changes and Avoids and Tickets refresh events', async () => {
  const memberChangeStream = new EventEmitter();
  memberChangeStream.close = async () => memberChangeStream.emit('close');
  const avoidsChangeStream = new EventEmitter();
  avoidsChangeStream.close = async () => avoidsChangeStream.emit('close');
  const ticketChangeStream = new EventEmitter();
  ticketChangeStream.close = async () => ticketChangeStream.emit('close');
  const ticketDatabase = new MemoryTicketDatabase();
  let ticketWatchPipeline;
  let ticketWatchCount = 0;
  ticketDatabase.watch = (pipeline) => {
    ticketWatchCount += 1;
    ticketWatchPipeline = pipeline;
    return ticketChangeStream;
  };

  await withServer(async ({ baseUrl, user, jwtSecret, members }) => {
    const unauthorized = await fetch(`${baseUrl}/api/members/stream`);
    assert.equal(unauthorized.status, 401);

    const token = makeToken({
      sub: user._id.toString(),
      ver: user.tokenVersion,
      deviceId: '01234567-89ab-42cd-8abc-0123456789ab',
      purpose: 'session'
    }, jwtSecret, Math.floor(Date.now() / 1000), 600);
    const response = await fetch(`${baseUrl}/api/members/stream`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamText = '';
    const readUntil = async (pattern) => {
      while (!pattern.test(streamText)) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        streamText += decoder.decode(chunk.value);
      }
      const received = streamText;
      streamText = '';
      return received;
    };
    const initial = await readUntil(/event: tickets-resync/);
    assert.match(initial, /event: resync/);
    assert.match(initial, /event: avoids-resync/);
    assert.match(initial, /event: tickets-resync/);
    assert.deepEqual(ticketWatchPipeline, [
      { $match: { 'ns.coll': { $regex: '^.*_Tickets$' } } }
    ]);

    members.items[0].region = 'West';
    memberChangeStream.emit('change', {
      operationType: 'update',
      fullDocument: members.items[0]
    });
    const updateText = await readUntil(/event: member/);
    assert.match(updateText, /event: member/);
    assert.match(updateText, /"region":"West"/);
    assert.doesNotMatch(updateText, /not exposed/);

    avoidsChangeStream.emit('change', { operationType: 'update' });
    const avoidsUpdate = await readUntil(/event: avoids-resync/);
    assert.match(avoidsUpdate, /event: avoids-resync/);

    ticketChangeStream.emit('change', {
      operationType: 'insert',
      ns: { coll: 'player_Tickets' }
    });
    const ticketUpdate = await readUntil(/event: tickets-resync/);
    assert.match(ticketUpdate, /event: tickets-resync/);

    ticketChangeStream.emit('change', {
      operationType: 'update',
      ns: { coll: 'player_Tickets' },
      updateDescription: { updatedFields: { 'messages.0.content': 'A reply.' } }
    });
    const messageUpdate = await readUntil(/event: ticket-message/);
    assert.match(messageUpdate, /event: ticket-message/);
    assert.match(messageUpdate, /"collectionName":"player_Tickets"/);

    ticketChangeStream.emit('close');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(ticketWatchCount, 1);

    ticketChangeStream.emit('error', new Error('simulated ticket stream failure'));
    const failedStreamResync = await readUntil(/event: tickets-resync/);
    assert.match(failedStreamResync, /event: tickets-resync/);
    await reader.cancel();
  }, { memberChangeStream, avoidsChangeStream, ticketDatabase });
});

test('admin temporary passwords require a password change before a session is granted', async () => {
  await withServer(async ({ baseUrl, user }) => {
    user.mustChangePassword = true;
    const device = deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab');
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', password: 'InitialPassword!123', ...device })
    });
    const result = await response.json();
    assert.equal(result.passwordChangeRequired, true);
    assert.equal(typeof result.resetToken, 'string');
    const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${result.resetToken}`
      },
      body: JSON.stringify({ password: 'NewPassword!4567' })
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), { passwordChanged: true });
  });
});

test('self-service password change rotates the session and invalidates the old token', async () => {
  await withServer(async ({ baseUrl, password }) => {
    const device = deviceInfo('01234567-89ab-42cd-8abc-0123456789ab', '11234567-89ab-42cd-8abc-0123456789ab');
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', password, ...device })
    });
    const original = await login.json();
    const changedResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${original.token}` },
      body: JSON.stringify({ currentPassword: password, password: 'ChangedPassword!789' })
    });
    const changed = await changedResponse.json();
    assert.equal(changedResponse.status, 200);
    assert.equal(changed.sessionsRevoked, true);
    assert.equal(typeof changed.token, 'string');

    const headers = {
      'x-app-device-id': device.deviceId,
      'x-app-launch-id': device.launchId,
      'x-app-device-name': device.deviceName,
      'x-app-platform': device.platform
    };
    const oldSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { ...headers, authorization: `Bearer ${original.token}` }
    });
    const newSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { ...headers, authorization: `Bearer ${changed.token}` }
    });
    assert.equal(oldSession.status, 401);
    assert.equal(newSession.status, 200);
  });
});

test('admin account creation returns a temporary password and disable revokes sessions', async () => {
  await withServer(async ({ baseUrl, user }) => {
    const authorization = 'Bearer test-admin-key-that-is-at-least-thirty-two-characters';
    const createdResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'new.rider' })
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.equal(created.username, 'new.rider');
    assert.equal(typeof created.password, 'string');

    const disabledResponse = await fetch(`${baseUrl}/api/admin/users/set-active`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', active: false })
    });
    assert.equal(disabledResponse.status, 200);
    assert.equal(user.active, false);
    assert.equal(user.tokenVersion, 1);
  });
});

test('admin can link and unlink a verified Discord profile', async () => {
  const authorization = 'Bearer test-admin-key-that-is-at-least-thirty-two-characters';
  await withServer(async ({ baseUrl, user }) => {
    const linked = await fetch(`${baseUrl}/api/admin/users/link-discord`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', discordId: '123456789012345678' })
    });
    assert.equal(linked.status, 200);
    assert.equal(user.discordId, '123456789012345678');
    assert.equal(user.discordUsername, 'verified-discord-user');
    assert.equal(user.discordAvatarUrl, 'https://cdn.discordapp.com/avatars/123456789012345678/avatar.png');

    const listed = await fetch(`${baseUrl}/api/admin/users`, { headers: { authorization } });
    const { accounts } = await listed.json();
    assert.equal(accounts[0].discordId, '123456789012345678');
    assert.equal(accounts[0].discordAvatarUrl, user.discordAvatarUrl);

    const unlinked = await fetch(`${baseUrl}/api/admin/users/link-discord`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'cowboy', discordId: '' })
    });
    assert.equal(unlinked.status, 200);
    assert.equal(user.discordId, undefined);
  }, {
    getDiscordProfile: async (discordId) => ({
      username: 'verified-discord-user',
      avatarUrl: `https://cdn.discordapp.com/avatars/${discordId}/avatar.png`
    })
  });
});

test('admin audit date filters use inclusive Eastern calendar days and reject invalid dates', async () => {
  await withServer(async ({ baseUrl, audit }) => {
    const headers = { authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters' };
    const valid = await fetch(`${baseUrl}/api/admin/audit?from=2026-02-27&to=2026-02-28`, { headers });
    assert.equal(valid.status, 200);
    assert.equal(audit.lastFindFilter.at.$gte.toISOString(), '2026-02-27T05:00:00.000Z');
    assert.equal(audit.lastFindFilter.at.$lt.toISOString(), '2026-03-01T05:00:00.000Z');

    const daylightSavingDate = await fetch(`${baseUrl}/api/admin/audit?from=2026-03-08&to=2026-03-08`, { headers });
    assert.equal(daylightSavingDate.status, 200);
    assert.equal(audit.lastFindFilter.at.$gte.toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(audit.lastFindFilter.at.$lt.toISOString(), '2026-03-09T04:00:00.000Z');

    const invalid = await fetch(`${baseUrl}/api/admin/audit?from=2026-02-31`, { headers });
    assert.equal(invalid.status, 400);
  });
});
