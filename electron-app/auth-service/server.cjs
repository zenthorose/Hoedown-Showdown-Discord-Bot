const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { generatePassword } = require('./password.cjs');
const { createUpdateFeed } = require('./update-feed.cjs');

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const RESET_TTL_SECONDS = 15 * 60;
const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeToken(payload, secret, now = Math.floor(Date.now() / 1000), ttl = SESSION_TTL_SECONDS) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    sub: payload.sub,
    ver: payload.ver,
    deviceId: payload.deviceId,
    purpose: payload.purpose,
    iat: now,
    exp: now + ttl
  })).toString('base64url');
  const unsigned = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function readToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT' ||
        typeof payload.sub !== 'string' || !ObjectId.isValid(payload.sub) ||
        !Number.isSafeInteger(payload.ver) || !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
        !DEVICE_ID_PATTERN.test(payload.deviceId || '') ||
        !['session', 'password-change'].includes(payload.purpose)) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeAppVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return version.length > 0 && version.length <= 64 &&
    /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)
    ? version
    : null;
}

function normalizeDevice(input) {
  if (!input || !DEVICE_ID_PATTERN.test(input.deviceId || '') ||
      !DEVICE_ID_PATTERN.test(input.launchId || '') ||
      typeof input.deviceName !== 'string' || input.deviceName.trim().length < 1 ||
      input.deviceName.trim().length > 128 || /[\u0000-\u001f\u007f]/.test(input.deviceName) ||
      typeof input.platform !== 'string' || !/^[a-z0-9._-]{1,32}$/i.test(input.platform)) {
    throw new TypeError('Valid device information is required.');
  }
  return {
    deviceId: input.deviceId.toLowerCase(),
    launchId: input.launchId.toLowerCase(),
    deviceName: input.deviceName.trim(),
    platform: input.platform
  };
}

function bearerToken(req) {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;
}

