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

const deviceInfo = (deviceId, launchId) => ({
  deviceId,
  launchId,
  deviceName: 'Test device',
  platform: 'win32'
});

async function withServer(run, { memberChangeStream } = {}) {
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
  const members = new MemoryCollection([{
    _id: '123456789012345678',
    discordId: '123456789012345678',
    username: 'test.player',
    nickname: 'Test Player',
    region: 'East',
    steamId: 'steam-test',
    streamLink: 'https://example.test/player',
    gender: 'not exposed'
  }]);
  if (memberChangeStream) members.watch = () => memberChangeStream;
  const jwtSecret = 'test-secret-that-is-long-enough-to-sign-test-tokens';
  const app = createApp({
    users,
    devices,
    audit,
    members,
    jwtSecret,
    adminApiKey: 'test-admin-key-that-is-at-least-thirty-two-characters',
    dummyPasswordHash: await bcrypt.hash('not-a-real-password', 4)
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
  await withServer(async ({ baseUrl, password, members }) => {
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

test('authenticated member event streams publish sanitized MongoDB changes', async () => {
  const memberChangeStream = new EventEmitter();
  memberChangeStream.close = async () => memberChangeStream.emit('close');

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
    const initial = await reader.read();
    assert.match(decoder.decode(initial.value), /event: resync/);

    members.items[0].region = 'West';
    memberChangeStream.emit('change', {
      operationType: 'update',
      fullDocument: members.items[0]
    });
    const update = await reader.read();
    const updateText = decoder.decode(update.value);
    assert.match(updateText, /event: member/);
    assert.match(updateText, /"region":"West"/);
    assert.doesNotMatch(updateText, /not exposed/);
    await reader.cancel();
  }, { memberChangeStream });
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
