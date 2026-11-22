const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const test = require('node:test');
const { createApp, makeToken, normalizeUsername, readToken, validPassword } = require('../server.cjs');

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
    Object.assign(item, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete item[key];
    for (const [key, value] of Object.entries(update.$inc || {})) item[key] = (item[key] || 0) + value;
    return { matchedCount: 1 };
  }

  find(filter = {}) {
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
    mustChangePassword: false
  };
  const users = new MemoryCollection([user]);
  const devices = new MemoryCollection();
  const audit = new MemoryCollection();
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
    jwtSecret,
    adminApiKey: 'test-admin-key-that-is-at-least-thirty-two-characters',
    dummyPasswordHash: await bcrypt.hash('not-a-real-password', 4),
    updateDiscordNickname,
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
      userID: '345678901234567890',
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
    assert.equal(result.collectionCount, 4);
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
    assert.equal(openTickets.total, 1);
    assert.equal(openTickets.tickets[0].status, 'Open');
    assert.equal(openTickets.tickets[0].closedAt, '');

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
      timestamp: '11/21/2026, 03:00 PM'
    }]);

    const invalidCollection = await fetch(
      `${baseUrl}/api/tickets/users/cowboy/${firstTicketId.toHexString()}`,
      { headers }
    );
    assert.equal(invalidCollection.status, 404);
  }, { ticketDatabase });
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

test('authenticated event stream publishes member changes and Avoids refresh events', async () => {
  const memberChangeStream = new EventEmitter();
  memberChangeStream.close = async () => memberChangeStream.emit('close');
  const avoidsChangeStream = new EventEmitter();
  avoidsChangeStream.close = async () => avoidsChangeStream.emit('close');

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
    const initial = await readUntil(/event: avoids-resync/);
    assert.match(initial, /event: resync/);
    assert.match(initial, /event: avoids-resync/);

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
    await reader.cancel();
  }, { memberChangeStream, avoidsChangeStream });
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

test('admin audit accepts inclusive date filters and rejects invalid dates', async () => {
  await withServer(async ({ baseUrl }) => {
    const headers = { authorization: 'Bearer test-admin-key-that-is-at-least-thirty-two-characters' };
    const valid = await fetch(`${baseUrl}/api/admin/audit?from=2026-02-27&to=2026-02-28`, { headers });
    assert.equal(valid.status, 200);
    const invalid = await fetch(`${baseUrl}/api/admin/audit?from=2026-02-31`, { headers });
    assert.equal(invalid.status, 400);
  });
});