function createApp({ users, devices, audit, jwtSecret, adminApiKey, dummyPasswordHash, updateFeed }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '8kb' }));

  const limited = (limit) => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });
  const sendError = (res, error, message) => {
    console.error(message, error);
    return res.status(503).json({ error: 'The service is temporarily unavailable. Please try again.' });
  };
  const recordAdminAction = async (action, username) => {
    try {
      await audit.insertOne({ actor: 'admin', action, username, at: new Date() });
      return true;
    } catch (error) {
      console.error(`Admin audit write failed for ${action}:`, error);
      return false;
    }
  };
  const authorizeAdmin = (req, res) => {
    if (typeof adminApiKey !== 'string' || adminApiKey.length < 32) {
      res.status(503).json({ error: 'Admin account management is not configured.' });
      return false;
    }
    const supplied = Buffer.from(bearerToken(req) || '', 'utf8');
    const expected = Buffer.from(adminApiKey, 'utf8');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: 'Admin authorization failed.' });
      return false;
    }
    return true;
  };
  const readSession = async (req, res, allowPasswordChange = false) => {
    const payload = readToken(bearerToken(req), jwtSecret);
    if (!payload || (!allowPasswordChange && payload.purpose !== 'session')) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return null;
    }
    const user = await users.findOne({ _id: new ObjectId(payload.sub) });
    if (!user || user.active === false || user.tokenVersion !== payload.ver ||
        (user.activeDeviceId && user.activeDeviceId !== payload.deviceId)) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return null;
    }
    return { payload, user };
  };
  const adminMutationLimit = limited(10);

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  app.get('/api/app-updates/:channel/latest.yml', limited(60), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!updateFeed || req.params.channel !== process.env.APP_UPDATE_CHANNEL) {
        return res.status(404).json({ error: 'No update is available on this channel.' });
      }
      const manifest = await updateFeed.latestManifest(req.params.channel);
      res.set('Cache-Control', 'private, no-store');
      return res.type('application/yaml').status(200).send(manifest);
    } catch (error) {
      return sendError(res, error, 'App update manifest lookup failed:');
    }
  });

  app.post('/api/auth/login', limited(10), async (req, res) => {
    const username = normalizeUsername(req.body && req.body.username);
    const password = req.body && req.body.password;
    if (!USERNAME_PATTERN.test(username) || typeof password !== 'string' ||
        password.length < 1 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Enter a valid username and password.' });
    }
    let device;
    try {
      device = normalizeDevice(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const user = await users.findOne({ username });
      const passwordMatches = await bcrypt.compare(
        password,
        user && typeof user.passwordHash === 'string' ? user.passwordHash : dummyPasswordHash
      );
      if (!user || user.active === false || !passwordMatches) {
        return res.status(401).json({ error: 'Username or password is incorrect.' });
      }

      const nextVersion = (Number.isSafeInteger(user.tokenVersion) ? user.tokenVersion : 0) + 1;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
      const appVersion = normalizeAppVersion(req.body.appVersion);
      const update = {
        $set: {
          tokenVersion: nextVersion,
          lastLoginAt: now,
          ...(appVersion ? { lastAppVersion: appVersion } : {}),
          activeDeviceId: device.deviceId,
          activeSessionExpiresAt: expiresAt
        },
        $unset: {}
      };
      if (user.mustChangePassword === true) {
        delete update.$set.activeDeviceId;
        delete update.$set.activeSessionExpiresAt;
        update.$unset.activeDeviceId = '';
        update.$unset.activeSessionExpiresAt = '';
      }
      const changed = await users.updateOne(
        { _id: user._id, tokenVersion: user.tokenVersion || 0, active: { $ne: false }, passwordHash: user.passwordHash },
        update
      );
      if (!changed.matchedCount) {
        return res.status(401).json({ error: 'Sign-in could not be completed. Please try again.' });
      }

      const deviceEntry = await devices.findOne({ userId: user._id, deviceId: device.deviceId });
      const deviceUpdate = {
        userId: user._id,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        platform: device.platform,
        firstSeenAt: deviceEntry ? deviceEntry.firstSeenAt : now,
        firstIpAddress: deviceEntry ? deviceEntry.firstIpAddress : req.ip,
        firstLoginAt: deviceEntry && deviceEntry.firstLoginAt ? deviceEntry.firstLoginAt : now,
        lastSeenAt: now,
        lastLoginAt: now,
        lastLaunchAt: now,
        lastLaunchId: device.launchId,
        lastIpAddress: req.ip,
        ...(appVersion ? { lastAppVersion: appVersion } : {})
      };
      await devices.updateOne(
        { userId: user._id, deviceId: device.deviceId },
        {
          $set: deviceUpdate,
          $inc: { loginCount: 1, ...(deviceEntry && deviceEntry.lastLaunchId === device.launchId ? {} : { launchCount: 1 }) }
        },
        { upsert: true }
      );

      if (user.mustChangePassword === true) {
        const resetToken = makeToken({
          sub: user._id.toString(),
          ver: nextVersion,
          deviceId: device.deviceId,
          purpose: 'password-change'
        }, jwtSecret, Math.floor(now.getTime() / 1000), RESET_TTL_SECONDS);
        return res.status(200).json({ passwordChangeRequired: true, resetToken });
      }
      const token = makeToken({
        sub: user._id.toString(),
        ver: nextVersion,
        deviceId: device.deviceId,
        purpose: 'session'
      }, jwtSecret, Math.floor(now.getTime() / 1000));
      return res.status(200).json({ token, username, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      return sendError(res, error, 'Authentication lookup failed:');
    }
  });

  app.post('/api/auth/change-password', limited(10), async (req, res) => {
    const payload = readToken(bearerToken(req), jwtSecret);
    if (!payload) return res.status(401).json({ error: 'Password-change request expired. Please sign in again.' });
    if (!validPassword(req.body && req.body.password)) {
      return res.status(400).json({ error: 'New password must be at least 12 characters and no more than 72 UTF-8 bytes.' });
    }
    try {
      const user = await users.findOne({ _id: new ObjectId(payload.sub) });
      if (!user || user.active === false || user.tokenVersion !== payload.ver ||
          user.activeDeviceId && user.activeDeviceId !== payload.deviceId) {
        return res.status(401).json({ error: 'Password-change request expired. Please sign in again.' });
      }
      const forcedChange = payload.purpose === 'password-change';
      if (forcedChange && user.mustChangePassword !== true) {
        return res.status(401).json({ error: 'Password-change request expired. Please sign in again.' });
      }
      if (!forcedChange) {
        if (typeof req.body.currentPassword !== 'string' ||
            !await bcrypt.compare(req.body.currentPassword, user.passwordHash)) {
          return res.status(401).json({ error: 'Current password is incorrect.' });
        }
      }
      const sessionIssuedAt = Math.floor(Date.now() / 1000);
      const update = {
        $set: { passwordHash: await bcrypt.hash(req.body.password, 12), mustChangePassword: false },
        $inc: { tokenVersion: 1 }
      };
      if (forcedChange) update.$unset = { activeDeviceId: '', activeSessionExpiresAt: '' };
      else update.$set.activeSessionExpiresAt = new Date((sessionIssuedAt + SESSION_TTL_SECONDS) * 1000);
      const result = await users.updateOne(
        { _id: user._id, tokenVersion: payload.ver, passwordHash: user.passwordHash, active: { $ne: false } },
        update
      );
      if (!result.matchedCount) return res.status(401).json({ error: 'Password-change request expired. Please sign in again.' });
      if (forcedChange) return res.status(200).json({ passwordChanged: true });

      const nextVersion = payload.ver + 1;
      const token = makeToken({
        sub: user._id.toString(),
        ver: nextVersion,
        deviceId: payload.deviceId,
        purpose: 'session'
      }, jwtSecret, sessionIssuedAt);
      return res.status(200).json({ passwordChanged: true, token, sessionsRevoked: true });
    } catch (error) {
      return sendError(res, error, 'Password change failed:');
    }
  });

  app.get('/api/auth/session', async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      let device;
      try {
        device = normalizeDevice({
          deviceId: req.get('x-app-device-id'),
          launchId: req.get('x-app-launch-id'),
          deviceName: req.get('x-app-device-name'),
          platform: req.get('x-app-platform')
        });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (device.deviceId !== session.payload.deviceId) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      }
      const now = new Date();
      const deviceResult = await devices.updateOne(
        { userId: session.user._id, deviceId: device.deviceId },
        {
          $set: {
            deviceName: device.deviceName,
            platform: device.platform,
            lastSeenAt: now,
            lastIpAddress: req.ip,
            ...(normalizeAppVersion(req.get('x-app-version'))
              ? { lastAppVersion: normalizeAppVersion(req.get('x-app-version')) }
              : {})
          },
          $setOnInsert: { userId: session.user._id, deviceId: device.deviceId, firstSeenAt: now, firstIpAddress: req.ip }
        },
        { upsert: true }
      );
      if (req.get('x-app-launch') === 'true' && deviceResult) {
        await devices.updateOne(
          { userId: session.user._id, deviceId: device.deviceId, lastLaunchId: { $ne: device.launchId } },
          {
            $set: { lastLaunchAt: now, lastLaunchId: device.launchId },
            $inc: { launchCount: 1 }
          }
        );
        const appVersion = normalizeAppVersion(req.get('x-app-version'));
        await users.updateOne(
          { _id: session.user._id, tokenVersion: session.payload.ver },
          { $set: { lastLoginAt: now, ...(appVersion ? { lastAppVersion: appVersion } : {}) } }
        );
      }
      return res.status(200).json({
        username: session.user.username,
        expiresAt: new Date(session.payload.exp * 1000).toISOString()
      });
    } catch (error) {
      return sendError(res, error, 'Session check failed:');
    }
  });

  app.post('/api/auth/logout', limited(60), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      const result = await users.updateOne(
        { _id: session.user._id, tokenVersion: session.payload.ver },
        { $inc: { tokenVersion: 1 }, $unset: { activeDeviceId: '', activeSessionExpiresAt: '' } }
      );
      if (!result.matchedCount) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      await devices.updateOne(
        { userId: session.user._id, deviceId: session.payload.deviceId },
        { $set: { lastLogoutAt: new Date(), lastSeenAt: new Date() } }
      );
      return res.status(200).json({ loggedOut: true });
    } catch (error) {
      return sendError(res, error, 'Session sign-out failed:');
    }
  });

  app.get('/api/admin/users', limited(60), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    try {
      const accounts = await users.find({}, {
        projection: { _id: 0, username: 1, active: 1, createdAt: 1, lastLoginAt: 1, lastAppVersion: 1 }
      }).sort({ username: 1 }).toArray();
      return res.status(200).json({
        accounts: accounts.map((item) => ({
          username: item.username,
          active: item.active !== false,
          createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : null,
          lastLoginAt: item.lastLoginAt instanceof Date ? item.lastLoginAt.toISOString() : null,
          lastAppVersion: typeof item.lastAppVersion === 'string' ? item.lastAppVersion : null
        }))
      });
    } catch (error) {
      return sendError(res, error, 'Admin account listing failed:');
    }
  });

  app.get('/api/admin/users/:username/devices', limited(60), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const username = normalizeUsername(req.params.username);
    if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'A valid username is required.' });
    try {
      const user = await users.findOne({ username });
      if (!user) return res.status(404).json({ error: 'Account was not found.' });
      const history = await devices.find({ userId: user._id }, {
        projection: { _id: 0, userId: 0 }
      }).sort({ lastSeenAt: -1 }).toArray();
      const sessionExpiry = user.activeSessionExpiresAt instanceof Date
        ? user.activeSessionExpiresAt.getTime()
        : Date.parse(user.activeSessionExpiresAt);
      return res.status(200).json({
        username,
        devices: history.map((entry) => ({
          ...entry,
          isCurrent: user.active !== false && user.activeDeviceId === entry.deviceId &&
            Number.isFinite(sessionExpiry) && sessionExpiry > Date.now(),
          sessionExpiresAt: user.activeDeviceId === entry.deviceId &&
            Number.isFinite(sessionExpiry) && sessionExpiry > Date.now()
            ? new Date(sessionExpiry)
            : null
        }))
      });
    } catch (error) {
      return sendError(res, error, 'Admin device listing failed:');
    }
  });

  app.post('/api/admin/users', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const username = normalizeUsername(req.body && req.body.username);
    if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'Username must be 1-64 letters, numbers, dots, underscores, or hyphens.' });
    try {
      const password = generatePassword();
      await users.insertOne({
        username,
        passwordHash: await bcrypt.hash(password, 12),
        active: true,
        tokenVersion: 0,
        mustChangePassword: true,
        createdAt: new Date()
      });
      const auditLogged = await recordAdminAction('create-account', username);
      return res.status(201).json({ username, password, auditLogged });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'That username already exists.' });
      return sendError(res, error, 'Admin account creation failed:');
    }
  });

  app.post('/api/admin/users/:action(set-active|revoke-sessions|reset-password)', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const action = req.params.action;
    const username = normalizeUsername(req.body && req.body.username);
    if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'A valid username is required.' });
    if (!['set-active', 'revoke-sessions', 'reset-password'].includes(action)) {
      return res.status(404).json({ error: 'Admin action not found.' });
    }
    try {
      let update;
      let response = { username };
      if (action === 'set-active') {
        if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active status must be true or false.' });
        update = req.body.active
          ? { $set: { active: true } }
          : { $set: { active: false }, $inc: { tokenVersion: 1 }, $unset: { activeDeviceId: '', activeSessionExpiresAt: '' } };
        response.active = req.body.active;
        response.sessionsRevoked = !req.body.active;
      } else if (action === 'revoke-sessions') {
        update = { $inc: { tokenVersion: 1 }, $unset: { activeDeviceId: '', activeSessionExpiresAt: '' } };
        response.sessionsRevoked = true;
      } else {
        const password = generatePassword();
        update = {
          $set: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true },
          $inc: { tokenVersion: 1 },
          $unset: { activeDeviceId: '', activeSessionExpiresAt: '' }
        };
        response.password = password;
        response.sessionsRevoked = true;
      }
      const result = await users.updateOne({ username }, update);
      if (!result.matchedCount) return res.status(404).json({ error: 'Account was not found.' });
      response.auditLogged = await recordAdminAction(action, username);
      return res.status(200).json(response);
    } catch (error) {
      return sendError(res, error, `Admin ${action} failed:`);
    }
  });

  app.post('/api/admin/users/revoke-device', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const username = normalizeUsername(req.body && req.body.username);
    const deviceId = typeof req.body.deviceId === 'string' ? req.body.deviceId.toLowerCase() : '';
    if (!USERNAME_PATTERN.test(username) || !DEVICE_ID_PATTERN.test(deviceId)) {
      return res.status(400).json({ error: 'A valid username and device ID are required.' });
    }
    try {
      const user = await users.findOne({ username });
      if (!user) return res.status(404).json({ error: 'Account was not found.' });
      const device = await devices.findOne({ userId: user._id, deviceId });
      if (!device) return res.status(404).json({ error: 'Device was not found.' });
      const sessionRevoked = user.activeDeviceId === deviceId;
      if (sessionRevoked) {
        await users.updateOne(
          { _id: user._id, activeDeviceId: deviceId },
          { $inc: { tokenVersion: 1 }, $unset: { activeDeviceId: '', activeSessionExpiresAt: '' } }
        );
        const revokedAt = new Date();
        await devices.updateOne(
          { userId: user._id, deviceId },
          { $set: { lastLogoutAt: revokedAt, lastSeenAt: revokedAt } }
        );
      }
      const auditLogged = sessionRevoked
        ? await recordAdminAction('revoke-device-session', username)
        : true;
      return res.status(200).json({ username, deviceId, sessionRevoked, auditLogged });
    } catch (error) {
      return sendError(res, error, 'Admin device revocation failed:');
    }
  });

  app.get('/api/admin/audit', limited(60), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const { from, to, search: rawSearch } = req.query;
    if ((from !== undefined && typeof from !== 'string') ||
        (to !== undefined && typeof to !== 'string') ||
        (rawSearch !== undefined && (typeof rawSearch !== 'string' || rawSearch.length > 64))) {
      return res.status(400).json({ error: 'Audit filters are invalid.' });
    }
    const fromDate = from === undefined ? null : new Date(from);
    const toDate = to === undefined ? null : new Date(to);
    if ((fromDate && Number.isNaN(fromDate.getTime())) ||
        (toDate && Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
    }
    if (typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) &&
        fromDate.toISOString().slice(0, 10) !== from) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
    }
    if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) &&
        toDate.toISOString().slice(0, 10) !== to) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
    }
    if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toDate.setUTCDate(toDate.getUTCDate() + 1);
    }
    if (fromDate && toDate && fromDate >= toDate) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
    }
    const search = typeof rawSearch === 'string' ? rawSearch.trim() : '';
    const filter = {};
    if (fromDate || toDate) {
      filter.at = {};
      if (fromDate) filter.at.$gte = fromDate;
      if (toDate) filter.at.$lt = toDate;
    }
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (search) {
      filter.$or = [
        { username: { $regex: escapedSearch, $options: 'i' } },
        { action: { $regex: escapedSearch, $options: 'i' } }
      ];
    }
    try {
      const events = await audit.find(filter, {
        projection: { _id: 0, actor: 1, action: 1, username: 1, at: 1 }
      }).sort({ at: -1 }).limit(1001).toArray();
      return res.status(200).json({
        events: events.slice(0, 1000).map((event) => ({
          actor: event.actor,
          action: event.action,
          username: event.username,
          at: event.at instanceof Date ? event.at.toISOString() : null
        })),
        truncated: events.length > 1000
      });
    } catch (error) {
      return sendError(res, error, 'Admin audit search failed:');
    }
  });

  return app;
}

async function createRuntime() {
  const { MONGODB_URI, MONGODB_DB, JWT_SECRET, ADMIN_API_KEY } = process.env;
  if (!MONGODB_URI || !MONGODB_DB || !JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('Set MONGODB_URI, MONGODB_DB, and a JWT_SECRET of at least 32 characters.');
  }
  if (!ADMIN_API_KEY || ADMIN_API_KEY.length < 32) {
    throw new Error('Set an ADMIN_API_KEY of at least 32 characters.');
  }
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const database = client.db(MONGODB_DB);
    const users = database.collection('users');
    const devices = database.collection('userDevices');
    const audit = database.collection('adminAudit');
    await users.createIndex({ username: 1 }, { unique: true });
    await devices.createIndex({ userId: 1, deviceId: 1 }, { unique: true });
    await devices.createIndex({ userId: 1, lastSeenAt: -1 });
    await audit.createIndex({ at: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS });
    const dummyPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    return {
      app: createApp({
        users,
        devices,
        audit,
        jwtSecret: JWT_SECRET,
        adminApiKey: ADMIN_API_KEY,
        dummyPasswordHash,
        updateFeed: createUpdateFeed()
      }),
      close: () => client.close()
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const runtime = await createRuntime();
  const server = runtime.app.listen(port, '0.0.0.0', () => console.log(`Authentication service listening on port ${port}`));
  const shutdown = async () => {
    server.close(async () => {
      await runtime.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Authentication service failed to start:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  createRuntime,
  makeToken,
  normalizeDevice,
  normalizeUsername,
  readToken,
  validPassword
};
