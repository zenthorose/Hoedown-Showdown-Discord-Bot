const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');
const { generatePassword } = require('./password.cjs');
const { createUpdateFeed } = require('./update-feed.cjs');
const { parseMemberListCsv } = require('../../database/memberListImport');
const {
  addAvoidRelationships,
  parseAvoidsCsv,
  parsePreviousPairingsCsv
} = require('../../database/pairingImport');
const {
  PAST_HOEDOWN_EVENTS,
  parsePastHoedownEventCsv,
  parsePastHoedownTeamsCsv
} = require('../../database/pastHoedownTeams');
const config = require('../../config.json');
const {
  addCurrentDraftFillerTeam,
  addCurrentDraftMemberToFillerSlot,
  deleteCurrentDraftFillerTeam,
  findNextRound,
  formatTeamCheckPreview,
  recordCurrentDraftReview,
  recordCurrentDraftViewer,
  replaceCurrentDraftPlayer,
  replaceCurrentDraftPlayerWithFiller,
  splitDiscordMessage,
  swapCurrentDraftPlayers,
  updateCurrentDraftViewerPresence
} = require('../../database/teamDrafts');
const { findLatestRoundOptInMessage } = require('../../utils/optInReactions');
const { TeamGenerationError, generateTeamDraftFromMessage } = require('../../utils/teamGeneration');
const {
  approveLatestRound,
  subscribeRoundApprovalUpdates
} = require('../../utils/roundApproval');
const { registerTeamCheckPreviewSync } = require('../../utils/teamCheckPreview');
const {
  BOT_SETTINGS_COLLECTION,
  BOT_SETTINGS_ID,
  normalizeStoredBotSettings,
  readBotSettings,
  validateBotSettings
} = require('../../database/botSettings');

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_CEREMONY_TTL_SECONDS = 5 * 60;
const ADMIN_HANDOFF_TTL_SECONDS = 60;
const RESET_TTL_SECONDS = 15 * 60;
const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const MAX_REPLACEMENT_CSV_BYTES = 10 * 1024 * 1024;
const BACKUP_HISTORY_COLLECTION = 'BackupHistory';
const REPLACEMENT_CSV_COLLECTIONS = new Set([
  'Members',
  'Avoids',
  'PreviousPairings',
  'PastHoedownTeams'
]);
const ROUND_DRAFT_VIEWER_TTL_MS = 45_000;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBER_ID_PATTERN = /^\d{17,20}$/;
const SUPPORT_REPLY_PREFIX = '📩 **Support Reply:** ';
const TICKET_PAGE_SIZE = 50;
const MEMBER_FIELD_LIMITS = {
  nickname: 32,
  region: 32,
  steamId: 128,
  streamLink: 2048
};
const EASTERN_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function serializeRoundDraft(draft, currentDiscordId, pairingRelations = { avoids: [], previousPairings: [] }) {
  const toIso = (value) => value instanceof Date
    ? value.toISOString()
    : typeof value === 'string'
      ? value
      : null;
  const activity = Array.isArray(draft.reviewActivity) ? draft.reviewActivity : [];
  const activeViewers = Object.values(draft.activeViewers || {}).filter((viewer) => {
    const lastSeenAt = new Date(viewer?.lastSeenAt || 0).getTime();
    return MEMBER_ID_PATTERN.test(String(viewer?.discordId || '')) &&
      Number.isFinite(lastSeenAt) &&
      Date.now() - lastSeenAt <= ROUND_DRAFT_VIEWER_TTL_MS;
  });
  const myReview = activity.find((entry) => entry.discordId === currentDiscordId);
  return {
    generationId: String(draft.generationId || ''),
    round: draft.round,
    status: draft.status,
    teams: (Array.isArray(draft.teams) ? draft.teams : []).map((team) => ({
      name: String(team.name || '').slice(0, 32),
      players: (Array.isArray(team.players) ? team.players : []).map((player) => ({
        discordId: String(player.discordId || ''),
        name: String(player.name || 'Unknown').slice(0, 100),
        region: String(player.region || '').slice(0, 32)
      }))
    })),
    checks: {
      final: {
        avoidConflicts: Array.isArray(draft.checks?.final?.avoidConflicts)
          ? draft.checks.final.avoidConflicts
          : [],
        previousConflicts: Array.isArray(draft.checks?.final?.previousConflicts)
          ? draft.checks.final.previousConflicts
          : [],
        regionErrors: Array.isArray(draft.checks?.final?.regionErrors)
          ? draft.checks.final.regionErrors
          : []
      }
    },
    pairingRelations,
    reviewActivity: activity.map((entry) => ({
      discordId: String(entry.discordId || ''),
      username: String(entry.username || 'Unknown account').slice(0, 64),
      discordUsername: String(entry.discordUsername || '').slice(0, 64),
      avatarUrl: validDiscordAvatarUrl(entry.avatarUrl) ? entry.avatarUrl : '',
      lastOpenedAt: toIso(entry.lastOpenedAt),
      vote: ['approve', 'changes'].includes(entry.vote) ? entry.vote : null,
      reviewedAt: toIso(entry.reviewedAt)
    })),
    approvalActivity: draft.approvalActivity && ['sending', 'sent', 'failed'].includes(draft.approvalActivity.status)
      ? {
        status: draft.approvalActivity.status,
        actor: {
          discordId: String(draft.approvalActivity.actor?.discordId || '').slice(0, 20),
          username: String(draft.approvalActivity.actor?.username || 'Unknown account').slice(0, 64),
          discordUsername: String(draft.approvalActivity.actor?.discordUsername || '').slice(0, 64),
          avatarUrl: validDiscordAvatarUrl(draft.approvalActivity.actor?.avatarUrl)
            ? draft.approvalActivity.actor.avatarUrl
            : ''
        },
        startedAt: toIso(draft.approvalActivity.startedAt),
        completedAt: toIso(draft.approvalActivity.completedAt)
      }
      : null,
    activeViewers: activeViewers.map((viewer) => ({
      discordId: String(viewer.discordId),
      username: String(viewer.username || 'Unknown account').slice(0, 64),
      discordUsername: String(viewer.discordUsername || '').slice(0, 64),
      avatarUrl: validDiscordAvatarUrl(viewer.avatarUrl) ? viewer.avatarUrl : ''
    })),
    myVote: ['approve', 'changes'].includes(myReview?.vote) ? myReview.vote : null,
    previewStatus: String(draft.previewStatus || 'not-posted'),
    updatedAt: toIso(draft.updatedAt)
  };
}
const THEME_COLOR_FIELDS = [
  'background',
  'surface',
  'accent',
  'accentText',
  'text',
  'muted',
  'border'
];

function normalizeThemeColors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== THEME_COLOR_FIELDS.length ||
      Object.keys(input).some((field) => !THEME_COLOR_FIELDS.includes(field))) {
    throw new TypeError('Provide all supported theme colors.');
  }
  const colors = {};
  for (const field of THEME_COLOR_FIELDS) {
    if (typeof input[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input[field])) {
      throw new TypeError(`Enter a valid hex color for ${field}.`);
    }
    colors[field] = input[field].toLowerCase();
  }
  return colors;
}

function readStoredThemeColors(input) {
  try {
    return normalizeThemeColors(input);
  } catch {
    return null;
  }
}

function serializeMember(profile) {
  return {
    discordId: typeof profile.discordId === 'string'
      ? profile.discordId
      : typeof profile._id === 'string' ? profile._id : '',
    username: typeof profile.username === 'string' ? profile.username : '',
    nickname: typeof profile.nickname === 'string' ? profile.nickname : '',
    region: typeof profile.region === 'string' ? profile.region : '',
    steamId: typeof profile.steamId === 'string' ? profile.steamId : '',
    streamLink: typeof profile.streamLink === 'string' ? profile.streamLink : ''
  };
}

function serializeMemberChange(change) {
  if (change.operationType === 'delete') {
    const discordId = typeof change.documentKey?._id === 'string'
      ? change.documentKey._id
      : '';
    return discordId ? { type: 'deleted', discordId } : null;
  }
  if (!['insert', 'replace', 'update'].includes(change.operationType) || !change.fullDocument) {
    return null;
  }
  const member = serializeMember(change.fullDocument);
  return member.discordId ? { type: 'updated', member } : null;
}

function normalizeMemberUpdates(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Enter valid member profile fields.');
  }
  const fields = Object.keys(input);
  if (!fields.length || fields.some((field) => !Object.hasOwn(MEMBER_FIELD_LIMITS, field))) {
    throw new TypeError('Only nickname, region, Steam ID, and stream link can be edited.');
  }

  const updates = {};
  for (const field of fields) {
    const rawValue = input[field];
    if (typeof rawValue !== 'string') throw new TypeError(`${field} must be text.`);
    const value = rawValue.trim();
    if (value.length > MEMBER_FIELD_LIMITS[field]) {
      throw new TypeError(`${field} must be ${MEMBER_FIELD_LIMITS[field]} characters or fewer.`);
    }
    if (field === 'streamLink' && value) {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new TypeError('Stream link must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new TypeError('Stream link must be a valid HTTP or HTTPS URL.');
      }
    }
    updates[field] = value;
  }
  return updates;
}

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

function validDateFilter(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function easternDateBoundary(value) {
  const [year, month, day] = value.split('-').map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  let timestamp = targetUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(EASTERN_DAY_FORMATTER.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    const renderedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    timestamp += targetUtc - renderedAsUtc;
  }
  return new Date(timestamp);
}

function nextCalendarDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function collectSettingsChanges(previous, next, prefix = '') {
  const previousIsObject = previous && typeof previous === 'object' && !Array.isArray(previous);
  const nextIsObject = next && typeof next === 'object' && !Array.isArray(next);
  if (previousIsObject && nextIsObject) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    return [...keys].flatMap((key) =>
      collectSettingsChanges(previous[key], next[key], prefix ? `${prefix}.${key}` : key)
    );
  }
  if (Object.is(previous, next)) return [];
  return [{
    setting: prefix,
    from: previous === undefined ? null : previous,
    to: next === undefined ? null : next
  }];
}

function isTicketCollectionName(value) {
  return typeof value === 'string' &&
    value.endsWith('_Tickets') &&
    Buffer.byteLength(value, 'utf8') <= 120 &&
    !value.includes('\0') &&
    !value.includes('$') &&
    !value.startsWith('system.');
}

function validDiscordAvatarUrl(value) {
  return typeof value === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(value);
}

function ticketDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return '';
  const isoDate = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (isoDate && validDateFilter(isoDate[1])) return isoDate[1];
  const usDate = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (!usDate) return '';
  const month = usDate[1].padStart(2, '0');
  const day = usDate[2].padStart(2, '0');
  const date = `${usDate[3]}-${month}-${day}`;
  return validDateFilter(date) ? date : '';
}

function serializeTicketSummary(ticket, collectionName) {
  return {
    collectionName,
    ticketId: ticket._id instanceof ObjectId ? ticket._id.toHexString() : '',
    ticketID: typeof ticket.ticketID === 'string' ? ticket.ticketID : '',
    username: typeof ticket.username === 'string' ? ticket.username : '',
    userID: typeof ticket.userID === 'string' ? ticket.userID : '',
    createdAt: typeof ticket.createdAt === 'string' ? ticket.createdAt : '',
    closedAt: typeof ticket.closedAt === 'string' ? ticket.closedAt : '',
    status: typeof ticket.status === 'string' ? ticket.status : '',
    staffIDs: Array.isArray(ticket.staffIDs)
      ? ticket.staffIDs.filter((staffId) => typeof staffId === 'string')
      : []
  };
}

function ticketPersonId(ticket) {
  if (typeof ticket.userID === 'string' && ticket.userID.trim()) return ticket.userID;
  const username = typeof ticket.username === 'string' ? ticket.username.trim().toLocaleLowerCase('en') : '';
  return username ? `username:${username}` : '';
}

function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function validAdminPublicOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value.replace(/\/$/, '') || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      return null;
    }
    return { origin: url.origin, rpId: url.hostname.replace(/^\[|\]$/g, '') };
  } catch {
    return null;
  }
}

function normalizeAdminCeremonyContext(body) {
  const redirectUri = typeof body?.redirectUri === 'string' ? body.redirectUri : '';
  let redirect;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new TypeError('A valid 127.0.0.1 callback URL is required.');
  }
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' ||
      !redirect.port || redirect.username || redirect.password || redirect.hash) {
    throw new TypeError('The callback URL must use HTTP on 127.0.0.1.');
  }
  const state = typeof body?.state === 'string' ? body.state : '';
  if (!/^[A-Za-z0-9._~-]{16,256}$/.test(state)) {
    throw new TypeError('A state value between 16 and 256 URL-safe characters is required.');
  }
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.toLowerCase() : '';
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new TypeError('A valid device ID is required.');
  const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 100) : '';
  const platform = typeof body?.platform === 'string' ? body.platform.trim().slice(0, 32) : '';
  if (!deviceName || !platform) throw new TypeError('Device name and platform are required.');
  return { redirectUri: redirect.href, state, deviceId, deviceName, platform };
}

function createApp({
  users,
  devices,
  audit,
  members,
  avoids,
  ticketDatabase,
  botSettings,
  backupDatabase,
  backupSources = [],
  adminDatabaseName,
  hoedownInfoDatabaseName,
  jwtSecret,
  adminApiKey,
  adminPublicOrigin,
  adminPasskeyCredentials,
  adminPasskeyChallenges,
  adminPasskeyTickets,
  adminHandoffCodes,
  adminSessions,
  adminPasskeyState,
  dummyPasswordHash,
  updateFeed,
  updateDiscordNickname,
  getDiscordProfile,
  sendTicketReply: sendTicketReplyCallback,
  sendTicketStaffMessage: sendTicketStaffMessageCallback,
  syncTicketStaffChat: syncTicketStaffChatCallback,
  editTicketReply: editTicketReplyCallback,
  closeTicket: closeTicketCallback,
  saveAvoidRelationships,
  roundDraftCollection,
  roundAvoidsCollection,
  previousPairingsCollection,
  syncRoundDraftPreview,
  grabRoundReactions,
  canGrabRoundReactions,
  approveCurrentRound
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '128kb' }));

  const webAuthnConfig = validAdminPublicOrigin(adminPublicOrigin);
  const passkeyCredentials = adminPasskeyCredentials;
  const passkeyChallenges = adminPasskeyChallenges;
  const passkeyTickets = adminPasskeyTickets;
  const handoffCodes = adminHandoffCodes;
  const adminSessionCollection = adminSessions;
  const passkeyState = adminPasskeyState;
  const passkeysConfigured = Boolean(webAuthnConfig && passkeyCredentials &&
    passkeyChallenges && passkeyTickets && handoffCodes && adminSessionCollection && passkeyState);

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
  const recordAdminAction = async (action, username, details) => {
    try {
      await audit.insertOne({
        actor: 'admin',
        action,
        username,
        at: new Date(),
        ...(details ? { details } : {})
      });
      return true;
    } catch (error) {
      console.error(`Admin audit write failed for ${action}:`, error);
      return false;
    }
  };
  const authorizeAdmin = (req, res) => {
    if (!passkeysConfigured) {
      res.status(503).json({ error: 'Admin passkey authentication is not configured.' });
      return false;
    }
    const token = bearerToken(req);
    if (!token || !req.adminSession) {
      res.status(401).json({ error: 'Admin authorization failed.' });
      return false;
    }
    return true;
  };
  const publicPasskeyRoutes = new Set([
    'POST /api/admin/passkeys/bootstrap',
    'POST /api/admin/passkeys/bootstrap/options',
    'POST /api/admin/passkeys/bootstrap/verify',
    'POST /api/admin/passkeys/login/options',
    'POST /api/admin/passkeys/login/verify',
    'POST /api/admin/passkeys/exchange'
  ]);
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/admin/') ||
        publicPasskeyRoutes.has(`${req.method} ${req.path}`)) return next();
    const token = bearerToken(req);
    if (!token || !passkeysConfigured) return next();
    try {
      const session = await adminSessionCollection.findOne({ tokenHash: hashOpaqueToken(token) });
      if (session && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now()) {
        req.adminSession = session;
      }
      return next();
    } catch (error) {
      return sendError(res, error, 'Admin session lookup failed:');
    }
  });
  const availableBackupSources = new Map(
    backupSources
      .filter(({ databaseName, database }) =>
        typeof databaseName === 'string' && databaseName &&
        databaseName !== adminDatabaseName && databaseName !== 'Backups' && database)
      .map(({ databaseName, database }) => [databaseName, database])
  );
  const readCollectionDetails = async (database, collectionName) => {
    const [details] = await database
      .listCollections({ name: collectionName }, { nameOnly: false })
      .toArray();
    if (!details) throw new Error(`Collection "${collectionName}" no longer exists.`);
    return details;
  };
  const supportedCollectionOptions = (...options) => {
    const copied = {};
    for (const source of options) {
      if (!source || typeof source !== 'object') continue;
      for (const key of ['collation', 'validator', 'validationLevel', 'validationAction']) {
        if (source[key] !== undefined) copied[key] = source[key];
      }
    }
    return copied;
  };
  const copyCollectionDocuments = async (source, destination) => {
    const cursor = source.find({}).batchSize(500);
    let documentCount = 0;
    let batch = [];
    for await (const document of cursor) {
      batch.push(document);
      if (batch.length === 500) {
        await destination.insertMany(batch);
        documentCount += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await destination.insertMany(batch);
      documentCount += batch.length;
    }
    return documentCount;
  };
  const insertDocuments = async (destination, documents) => {
    let insertedCount = 0;
    for (let offset = 0; offset < documents.length; offset += 500) {
      const batch = documents.slice(offset, offset + 500);
      await destination.insertMany(batch);
      insertedCount += batch.length;
    }
    return insertedCount;
  };
  const copyCustomIndexes = async (source, destination) => {
    const indexes = await source.indexes();
    const customIndexes = indexes.filter((index) => index.name !== '_id_');
    for (const index of customIndexes) {
      const { key, name, ns, v, background, ...options } = index;
      await destination.createIndex(key, {
        ...options,
        ...(name ? { name } : {})
      });
    }
    return customIndexes.length;
  };
  const replaceCollectionDocuments = async ({
    database,
    collectionName,
    documents,
    documentSource,
    indexSource,
    collectionOptions
  }) => {
    const stagingName = `_replace_${crypto.randomBytes(8).toString('hex')}`;
    const staging = await database.createCollection(stagingName, collectionOptions);
    try {
      const documentCount = documents
        ? await insertDocuments(staging, documents)
        : await copyCollectionDocuments(documentSource, staging);
      const indexCount = await copyCustomIndexes(indexSource, staging);
      await staging.rename(collectionName, { dropTarget: true });
      return { documentCount, indexCount };
    } catch (error) {
      try {
        await staging.drop();
      } catch (cleanupError) {
        console.error(`Could not remove incomplete replacement collection ${stagingName}:`, cleanupError);
      }
      throw error;
    }
  };
  const createCollectionBackup = async (databaseName, collectionName) => {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:.]/g, '');
    const safeSourceName = collectionName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'Collection';
    const backupName = `${safeSourceName}Backup_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;
    const sourceDatabase = availableBackupSources.get(databaseName);
    const source = sourceDatabase.collection(collectionName);
    const sourceDetails = await readCollectionDetails(sourceDatabase, collectionName);
    const collectionOptions = supportedCollectionOptions(sourceDetails.options);
    const destination = await backupDatabase.createCollection(backupName, collectionOptions);
    try {
      const documentCount = await copyCollectionDocuments(source, destination);
      const indexCount = await copyCustomIndexes(source, destination);
      const result = {
        database: databaseName,
        collection: collectionName,
        backupCollection: backupName,
        createdAt: now.toISOString(),
        documentCount,
        indexCount
      };
      await backupDatabase.collection(BACKUP_HISTORY_COLLECTION).insertOne({
        _id: backupName,
        sourceDatabase: databaseName,
        sourceCollection: collectionName,
        backupCollection: backupName,
        createdAt: now,
        documentCount,
        indexCount
      });
      return result;
    } catch (error) {
      try {
        await destination.drop();
      } catch (cleanupError) {
        console.error(`Could not remove incomplete backup ${backupName}:`, cleanupError);
      }
      try {
        await backupDatabase.collection(BACKUP_HISTORY_COLLECTION).deleteOne({ _id: backupName });
      } catch (cleanupError) {
        console.error(`Could not remove incomplete backup history for ${backupName}:`, cleanupError);
      }
      throw error;
    }
  };
  const listBackupSnapshotsForTarget = async (databaseName, collectionName) => {
    const backupCollections = await backupDatabase.listCollections({}, { nameOnly: true }).toArray();
    const existingNames = new Set(backupCollections
      .filter(({ name }) => typeof name === 'string' && name.includes('Backup_'))
      .map(({ name }) => name));
    const snapshots = new Map();
    const history = await backupDatabase.collection(BACKUP_HISTORY_COLLECTION)
      .find({ sourceDatabase: databaseName, sourceCollection: collectionName })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
    for (const entry of history) {
      if (!existingNames.has(entry.backupCollection)) continue;
      snapshots.set(entry.backupCollection, {
        collection: entry.backupCollection,
        createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : null,
        documentCount: entry.documentCount,
        indexCount: entry.indexCount
      });
    }

    const auditEntries = await audit.find({ action: 'backup-collections' })
      .sort({ at: -1 })
      .limit(1000)
      .toArray();
    for (const entry of auditEntries) {
      for (const backup of entry.details?.results || []) {
        if (backup.success !== true || backup.database !== databaseName ||
            backup.collection !== collectionName || !existingNames.has(backup.backupCollection) ||
            snapshots.has(backup.backupCollection)) continue;
        snapshots.set(backup.backupCollection, {
          collection: backup.backupCollection,
          createdAt: entry.at instanceof Date ? entry.at.toISOString() : null,
          documentCount: backup.documentCount,
          indexCount: backup.indexCount
        });
      }
    }

    const sourceDatabaseNames = [];
    for (const [sourceDatabaseName, sourceDatabase] of availableBackupSources) {
      const collections = await sourceDatabase
        .listCollections({ name: collectionName }, { nameOnly: true })
        .toArray();
      if (collections.some(({ name }) => name === collectionName)) {
        sourceDatabaseNames.push(sourceDatabaseName);
      }
    }
    if (sourceDatabaseNames.length === 1 && sourceDatabaseNames[0] === databaseName) {
      const safeSourceName = collectionName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'Collection';
      for (const name of existingNames) {
        if (!name.startsWith(`${safeSourceName}Backup_`) || snapshots.has(name)) continue;
        const match = /Backup_(\d{8}T\d{9}Z)_[a-f0-9]{8}$/.exec(name);
        if (!match) continue;
        const value = match[1];
        const createdAt = new Date(Date.UTC(
          Number(value.slice(0, 4)),
          Number(value.slice(4, 6)) - 1,
          Number(value.slice(6, 8)),
          Number(value.slice(9, 11)),
          Number(value.slice(11, 13)),
          Number(value.slice(13, 15)),
          Number(value.slice(15, 18))
        )).toISOString();
        snapshots.set(name, { collection: name, createdAt, documentCount: null, indexCount: null });
      }
    }
    return [...snapshots.values()]
      .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
  };
  const adminMutationLimit = limited(10);
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const ownerCredential = () => passkeyCredentials.findOne({ owner: 'owner' });
  const legacyBootstrapAuthorized = (req, res) => {
    if (!passkeysConfigured || typeof adminApiKey !== 'string' || adminApiKey.length < 32) {
      res.status(503).json({ error: 'Admin passkey bootstrap is not configured.' });
      return false;
    }
    const supplied = Buffer.from(bearerToken(req) || '', 'utf8');
    const expected = Buffer.from(adminApiKey, 'utf8');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: 'Admin bootstrap authorization failed.' });
      return false;
    }
    return true;
  };
  const createAdminTicket = async (flow, context = null) => {
    const ticket = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    await passkeyTickets.insertOne({
      ticketHash: hashOpaqueToken(ticket),
      flow,
      ...(context ? { context } : {}),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_CEREMONY_TTL_SECONDS * 1000)
    });
    return ticket;
  };
  const readAdminTicket = async (ticket, flow) => {
    if (typeof ticket !== 'string' || ticket.length < 40 || ticket.length > 64) return null;
    const entry = await passkeyTickets.findOne({ ticketHash: hashOpaqueToken(ticket), flow });
    return entry && new Date(entry.expiresAt).getTime() > Date.now() ? entry : null;
  };
  const createAdminHandoff = async (context, credentialId) => {
    const code = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    await handoffCodes.insertOne({
      codeHash: hashOpaqueToken(code),
      state: context.state,
      redirectUri: context.redirectUri,
      deviceId: context.deviceId,
      deviceName: context.deviceName,
      platform: context.platform,
      credentialId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_HANDOFF_TTL_SECONDS * 1000)
    });
    return code;
  };
  const getRegistrationOptions = async (ticketEntry) => {
    const currentCredentials = await passkeyCredentials.find({ owner: 'owner' }).toArray();
    const options = await generateRegistrationOptions({
      rpName: 'Hoedown Showdown Admin',
      rpID: webAuthnConfig.rpId,
      userID: Buffer.from('hoedown-showdown-owner-admin'),
      userName: 'owner',
      userDisplayName: 'Hoedown Showdown Owner',
      attestationType: 'none',
      excludeCredentials: currentCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports || []
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required'
      }
    });
    const challengeId = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    await passkeyChallenges.insertOne({
      challengeId,
      flow: 'registration',
      ticketHash: ticketEntry.ticketHash,
      challenge: options.challenge,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_CEREMONY_TTL_SECONDS * 1000)
    });
    return {
      options,
      challengeId,
      ...(ticketEntry.context
        ? { redirectUri: ticketEntry.context.redirectUri, state: ticketEntry.context.state }
        : {})
    };
  };
  const completeRegistration = async (ticket, challengeId, response, flow) => {
    const ticketEntry = await readAdminTicket(ticket, flow);
    if (!ticketEntry) return { error: 'This registration ticket is invalid or expired.' };
    if (flow === 'bootstrap' && await ownerCredential()) {
      return { error: 'Owner passkey bootstrap is already complete.', status: 409 };
    }
    const challenge = await passkeyChallenges.findOneAndDelete({
      challengeId,
      flow: 'registration',
      ticketHash: ticketEntry.ticketHash,
      expiresAt: { $gt: new Date() }
    });
    if (!challenge) return { error: 'The registration challenge is invalid or expired.' };
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: webAuthnConfig.origin,
        expectedRPID: webAuthnConfig.rpId,
        requireUserVerification: true
      });
    } catch (error) {
      console.warn('Admin passkey registration verification failed:', error.message);
      return { error: 'Passkey registration could not be verified.', status: 400 };
    }
    if (!verification.verified || !verification.registrationInfo) {
      return { error: 'Passkey registration could not be verified.', status: 400 };
    }
    const credential = verification.registrationInfo.credential;
    const credentialId = credential?.id || verification.registrationInfo.credentialID;
    const publicKey = credential?.publicKey || verification.registrationInfo.credentialPublicKey;
    if (!credentialId || !publicKey) {
      return { error: 'The authenticator returned an invalid credential.', status: 400 };
    }
    if (flow === 'bootstrap') {
      const lock = await passkeyState.updateOne(
        { _id: 'owner', bootstrapped: false },
        { $set: { bootstrapped: true, credentialId, updatedAt: new Date() } }
      );
      if (!lock.matchedCount) {
        return { error: 'Owner passkey bootstrap is already complete.', status: 409 };
      }
    }
    const consumedTicket = await passkeyTickets.findOneAndDelete({
      ticketHash: ticketEntry.ticketHash,
      flow,
      expiresAt: { $gt: new Date() }
    });
    if (!consumedTicket) {
      if (flow === 'bootstrap') {
        await passkeyState.updateOne(
          { _id: 'owner', credentialId },
          { $set: { bootstrapped: false }, $unset: { credentialId: '' } }
        );
      }
      return { error: 'This registration ticket has already been used.', status: 409 };
    }
    try {
      await passkeyCredentials.insertOne({
        owner: 'owner',
        credentialId,
        publicKey: Buffer.from(publicKey).toString('base64url'),
        counter: credential?.counter ?? verification.registrationInfo.counter ?? 0,
        transports: credential?.transports || response?.response?.transports || [],
        createdAt: new Date()
      });
    } catch (error) {
      if (flow === 'bootstrap') {
        await passkeyState.updateOne(
          { _id: 'owner', credentialId },
          { $set: { bootstrapped: false }, $unset: { credentialId: '' } }
        );
      }
      if (error.code === 11000) return { error: 'This passkey is already registered.', status: 409 };
      throw error;
    }
    if (flow === 'owner-register') return { registered: true, credentialId };
    const code = await createAdminHandoff(ticketEntry.context, credentialId);
    return {
      registered: true,
      code,
      redirectUri: ticketEntry.context.redirectUri,
      state: ticketEntry.context.state
    };
  };

  app.get('/admin/passkeys', (req, res) => {
    noStore(res);
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return res.sendFile(path.join(__dirname, 'admin-passkeys.html'));
  });
  app.get('/admin/passkeys.js', (req, res) => {
    noStore(res);
    res.type('application/javascript');
    return res.sendFile(path.join(__dirname, 'admin-passkeys.js'));
  });
  app.get('/admin/passkeys.css', (req, res) => {
    noStore(res);
    res.type('text/css');
    return res.sendFile(path.join(__dirname, 'admin-passkeys.css'));
  });
  app.post('/api/admin/passkeys/bootstrap', limited(5), async (req, res) => {
    if (!legacyBootstrapAuthorized(req, res)) return;
    let context;
    try {
      context = normalizeAdminCeremonyContext(req.body);
      if (await ownerCredential()) {
        return res.status(409).json({ error: 'Owner passkey bootstrap is already complete.' });
      }
      const ticket = await createAdminTicket('bootstrap', context);
      noStore(res);
      return res.status(200).json({ ticket });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return sendError(res, error, 'Admin passkey bootstrap failed:');
    }
  });
  app.post('/api/admin/passkeys/credentials/ticket', limited(5), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    try {
      const ticket = await createAdminTicket('owner-register');
      noStore(res);
      return res.status(200).json({ ticket });
    } catch (error) {
      return sendError(res, error, 'Admin recovery passkey ticket creation failed:');
    }
  });
  app.post('/api/admin/passkeys/bootstrap/options', limited(10), async (req, res) => {
    if (!passkeysConfigured) return res.status(503).json({ error: 'Admin passkey authentication is not configured.' });
    try {
      const ticketEntry = await readAdminTicket(req.body?.ticket, 'bootstrap');
      if (!ticketEntry) return res.status(401).json({ error: 'This registration ticket is invalid or expired.' });
      if (await ownerCredential()) return res.status(409).json({ error: 'Owner passkey bootstrap is already complete.' });
      noStore(res);
      return res.status(200).json(await getRegistrationOptions(ticketEntry));
    } catch (error) {
      return sendError(res, error, 'Admin passkey registration options failed:');
    }
  });
  app.post('/api/admin/passkeys/credentials/options', limited(10), async (req, res) => {
    if (!passkeysConfigured) return res.status(503).json({ error: 'Admin passkey authentication is not configured.' });
    try {
      const ticketEntry = await readAdminTicket(req.body?.ticket, 'owner-register');
      if (!ticketEntry) return res.status(401).json({ error: 'This registration ticket is invalid or expired.' });
      noStore(res);
      return res.status(200).json(await getRegistrationOptions(ticketEntry));
    } catch (error) {
      return sendError(res, error, 'Admin recovery passkey registration options failed:');
    }
  });
  app.post('/api/admin/passkeys/bootstrap/verify', limited(10), async (req, res) => {
    try {
      const result = await completeRegistration(
        req.body?.ticket, req.body?.challengeId, req.body?.response, 'bootstrap'
      );
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      noStore(res);
      return res.status(200).json({ code: result.code });
    } catch (error) {
      return sendError(res, error, 'Admin passkey registration failed:');
    }
  });
  app.post('/api/admin/passkeys/credentials/verify', limited(10), async (req, res) => {
    try {
      const result = await completeRegistration(
        req.body?.ticket, req.body?.challengeId, req.body?.response, 'owner-register'
      );
      if (result.error) return res.status(result.status || 400).json({ error: result.error });
      noStore(res);
      return res.status(200).json({ registered: true, credentialId: result.credentialId });
    } catch (error) {
      return sendError(res, error, 'Admin recovery passkey registration failed:');
    }
  });
  app.post('/api/admin/passkeys/login/options', limited(10), async (req, res) => {
    if (!passkeysConfigured) return res.status(503).json({ error: 'Admin passkey authentication is not configured.' });
    let context;
    try {
      context = normalizeAdminCeremonyContext(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const credentials = await passkeyCredentials.find({ owner: 'owner' }).toArray();
      if (!credentials.length) {
        return res.status(409).json({
          error: 'Owner passkey setup is not complete. In Account Manager, save the Render ADMIN_API_KEY and enroll the first passkey.'
        });
      }
      const options = await generateAuthenticationOptions({
        rpID: webAuthnConfig.rpId,
        allowCredentials: credentials.map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports || []
        })),
        userVerification: 'required'
      });
      const challengeId = crypto.randomBytes(24).toString('base64url');
      const now = new Date();
      await passkeyChallenges.insertOne({
        challengeId,
        flow: 'authentication',
        challenge: options.challenge,
        context,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ADMIN_CEREMONY_TTL_SECONDS * 1000)
      });
      noStore(res);
      return res.status(200).json({ options, challengeId });
    } catch (error) {
      return sendError(res, error, 'Admin passkey sign-in options failed:');
    }
  });
  app.post('/api/admin/passkeys/login/verify', limited(10), async (req, res) => {
    try {
      const challenge = await passkeyChallenges.findOneAndDelete({
        challengeId: req.body?.challengeId,
        flow: 'authentication',
        expiresAt: { $gt: new Date() }
      });
      if (!challenge) return res.status(400).json({ error: 'The sign-in challenge is invalid or expired.' });
      const credentialId = req.body?.response?.id || req.body?.response?.rawId;
      const credential = await passkeyCredentials.findOne({ owner: 'owner', credentialId });
      if (!credential) return res.status(401).json({ error: 'Passkey sign-in failed.' });
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: req.body.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: webAuthnConfig.origin,
          expectedRPID: webAuthnConfig.rpId,
          credential: {
            id: credential.credentialId,
            publicKey: Buffer.from(credential.publicKey, 'base64url'),
            counter: credential.counter,
            transports: credential.transports || []
          },
          requireUserVerification: true
        });
      } catch (error) {
        console.warn('Admin passkey authentication verification failed:', error.message);
        return res.status(401).json({ error: 'Passkey sign-in failed.' });
      }
      if (!verification.verified) return res.status(401).json({ error: 'Passkey sign-in failed.' });
      await passkeyCredentials.updateOne(
        { owner: 'owner', credentialId },
        { $set: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() } }
      );
      const code = await createAdminHandoff(challenge.context, credentialId);
      noStore(res);
      return res.status(200).json({ code });
    } catch (error) {
      return sendError(res, error, 'Admin passkey sign-in failed:');
    }
  });
  app.post('/api/admin/passkeys/exchange', limited(10), async (req, res) => {
    if (!passkeysConfigured) return res.status(503).json({ error: 'Admin passkey authentication is not configured.' });
    if (typeof req.body?.code !== 'string' || typeof req.body?.state !== 'string') {
      return res.status(400).json({ error: 'A handoff code and state are required.' });
    }
    try {
      const handoff = await handoffCodes.findOneAndDelete({
        codeHash: hashOpaqueToken(req.body.code),
        state: req.body.state,
        expiresAt: { $gt: new Date() }
      });
      if (!handoff) return res.status(401).json({ error: 'The handoff code is invalid, expired, or already used.' });
      const token = crypto.randomBytes(48).toString('base64url');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000);
      await adminSessionCollection.insertOne({
        tokenHash: hashOpaqueToken(token),
        credentialId: handoff.credentialId,
        deviceId: handoff.deviceId,
        deviceName: handoff.deviceName,
        platform: handoff.platform,
        createdAt: now,
        expiresAt
      });
      noStore(res);
      return res.status(200).json({ token, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      return sendError(res, error, 'Admin passkey session exchange failed:');
    }
  });
  app.get('/api/admin/sessions', limited(30), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    try {
      const now = Date.now();
      const sessions = (await adminSessionCollection.find({}).toArray())
        .filter((session) => !session.revokedAt && new Date(session.expiresAt).getTime() > now)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map((session) => ({
          id: String(session._id),
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          platform: session.platform,
          createdAt: new Date(session.createdAt).toISOString(),
          expiresAt: new Date(session.expiresAt).toISOString(),
          isCurrent: session.tokenHash === req.adminSession.tokenHash
        }));
      noStore(res);
      return res.status(200).json({ sessions });
    } catch (error) {
      return sendError(res, error, 'Admin session listing failed:');
    }
  });
  app.delete('/api/admin/sessions/:id', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'A valid session ID is required.' });
    try {
      const session = await adminSessionCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
        return res.status(404).json({ error: 'Admin session was not found.' });
      }
      const revokedAt = new Date();
      await adminSessionCollection.updateOne({ _id: session._id }, { $set: { revokedAt } });
      noStore(res);
      return res.status(200).json({ revoked: true, id: String(session._id) });
    } catch (error) {
      return sendError(res, error, 'Admin session revocation failed:');
    }
  });

  app.get('/api/admin/collections/replace-options', limited(30), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const databaseName = req.query.database;
    const collectionName = req.query.collection;
    const database = typeof databaseName === 'string'
      ? availableBackupSources.get(databaseName)
      : null;
    if (!database || typeof collectionName !== 'string' || !collectionName) {
      return res.status(400).json({ error: 'Choose an eligible database and collection.' });
    }
    try {
      await readCollectionDetails(database, collectionName);
      const backups = await listBackupSnapshotsForTarget(databaseName, collectionName);
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        backups,
        csvSupported: databaseName === hoedownInfoDatabaseName &&
          REPLACEMENT_CSV_COLLECTIONS.has(collectionName),
        events: collectionName === 'PastHoedownTeams' && databaseName === hoedownInfoDatabaseName
          ? PAST_HOEDOWN_EVENTS
          : []
      });
    } catch (error) {
      return sendError(res, error, 'Admin collection replacement options lookup failed:');
    }
  });
  app.post('/api/admin/collections/replace-backup', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const { database: databaseName, collection: collectionName, backupCollection } = req.body || {};
    const database = typeof databaseName === 'string'
      ? availableBackupSources.get(databaseName)
      : null;
    if (!database || typeof collectionName !== 'string' || !collectionName ||
        typeof backupCollection !== 'string' || !backupCollection) {
      return res.status(400).json({ error: 'A target collection and backup snapshot are required.' });
    }
    try {
      const eligibleBackups = await listBackupSnapshotsForTarget(databaseName, collectionName);
      if (!eligibleBackups.some((backup) => backup.collection === backupCollection)) {
        return res.status(400).json({ error: 'The selected backup is not a snapshot of this original collection.' });
      }
      const targetDetails = await readCollectionDetails(database, collectionName);
      const sourceDetails = await readCollectionDetails(backupDatabase, backupCollection);
      const result = await replaceCollectionDocuments({
        database,
        collectionName,
        documentSource: backupDatabase.collection(backupCollection),
        indexSource: backupDatabase.collection(backupCollection),
        collectionOptions: supportedCollectionOptions(targetDetails.options, sourceDetails.options)
      });
      const auditLogged = await recordAdminAction('replace-collection-from-backup', collectionName, {
        database: databaseName,
        backupCollection,
        documentCount: result.documentCount,
        indexCount: result.indexCount
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        database: databaseName,
        collection: collectionName,
        backupCollection,
        ...result,
        auditLogged
      });
    } catch (error) {
      return sendError(res, error, 'Admin collection restore failed:');
    }
  });
  app.post('/api/admin/collections/replace-csv', adminMutationLimit, (req, res, next) => {
    if (!authorizeAdmin(req, res)) return;
    next();
  }, express.raw({ type: 'text/csv', limit: MAX_REPLACEMENT_CSV_BYTES }), async (req, res) => {
    const databaseName = req.query.database;
    const collectionName = req.query.collection;
    const format = req.query.format;
    const eventId = req.query.eventId;
    const database = typeof databaseName === 'string'
      ? availableBackupSources.get(databaseName)
      : null;
    if (!database || databaseName !== hoedownInfoDatabaseName ||
        typeof collectionName !== 'string' || !REPLACEMENT_CSV_COLLECTIONS.has(collectionName)) {
      return res.status(400).json({ error: 'CSV replacement is not supported for this collection.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Choose a non-empty CSV file.' });
    }

    let documents;
    try {
      if (collectionName === 'Members') {
        documents = parseMemberListCsv(req.body);
      } else if (collectionName === 'Avoids') {
        documents = parseAvoidsCsv(req.body);
      } else if (collectionName === 'PreviousPairings') {
        documents = parsePreviousPairingsCsv(req.body);
      } else if (format === 'normalized') {
        documents = parsePastHoedownTeamsCsv(req.body);
      } else if (format === 'event-sheet') {
        const event = PAST_HOEDOWN_EVENTS.find((candidate) => candidate.id === eventId);
        if (!event) return res.status(400).json({ error: 'Choose a supported Hoedown event for the event-sheet CSV.' });
        const members = await database.collection('Members').find({}, {
          projection: { _id: 1, discordId: 1, username: 1, nickname: 1 }
        }).toArray();
        documents = parsePastHoedownEventCsv(req.body, event.id, event.name, members);
      } else {
        return res.status(400).json({ error: 'Choose a supported PastHoedownTeams CSV format.' });
      }
    } catch (error) {
      return res.status(400).json({ error: error.message || 'The CSV is invalid for this collection.' });
    }

    try {
      const targetDetails = await readCollectionDetails(database, collectionName);
      const result = await replaceCollectionDocuments({
        database,
        collectionName,
        documents,
        indexSource: database.collection(collectionName),
        collectionOptions: supportedCollectionOptions(targetDetails.options)
      });
      const auditLogged = await recordAdminAction('replace-collection-from-csv', collectionName, {
        database: databaseName,
        csvFormat: collectionName === 'PastHoedownTeams' ? format : 'collection-specific',
        ...(collectionName === 'PastHoedownTeams' && format === 'event-sheet' ? { eventId } : {}),
        documentCount: result.documentCount,
        indexCount: result.indexCount
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        database: databaseName,
        collection: collectionName,
        ...result,
        auditLogged
      });
    } catch (error) {
      return sendError(res, error, 'Admin CSV collection replacement failed:');
    }
  }, (error, req, res, next) => {
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'CSV files must be 10 MB or smaller.' });
    }
    return sendError(res, error, 'Admin CSV upload failed:');
  });
  app.get('/api/admin/backups', limited(30), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    if (!backupDatabase) return res.status(503).json({ error: 'Collection backups are not configured.' });
    try {
      const sources = [];
      for (const [databaseName, database] of availableBackupSources) {
        const collections = await database.listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of collections) {
          if (typeof name === 'string' && !name.startsWith('system.')) {
            sources.push({ database: databaseName, collection: name });
          }
        }
      }
      const backups = await backupDatabase.listCollections({}, { nameOnly: true }).toArray();
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        databases: [...availableBackupSources.keys()].sort(),
        sources: sources.sort((left, right) =>
          left.database.localeCompare(right.database) || left.collection.localeCompare(right.collection)),
        backups: backups
          .filter(({ name }) => typeof name === 'string' && name.includes('Backup_'))
          .map(({ name }) => {
            const match = /Backup_(\d{8}T\d{9}Z)_[a-f0-9]{8}$/.exec(name);
            let createdAt = null;
            if (match) {
              const value = match[1];
              createdAt = new Date(Date.UTC(
                Number(value.slice(0, 4)),
                Number(value.slice(4, 6)) - 1,
                Number(value.slice(6, 8)),
                Number(value.slice(9, 11)),
                Number(value.slice(11, 13)),
                Number(value.slice(13, 15)),
                Number(value.slice(15, 18))
              )).toISOString();
            }
            return { collection: name, createdAt };
          })
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
      });
    } catch (error) {
      return sendError(res, error, 'Admin backup collection listing failed:');
    }
  });
  app.post('/api/admin/backups', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    if (!backupDatabase) return res.status(503).json({ error: 'Collection backups are not configured.' });
    const requested = req.body && req.body.collections;
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 25) {
      return res.status(400).json({ error: 'Select between 1 and 25 collections to back up.' });
    }
    try {
      const selected = [];
      const selectedKeys = new Set();
      for (const item of requested) {
        if (!item || typeof item.database !== 'string' || typeof item.collection !== 'string' ||
            !item.database || !item.collection) {
          return res.status(400).json({ error: 'A database and collection are required for each selection.' });
        }
        const database = availableBackupSources.get(item.database);
        if (!database) return res.status(400).json({ error: 'One or more selected databases are not eligible for backup.' });
        const key = `${item.database}\0${item.collection}`;
        if (selectedKeys.has(key)) return res.status(400).json({ error: 'Duplicate collection selections are not allowed.' });
        selectedKeys.add(key);
        const matches = await database.listCollections({ name: item.collection }, { nameOnly: true }).toArray();
        if (!matches.some(({ name }) => name === item.collection && !name.startsWith('system.'))) {
          return res.status(400).json({ error: 'One or more selected collections no longer exist.' });
        }
        selected.push({ databaseName: item.database, collectionName: item.collection });
      }
      const results = [];
      for (const { databaseName, collectionName } of selected) {
        try {
          results.push({
            success: true,
            ...(await createCollectionBackup(databaseName, collectionName))
          });
        } catch (error) {
          console.error(`Admin backup failed for ${databaseName}.${collectionName}:`, error);
          results.push({
            success: false,
            database: databaseName,
            collection: collectionName,
            error: 'Could not complete this collection backup. Check service logs and MongoDB capacity.'
          });
        }
      }
      const auditLogged = await recordAdminAction('backup-collections', 'Backups', {
        results: results.map(({ success, database, collection, backupCollection, documentCount, indexCount }) => ({
          success, database, collection, ...(backupCollection ? { backupCollection } : {}),
          ...(documentCount === undefined ? {} : { documentCount }),
          ...(indexCount === undefined ? {} : { indexCount })
        }))
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ results, auditLogged });
    } catch (error) {
      return sendError(res, error, 'Admin collection backup failed:');
    }
  });
  app.post('/api/admin/collections/wipe', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const requested = req.body && req.body.collections;
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 25) {
      return res.status(400).json({ error: 'Select between 1 and 25 collections to wipe.' });
    }
    try {
      const selected = [];
      const selectedKeys = new Set();
      for (const item of requested) {
        if (!item || typeof item.database !== 'string' || typeof item.collection !== 'string' ||
            !item.database || !item.collection) {
          return res.status(400).json({ error: 'A database and collection are required for each selection.' });
        }
        const database = availableBackupSources.get(item.database);
        if (!database) return res.status(400).json({ error: 'One or more selected databases are not eligible for wiping.' });
        const key = `${item.database}\0${item.collection}`;
        if (selectedKeys.has(key)) return res.status(400).json({ error: 'Duplicate collection selections are not allowed.' });
        selectedKeys.add(key);
        const matches = await database.listCollections({ name: item.collection }, { nameOnly: true }).toArray();
        if (!matches.some(({ name }) => name === item.collection && !name.startsWith('system.'))) {
          return res.status(400).json({ error: 'One or more selected collections no longer exist.' });
        }
        selected.push({ databaseName: item.database, collectionName: item.collection });
      }
      const results = [];
      for (const { databaseName, collectionName } of selected) {
        try {
          const result = await availableBackupSources.get(databaseName)
            .collection(collectionName)
            .deleteMany({});
          results.push({
            success: true,
            database: databaseName,
            collection: collectionName,
            deletedCount: result.deletedCount
          });
        } catch (error) {
          console.error(`Admin wipe failed for ${databaseName}.${collectionName}:`, error);
          results.push({
            success: false,
            database: databaseName,
            collection: collectionName,
            error: 'Could not wipe this collection. Check service logs.'
          });
        }
      }
      const auditLogged = await recordAdminAction('wipe-collections', 'collections', {
        results: results.map(({ success, database, collection, deletedCount }) => ({
          success, database, collection, ...(deletedCount === undefined ? {} : { deletedCount })
        }))
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ results, auditLogged });
    } catch (error) {
      return sendError(res, error, 'Admin collection wipe failed:');
    }
  });
  app.get('/api/admin/bot-settings', limited(60), async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    if (!botSettings) return res.status(503).json({ error: 'Bot settings are not configured.' });
    try {
      const document = await botSettings.findOne({ _id: BOT_SETTINGS_ID });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        settings: normalizeStoredBotSettings(document && document.settings),
        updatedAt: document?.updatedAt instanceof Date ? document.updatedAt.toISOString() : null,
        updatedBy: typeof document?.updatedBy === 'string' ? document.updatedBy : null
      });
    } catch (error) {
      return sendError(res, error, 'Admin bot settings lookup failed:');
    }
  });
  app.put('/api/admin/bot-settings', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    if (!botSettings) return res.status(503).json({ error: 'Bot settings are not configured.' });
    let settings;
    try {
      settings = validateBotSettings(req.body && req.body.settings);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const currentDocument = await botSettings.findOne({ _id: BOT_SETTINGS_ID });
      const previousSettings = normalizeStoredBotSettings(currentDocument && currentDocument.settings);
      const changedSettings = collectSettingsChanges(previousSettings, settings);
      const updatedAt = new Date();
      await botSettings.updateOne(
        { _id: BOT_SETTINGS_ID },
        { $set: { settings, updatedAt, updatedBy: 'admin' } },
        { upsert: true }
      );
      const auditLogged = await recordAdminAction('update-bot-settings', 'global', { changedSettings });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        settings,
        changedSettings,
        updatedAt: updatedAt.toISOString(),
        updatedBy: 'admin',
        auditLogged
      });
    } catch (error) {
      return sendError(res, error, 'Admin bot settings save failed:');
    }
  });
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
  const memberStreams = new Set();
  let roundDraftMutationRunning = false;
  const readRoundDraftSession = async (req, res) => {
    const session = await readSession(req, res);
    if (!session) return null;
    if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
      res.status(403).json({ error: 'Link your Discord account before reviewing a round.' });
      return null;
    }
    if (!roundDraftCollection || !roundAvoidsCollection || !previousPairingsCollection ||
        typeof canGrabRoundReactions !== 'function') {
      res.status(503).json({ error: 'Team preview and review are not configured.' });
      return null;
    }
    if (!await canGrabRoundReactions(session.user.discordId)) {
      res.status(403).json({
        error: 'Your linked Discord account does not have an allowed bot role.'
      });
      return null;
    }
    return session;
  };
  const serializeCurrentRoundDraft = async (draft, discordId) => {
    const playerIds = [...new Set((Array.isArray(draft.teams) ? draft.teams : [])
      .flatMap((team) => Array.isArray(team.players) ? team.players : [])
      .map((player) => String(player.discordId || '').trim())
      .filter((id) => MEMBER_ID_PATTERN.test(id)))];
    if (!playerIds.length) return serializeRoundDraft(draft, discordId);

    const [avoidDocuments, previousPairingDocuments] = await Promise.all([
      roundAvoidsCollection.find({ _id: { $in: playerIds } }).toArray(),
      previousPairingsCollection.find({ _id: { $in: playerIds } }).toArray()
    ]);
    const rosterIds = new Set(playerIds);
    const readRelations = (documents, field) => {
      const uniquePairs = new Map();
      for (const document of documents) {
        const sourceId = String(document._id || '').trim();
        if (!rosterIds.has(sourceId)) continue;
        for (const relationship of Array.isArray(document[field]) ? document[field] : []) {
          const targetId = String(relationship.discordId || relationship.id || '').trim();
          if (!rosterIds.has(targetId) || sourceId === targetId) continue;
          const ids = [sourceId, targetId].sort();
          uniquePairs.set(ids.join('|'), { discordIdA: ids[0], discordIdB: ids[1] });
        }
      }
      return [...uniquePairs.values()];
    };

    return serializeRoundDraft(draft, discordId, {
      avoids: readRelations(avoidDocuments, 'avoids'),
      previousPairings: readRelations(previousPairingDocuments, 'previousPairings')
    });
  };
  let roundsActionState = {
    running: false,
    lastClickedBy: null,
    lastClickedAt: null,
    lastOutcome: 'none'
  };
  let memberChangeStream;
  let memberChangeStreamRetry;
  let memberChangeStreamRetryDelay = 5000;
  let memberChangeStreamStopped = false;
  let avoidsChangeStream;
  let avoidsChangeStreamRetry;
  let avoidsChangeStreamRetryDelay = 5000;
  let teamCheckChangeStream;
  let teamCheckChangeStreamRetry;
  let teamCheckChangeStreamRetryDelay = 5000;
  let ticketChangeStream;
  let ticketChangeStreamRetry;
  let ticketChangeStreamRetryDelay = 1000;

  const writeMemberEvent = (response, eventName, data) => {
    if (!response.writableEnded && !response.destroyed) {
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const broadcastMemberEvent = (eventName, data) => {
    for (const stream of memberStreams) {
      writeMemberEvent(stream.response, eventName, data);
    }
  };
  app.locals.broadcastRoundDraftUpdate = (generationId) =>
    broadcastMemberEvent('round-draft-updated', { generationId });
  const respondWithUpdatedRoundDraft = async (updatedDraft, session, res, changeDescription) => {
    const generationId = updatedDraft.generationId;
    if (updatedDraft.previewStatus !== 'disabled') {
      try {
        if (typeof syncRoundDraftPreview !== 'function') {
          throw new Error('Discord Team Check preview synchronization is not configured.');
        }
        const synced = await syncRoundDraftPreview(updatedDraft);
        const savedPreview = await roundDraftCollection.updateOne({
          _id: 'current',
          generationId,
          status: 'pending'
        }, {
          $set: {
            previewMessageIds: synced.previewMessageIds,
            previewStatus: 'posted'
          },
          $unset: { previewError: '' }
        });
        if (!savedPreview.matchedCount) {
          throw new Error('The saved draft changed while the Discord preview was being updated.');
        }
        updatedDraft = {
          ...updatedDraft,
          previewMessageIds: synced.previewMessageIds,
          previewStatus: 'posted'
        };
      } catch (error) {
        const previewError = String(error.message || 'Unknown Discord preview error').slice(0, 1000);
        await roundDraftCollection.updateOne({
          _id: 'current',
          generationId,
          status: 'pending'
        }, {
          $set: { previewStatus: 'failed', previewError, updatedAt: new Date() }
        });
        broadcastMemberEvent('round-draft-updated', { generationId });
        res.set('Cache-Control', 'private, no-store');
        return res.status(502).json({
          error: `The ${changeDescription} was saved, but the Discord preview could not be updated: ${previewError}`,
          partial: true,
          draft: await serializeCurrentRoundDraft({
            ...updatedDraft,
            previewStatus: 'failed'
          }, session.user.discordId)
        });
      }
    }

    broadcastMemberEvent('round-draft-updated', { generationId });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({
      draft: await serializeCurrentRoundDraft(updatedDraft, session.user.discordId)
    });
  };
  const broadcastAvoidsResync = () => broadcastMemberEvent('avoids-resync', {});
  const broadcastTicketsResync = () => broadcastMemberEvent('tickets-resync', {});
  // The driver can emit close for an internal cursor cleanup while a change stream is resuming.
  const scheduleMemberChangeStreamRestart = (error) => {
    if (memberChangeStreamStopped || memberChangeStreamRetry) return;
    console.error('Members change stream failed; reconnecting:', error);
    memberChangeStreamRetry = setTimeout(() => {
      memberChangeStreamRetry = null;
      startMemberChangeStream();
      broadcastMemberEvent('resync', {});
    }, memberChangeStreamRetryDelay);
    memberChangeStreamRetryDelay = Math.min(memberChangeStreamRetryDelay * 2, 60000);
    memberChangeStreamRetry.unref?.();
  };
  const startMemberChangeStream = () => {
    if (!members || typeof members.watch !== 'function' || memberChangeStreamStopped) return;
    try {
      const stream = members.watch([], { fullDocument: 'updateLookup' });
      memberChangeStream = stream;
      stream.on('change', (change) => {
        memberChangeStreamRetryDelay = 5000;
        const event = serializeMemberChange(change);
        if (event) broadcastMemberEvent('member', event);
      });
      stream.on('error', (error) => {
        if (memberChangeStream !== stream || memberChangeStreamStopped) return;
        memberChangeStream = null;
        stream.close().catch((closeError) => {
          console.error('Could not close the failed Members change stream:', closeError);
        });
        scheduleMemberChangeStreamRestart(error);
      });
    } catch (error) {
      scheduleMemberChangeStreamRestart(error);
    }
  };
  startMemberChangeStream();

  const scheduleAvoidsChangeStreamRestart = (error) => {
    if (memberChangeStreamStopped || avoidsChangeStreamRetry) return;
    console.error('Avoids change stream failed; reconnecting:', error);
    avoidsChangeStreamRetry = setTimeout(() => {
      avoidsChangeStreamRetry = null;
      startAvoidsChangeStream();
      broadcastAvoidsResync();
    }, avoidsChangeStreamRetryDelay);
    avoidsChangeStreamRetryDelay = Math.min(avoidsChangeStreamRetryDelay * 2, 60000);
    avoidsChangeStreamRetry.unref?.();
  };
  const startAvoidsChangeStream = () => {
    if (!avoids || typeof avoids.watch !== 'function' || memberChangeStreamStopped) return;
    try {
      const stream = avoids.watch([], { fullDocument: 'updateLookup' });
      avoidsChangeStream = stream;
      stream.on('change', () => {
        avoidsChangeStreamRetryDelay = 5000;
        broadcastAvoidsResync();
      });
      stream.on('error', (error) => {
        if (avoidsChangeStream !== stream || memberChangeStreamStopped) return;
        avoidsChangeStream = null;
        stream.close().catch((closeError) => {
          console.error('Could not close the failed Avoids change stream:', closeError);
        });
        scheduleAvoidsChangeStreamRestart(error);
      });
    } catch (error) {
      scheduleAvoidsChangeStreamRestart(error);
    }
  };
  startAvoidsChangeStream();

  const scheduleTeamCheckChangeStreamRestart = (error) => {
    if (memberChangeStreamStopped || teamCheckChangeStreamRetry) return;
    console.error('Team Check change stream failed; reconnecting:', error);
    teamCheckChangeStreamRetry = setTimeout(() => {
      teamCheckChangeStreamRetry = null;
      startTeamCheckChangeStream();
    }, teamCheckChangeStreamRetryDelay);
    teamCheckChangeStreamRetryDelay = Math.min(teamCheckChangeStreamRetryDelay * 2, 60000);
    teamCheckChangeStreamRetry.unref?.();
  };
  const startTeamCheckChangeStream = () => {
    if (!roundDraftCollection || typeof roundDraftCollection.watch !== 'function' ||
        memberChangeStreamStopped) return;
    try {
      const stream = roundDraftCollection.watch([], { fullDocument: 'updateLookup' });
      teamCheckChangeStream = stream;
      stream.on('change', (change) => {
        teamCheckChangeStreamRetryDelay = 5000;
        const documentId = change.documentKey?._id ?? change.fullDocument?._id;
        if (documentId === 'current') {
          broadcastMemberEvent('round-draft-updated', {
            generationId: change.fullDocument?.generationId
          });
        }
      });
      stream.on('error', (error) => {
        if (teamCheckChangeStream !== stream || memberChangeStreamStopped) return;
        teamCheckChangeStream = null;
        stream.close().catch((closeError) => {
          console.error('Could not close the failed Team Check change stream:', closeError);
        });
        scheduleTeamCheckChangeStreamRestart(error);
      });
    } catch (error) {
      scheduleTeamCheckChangeStreamRestart(error);
    }
  };
  startTeamCheckChangeStream();

  const scheduleTicketChangeStreamRestart = (error) => {
    if (memberChangeStreamStopped || ticketChangeStreamRetry) return;
    console.error(`Ticket change stream failed; retrying in ${ticketChangeStreamRetryDelay}ms:`, error);
    broadcastTicketsResync();
    ticketChangeStreamRetry = setTimeout(() => {
      ticketChangeStreamRetry = null;
      startTicketChangeStream();
      broadcastTicketsResync();
    }, ticketChangeStreamRetryDelay);
    ticketChangeStreamRetryDelay = Math.min(ticketChangeStreamRetryDelay * 2, 5000);
    ticketChangeStreamRetry.unref?.();
  };
  const startTicketChangeStream = () => {
    if (!ticketDatabase || typeof ticketDatabase.watch !== 'function' || memberChangeStreamStopped) return;
    try {
      const stream = ticketDatabase.watch([
        { $match: { 'ns.coll': { $regex: '^.*_Tickets$' } } }
      ]);
      ticketChangeStream = stream;
      stream.on('change', (change) => {
        ticketChangeStreamRetryDelay = 1000;
        const updatedFields = Object.keys(change.updateDescription?.updatedFields || {});
        const messageOnlyUpdate = change.operationType === 'update' &&
          updatedFields.length > 0 &&
          updatedFields.every((field) =>
            field === 'messages' || field.startsWith('messages.') ||
            field === 'staffIDs' || field.startsWith('staffIDs.')
          );
        if (messageOnlyUpdate) {
          broadcastMemberEvent('ticket-message', { collectionName: change.ns.coll });
        } else {
          broadcastTicketsResync();
        }
      });
      stream.on('error', (error) => {
        if (ticketChangeStream !== stream || memberChangeStreamStopped) return;
        ticketChangeStream = null;
        stream.close().catch((closeError) => {
          console.error('Could not close the failed Tickets change stream:', closeError);
        });
        scheduleTicketChangeStreamRestart(error);
      });
    } catch (error) {
      scheduleTicketChangeStreamRestart(error);
    }
  };
  startTicketChangeStream();

  app.locals.closeMembersLiveUpdates = async () => {
    memberChangeStreamStopped = true;
    if (memberChangeStreamRetry) clearTimeout(memberChangeStreamRetry);
    memberChangeStreamRetry = null;
    if (avoidsChangeStreamRetry) clearTimeout(avoidsChangeStreamRetry);
    avoidsChangeStreamRetry = null;
    if (teamCheckChangeStreamRetry) clearTimeout(teamCheckChangeStreamRetry);
    teamCheckChangeStreamRetry = null;
    if (ticketChangeStreamRetry) clearTimeout(ticketChangeStreamRetry);
    ticketChangeStreamRetry = null;
    for (const stream of memberStreams) {
      clearInterval(stream.heartbeat);
      clearInterval(stream.sessionCheck);
      stream.response.end();
    }
    memberStreams.clear();
    if (memberChangeStream) {
      const stream = memberChangeStream;
      memberChangeStream = null;
      await stream.close();
    }
    if (avoidsChangeStream) {
      const stream = avoidsChangeStream;
      avoidsChangeStream = null;
      await stream.close();
    }
    if (teamCheckChangeStream) {
      const stream = teamCheckChangeStream;
      teamCheckChangeStream = null;
      await stream.close();
    }
    if (ticketChangeStream) {
      const stream = ticketChangeStream;
      ticketChangeStream = null;
      await stream.close();
    }
  };

  app.get('/api/members/stream', async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if ((!members || typeof members.watch !== 'function') &&
          (!avoids || typeof avoids.watch !== 'function') &&
          (!roundDraftCollection || typeof roundDraftCollection.watch !== 'function') &&
          (!ticketDatabase || typeof ticketDatabase.watch !== 'function')) {
        return res.status(503).json({ error: 'Live updates are not available.' });
      }

      res.status(200).set({
        'Cache-Control': 'private, no-store, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      const stream = {
        response: res,
        request: req,
        heartbeat: null,
        sessionCheck: null,
        checkingSession: false
      };
      memberStreams.add(stream);
      writeMemberEvent(res, 'resync', {});
      writeMemberEvent(res, 'avoids-resync', {});
      writeMemberEvent(res, 'tickets-resync', {});
      writeMemberEvent(res, 'rounds-action-status', roundsActionState);

      const removeStream = () => {
        if (!memberStreams.delete(stream)) return;
        clearInterval(stream.heartbeat);
        clearInterval(stream.sessionCheck);
      };
      res.on('close', removeStream);
      stream.heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
      }, 20000);
      stream.heartbeat.unref?.();
      stream.sessionCheck = setInterval(async () => {
        if (stream.checkingSession || res.writableEnded || res.destroyed) return;
        stream.checkingSession = true;
        try {
          const payload = readToken(bearerToken(req), jwtSecret);
          const user = payload && payload.sub === session.payload.sub
            ? await users.findOne({ _id: new ObjectId(payload.sub) })
            : null;
          if (!payload || !user || user.active === false || user.tokenVersion !== payload.ver ||
              (user.activeDeviceId && user.activeDeviceId !== payload.deviceId)) {
            writeMemberEvent(res, 'session-expired', { error: 'Session expired. Please sign in again.' });
            removeStream();
            res.end();
          }
        } catch (error) {
          console.error('Member live-update session check failed:', error);
          removeStream();
          res.end();
        } finally {
          stream.checkingSession = false;
        }
      }, 60000);
      stream.sessionCheck.unref?.();
    } catch (error) {
      return sendError(res, error, 'Member live-update stream failed:');
    }
  });

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
        return res.status(200).json({
          passwordChangeRequired: true,
          resetToken,
          avatarUrl: validDiscordAvatarUrl(user.discordAvatarUrl) ? user.discordAvatarUrl : ''
        });
      }
      const token = makeToken({
        sub: user._id.toString(),
        ver: nextVersion,
        deviceId: device.deviceId,
        purpose: 'session'
      }, jwtSecret, Math.floor(now.getTime() / 1000));
      return res.status(200).json({
        token,
        username,
        avatarUrl: validDiscordAvatarUrl(user.discordAvatarUrl) ? user.discordAvatarUrl : '',
        expiresAt: expiresAt.toISOString()
      });
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
        avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl) ? session.user.discordAvatarUrl : '',
        expiresAt: new Date(session.payload.exp * 1000).toISOString()
      });
    } catch (error) {
      return sendError(res, error, 'Session check failed:');
    }
  });

  app.get('/api/settings', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        themeColors: readStoredThemeColors(session.user.settings?.themeColors)
      });
    } catch (error) {
      return sendError(res, error, 'App settings lookup failed:');
    }
  });

  app.put('/api/settings/theme-colors', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      let colors;
      try {
        colors = normalizeThemeColors(req.body?.colors);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const result = await users.updateOne(
        { _id: session.user._id, tokenVersion: session.payload.ver, active: { $ne: false } },
        { $set: { 'settings.themeColors': colors } }
      );
      if (!result.matchedCount) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ themeColors: colors });
    } catch (error) {
      return sendError(res, error, 'App theme save failed:');
    }
  });

  app.delete('/api/settings/theme-colors', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      const result = await users.updateOne(
        { _id: session.user._id, tokenVersion: session.payload.ver, active: { $ne: false } },
        { $unset: { 'settings.themeColors': '' } }
      );
      if (!result.matchedCount) {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ themeColors: null });
    } catch (error) {
      return sendError(res, error, 'App theme reset failed:');
    }
  });

  app.get('/api/members', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!members) return res.status(503).json({ error: 'Member data is not configured.' });

      const profiles = await members.find({}, {
        projection: {
          _id: 1,
          discordId: 1,
          username: 1,
          nickname: 1,
          region: 1,
          steamId: 1,
          streamLink: 1
        }
      }).sort({ username: 1 }).limit(5001).toArray();
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        members: profiles.slice(0, 5000).map(serializeMember),
        truncated: profiles.length > 5000
      });
    } catch (error) {
      return sendError(res, error, 'Member list lookup failed:');
    }
  });

  app.get('/api/avoids', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!avoids || !members) {
        return res.status(503).json({ error: 'Avoid data is not configured.' });
      }

      const [documents, profiles] = await Promise.all([
        avoids.find({}, { projection: { _id: 1, name: 1, avoids: 1 } }).toArray(),
        members.find({}, {
          projection: { _id: 1, discordId: 1, username: 1, nickname: 1 }
        }).toArray()
      ]);
      const profilesById = new Map(profiles.map((profile) => [
        String(profile.discordId || profile._id || ''),
        profile
      ]));
      const pairs = [];
      for (const document of documents) {
        const avoiderDiscordId = String(document._id || document.discordId || '');
        if (!avoiderDiscordId || !Array.isArray(document.avoids)) continue;
        const avoiderProfile = profilesById.get(avoiderDiscordId);
        const avoiderNickname = typeof avoiderProfile?.nickname === 'string'
          ? avoiderProfile.nickname
          : '';
        const avoiderUsername = typeof avoiderProfile?.username === 'string' && avoiderProfile.username
          ? avoiderProfile.username
          : typeof document.name === 'string' ? document.name : '';
        const avoiderName = avoiderNickname || avoiderUsername || avoiderDiscordId;

        for (const avoided of document.avoids) {
          const avoidedDiscordId = typeof avoided === 'string'
            ? avoided
            : String(avoided?.discordId || '');
          if (!avoidedDiscordId) continue;
          const avoidedProfile = profilesById.get(avoidedDiscordId);
          const avoidedNickname = typeof avoidedProfile?.nickname === 'string'
            ? avoidedProfile.nickname
            : '';
          const storedAvoidedUsername = typeof avoided === 'object' && avoided &&
            typeof avoided.name === 'string' ? avoided.name : '';
          const avoidedUsername = typeof avoidedProfile?.username === 'string' && avoidedProfile.username
            ? avoidedProfile.username
            : storedAvoidedUsername;
          pairs.push({
            avoiderDiscordId,
            avoiderNickname,
            avoiderUsername,
            avoiderName,
            avoidedDiscordId,
            avoidedNickname,
            avoidedUsername,
            avoidedName: avoidedNickname || avoidedUsername || avoidedDiscordId
          });
        }
      }
      pairs.sort((left, right) =>
        left.avoiderName.localeCompare(right.avoiderName, 'en', { sensitivity: 'base' }) ||
        left.avoidedName.localeCompare(right.avoidedName, 'en', { sensitivity: 'base' }) ||
        left.avoiderDiscordId.localeCompare(right.avoiderDiscordId) ||
        left.avoidedDiscordId.localeCompare(right.avoidedDiscordId)
      );
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ pairs });
    } catch (error) {
      return sendError(res, error, 'Avoid list lookup failed:');
    }
  });

  app.get('/api/ticket-people', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });

      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const pageValue = typeof req.query.page === 'string' ? req.query.page : '1';
      if (search.length > 100) return res.status(400).json({ error: 'Ticket search must be 100 characters or fewer.' });
      if ((from && !validDateFilter(from)) || (to && !validDateFilter(to))) {
        return res.status(400).json({ error: 'Use valid dates in YYYY-MM-DD format.' });
      }
      if (from && to && from > to) {
        return res.status(400).json({ error: 'The start date must be on or before the end date.' });
      }
      if (!/^[1-9]\d{0,4}$/.test(pageValue) || Number(pageValue) > 10000) {
        return res.status(400).json({ error: 'Ticket page must be between 1 and 10,000.' });
      }

      const collectionInfos = await ticketDatabase.listCollections({}, { nameOnly: true }).toArray();
      const ticketCollections = collectionInfos.filter(({ name }) => isTicketCollectionName(name));
      const peopleById = new Map();
      for (const { name: collectionName } of ticketCollections) {
        const collectionTickets = await ticketDatabase.collection(collectionName).find({}, {
          projection: { username: 1, userID: 1, createdAt: 1, status: 1 }
        }).toArray();
        for (const ticket of collectionTickets) {
          const personId = ticketPersonId(ticket);
          if (!personId) continue;

          let person = peopleById.get(personId);
          if (!person) {
            person = {
              personId,
              userID: typeof ticket.userID === 'string' ? ticket.userID : '',
              username: '',
              latestCreatedAt: '',
              latestDateKey: '',
              ticketCount: 0,
              openTicketCount: 0,
              closedTicketCount: 0,
              matchesDateRange: !from && !to,
              searchNames: new Set(),
              collectionNames: new Set()
            };
            peopleById.set(personId, person);
          }

          const username = typeof ticket.username === 'string' ? ticket.username : '';
          if (username) person.searchNames.add(username.toLocaleLowerCase('en'));
          person.collectionNames.add(collectionName);
          person.ticketCount += 1;
          if (typeof ticket.status === 'string' && ticket.status.toLocaleLowerCase('en') === 'open') {
            person.openTicketCount += 1;
          } else {
            person.closedTicketCount += 1;
          }

          const date = ticketDateKey(ticket.createdAt);
          if ((!from && !to) || (date && (!from || date >= from) && (!to || date <= to))) {
            person.matchesDateRange = true;
          }
          if (!person.latestDateKey || date >= person.latestDateKey) {
            person.latestDateKey = date;
            person.latestCreatedAt = typeof ticket.createdAt === 'string' ? ticket.createdAt : '';
            if (username) person.username = username;
          }
        }
      }

      const normalizedSearch = search.toLocaleLowerCase('en');
      const people = [...peopleById.values()]
        .filter((person) => person.matchesDateRange && (
          !normalizedSearch ||
          person.userID.toLocaleLowerCase('en').includes(normalizedSearch) ||
          [...person.searchNames].some((name) => name.includes(normalizedSearch))
        ))
        .sort((left, right) =>
          right.latestDateKey.localeCompare(left.latestDateKey) ||
          left.username.localeCompare(right.username, 'en')
        )
        .map((person) => ({
          personId: person.personId,
          userID: person.userID,
          username: person.username,
          latestCreatedAt: person.latestCreatedAt,
          ticketCount: person.ticketCount,
          openTicketCount: person.openTicketCount,
          closedTicketCount: person.closedTicketCount,
          collectionNames: [...person.collectionNames].sort()
        }));

      const total = people.length;
      const start = (Number(pageValue) - 1) * TICKET_PAGE_SIZE;
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        people: people.slice(start, start + TICKET_PAGE_SIZE),
        total,
        collectionCount: ticketCollections.length,
        page: Number(pageValue),
        pageSize: TICKET_PAGE_SIZE
      });
    } catch (error) {
      return sendError(res, error, 'Ticket people lookup failed:');
    }
  });

  app.get('/api/ticket-people/:personId/tickets', limited(600), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });

      const { personId } = req.params;
      const fallbackUsername = personId.startsWith('username:') ? personId.slice('username:'.length) : '';
      const isDiscordId = /^\d{1,20}$/.test(personId);
      const isUsernameKey = Boolean(fallbackUsername) &&
        Buffer.byteLength(personId, 'utf8') <= 120 &&
        !personId.includes('\0') &&
        !personId.includes('$');
      if (!isDiscordId && !isUsernameKey) {
        return res.status(400).json({ error: 'A valid ticket owner is required.' });
      }

      const collectionInfos = await ticketDatabase.listCollections({}, { nameOnly: true }).toArray();
      const ticketCollections = collectionInfos.filter(({ name }) => isTicketCollectionName(name));
      const tickets = [];
      const collectionNames = new Set();
      let username = '';
      let latestUsernameDate = '';
      for (const { name: collectionName } of ticketCollections) {
        const collectionTickets = await ticketDatabase.collection(collectionName).find({}, {
          projection: {
            _id: 1,
            ticketID: 1,
            username: 1,
            userID: 1,
            createdAt: 1,
            closedAt: 1,
            status: 1,
            staffIDs: 1
          }
        }).toArray();
        for (const ticket of collectionTickets) {
          const matchesPerson = isDiscordId
            ? ticket.userID === personId
            : (typeof ticket.userID !== 'string' || !ticket.userID.trim()) &&
              typeof ticket.username === 'string' &&
              ticket.username.toLocaleLowerCase('en') === fallbackUsername;
          if (!matchesPerson) continue;

          tickets.push(serializeTicketSummary(ticket, collectionName));
          collectionNames.add(collectionName);
          const createdDate = ticketDateKey(ticket.createdAt);
          if (!username || createdDate >= latestUsernameDate) {
            username = typeof ticket.username === 'string' ? ticket.username : username;
            latestUsernameDate = createdDate;
          }
        }
      }

      tickets.sort((left, right) => {
        const leftIsOpen = typeof left.status === 'string' && left.status.toLocaleLowerCase('en') === 'open';
        const rightIsOpen = typeof right.status === 'string' && right.status.toLocaleLowerCase('en') === 'open';
        const openOrder = Number(rightIsOpen) - Number(leftIsOpen);
        return openOrder ||
          ticketDateKey(right.createdAt).localeCompare(ticketDateKey(left.createdAt)) ||
          right.ticketId.localeCompare(left.ticketId);
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        person: {
          personId,
          userID: isDiscordId ? personId : '',
          username: username || fallbackUsername,
          collectionNames: [...collectionNames].sort()
        },
        tickets,
        total: tickets.length
      });
    } catch (error) {
      return sendError(res, error, 'Ticket owner history lookup failed:');
    }
  });

  app.get('/api/tickets', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });

      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const pageValue = typeof req.query.page === 'string' ? req.query.page : '1';
      if (search.length > 100) return res.status(400).json({ error: 'Ticket search must be 100 characters or fewer.' });
      if ((from && !validDateFilter(from)) || (to && !validDateFilter(to))) {
        return res.status(400).json({ error: 'Use valid dates in YYYY-MM-DD format.' });
      }
      if (from && to && from > to) {
        return res.status(400).json({ error: 'The start date must be on or before the end date.' });
      }
      if (!/^[1-9]\d{0,4}$/.test(pageValue) || Number(pageValue) > 10000) {
        return res.status(400).json({ error: 'Ticket page must be between 1 and 10,000.' });
      }

      const collectionInfos = await ticketDatabase.listCollections({}, { nameOnly: true }).toArray();
      const ticketCollections = collectionInfos
        .filter(({ name }) => isTicketCollectionName(name));
      const tickets = [];
      const normalizedSearch = search.toLocaleLowerCase('en');
      for (const { name: collectionName } of ticketCollections) {
        const collectionTickets = await ticketDatabase.collection(collectionName).find({}, {
          projection: {
            _id: 1,
            ticketID: 1,
            username: 1,
            userID: 1,
            createdAt: 1,
            closedAt: 1,
            status: 1,
            staffIDs: 1
          }
        }).toArray();
        for (const ticket of collectionTickets) {
          const summary = serializeTicketSummary(ticket, collectionName);
          if (!summary.ticketId) continue;
          const searchable = [
            summary.ticketID,
            summary.username,
            summary.userID,
            summary.status,
            ...summary.staffIDs
          ].join(' ').toLocaleLowerCase('en');
          if (normalizedSearch && !searchable.includes(normalizedSearch)) continue;
          const date = ticketDateKey(summary.createdAt);
          if (from && (!date || date < from)) continue;
          if (to && (!date || date > to)) continue;
          tickets.push(summary);
        }
      }

      tickets.sort((left, right) =>
        ticketDateKey(right.createdAt).localeCompare(ticketDateKey(left.createdAt)) ||
        right.ticketId.localeCompare(left.ticketId)
      );
      const total = tickets.length;
      const start = (Number(pageValue) - 1) * TICKET_PAGE_SIZE;
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        tickets: tickets.slice(start, start + TICKET_PAGE_SIZE),
        total,
        collectionCount: ticketCollections.length,
        page: Number(pageValue),
        pageSize: TICKET_PAGE_SIZE
      });
    } catch (error) {
      return sendError(res, error, 'Ticket list lookup failed:');
    }
  });

  app.get('/api/tickets/:collectionName/:ticketId', limited(600), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });

      const { collectionName, ticketId } = req.params;
      if (!isTicketCollectionName(collectionName) || !/^[a-f\d]{24}$/i.test(ticketId)) {
        return res.status(400).json({ error: 'A valid ticket reference is required.' });
      }
      const collections = await ticketDatabase.listCollections({ name: collectionName }, {
        nameOnly: true
      }).toArray();
      if (!collections.length) return res.status(404).json({ error: 'Ticket not found.' });

      let ticket = await ticketDatabase.collection(collectionName).findOne({
        _id: new ObjectId(ticketId)
      }, {
        projection: {
          _id: 1,
          ticketID: 1,
          username: 1,
          userID: 1,
          createdAt: 1,
          closedAt: 1,
          status: 1,
          staffIDs: 1,
          messages: 1
        }
      });
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

      let syncWarning = '';
      if (req.query.syncStaffChat === 'true' &&
          typeof ticket.status === 'string' &&
          ticket.status.toLocaleLowerCase('en') === 'open') {
        if (typeof syncTicketStaffChatCallback !== 'function') {
          syncWarning = 'Live staff chat history could not be synchronized.';
        } else {
          const syncResult = await syncTicketStaffChatCallback({ ticket, collectionName });
          if (!syncResult || syncResult.ok !== true) {
            syncWarning = syncResult?.error || 'Live staff chat history could not be synchronized.';
          } else {
            ticket = await ticketDatabase.collection(collectionName).findOne({
              _id: new ObjectId(ticketId)
            }, {
              projection: {
                _id: 1,
                ticketID: 1,
                username: 1,
                userID: 1,
                createdAt: 1,
                closedAt: 1,
                status: 1,
                staffIDs: 1,
                messages: 1
              }
            });
          }
        }
      }

      const ticketIsOpen = typeof ticket.status === 'string' &&
        ticket.status.toLocaleLowerCase('en') === 'open';
      const staffIDs = Array.isArray(ticket.staffIDs) ? ticket.staffIDs : [];
      const messages = Array.isArray(ticket.messages) ? ticket.messages.map((message) => {
        const authorID = typeof message.authorID === 'string' ? message.authorID : '';
        const isStaffChat = message.messageType === 'staff-chat' ||
          (authorID !== ticket.userID &&
            MEMBER_ID_PATTERN.test(authorID) &&
            message.sourceMessageID === message.mirrorMessageID);
        const isStaffReply = authorID !== ticket.userID &&
          (staffIDs.includes(authorID) || authorID.startsWith('app:'));
        return {
          authorID,
          authorName: typeof message.authorName === 'string' ? message.authorName : '',
          content: typeof message.content === 'string' ? message.content : '',
          timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
          authorAvatarUrl: validDiscordAvatarUrl(message.authorAvatarUrl)
            ? message.authorAvatarUrl
            : '',
          mirrorMessageID: typeof message.mirrorMessageID === 'string' ? message.mirrorMessageID : '',
          editedByID: typeof message.editedByID === 'string' ? message.editedByID : '',
          editedByName: typeof message.editedByName === 'string' ? message.editedByName : '',
          editedAt: typeof message.editedAt === 'string' ? message.editedAt : '',
          ...(isStaffChat ? { messageType: 'staff-chat' } : {}),
          canEdit: ticketIsOpen && !isStaffChat && isStaffReply &&
            MEMBER_ID_PATTERN.test(message.sourceMessageID || '') &&
            MEMBER_ID_PATTERN.test(message.mirrorMessageID || '')
        };
      }) : [];
      if (messages.every((message) => /^\d{17,20}$/.test(message.mirrorMessageID))) {
        messages.sort((left, right) => {
          const leftId = BigInt(left.mirrorMessageID);
          const rightId = BigInt(right.mirrorMessageID);
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        ticket: {
          ...serializeTicketSummary(ticket, collectionName),
          messages
        },
        canReply: MEMBER_ID_PATTERN.test(session.user.discordId || ''),
        ...(syncWarning ? { syncWarning } : {})
      });
    } catch (error) {
      return sendError(res, error, 'Ticket transcript lookup failed:');
    }
  });

  app.post('/api/tickets/:collectionName/:ticketId/reply', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });
      if (typeof sendTicketReplyCallback !== 'function') {
        return res.status(503).json({ error: 'Ticket replies are not available.' });
      }

      const { collectionName, ticketId } = req.params;
      if (!isTicketCollectionName(collectionName) || !/^[a-f\d]{24}$/i.test(ticketId)) {
        return res.status(400).json({ error: 'A valid ticket reference is required.' });
      }
      const replyText = typeof req.body?.replyText === 'string' ? req.body.replyText.trim() : '';
      if (!replyText || replyText.length > 1800) {
        return res.status(400).json({ error: 'Replies must contain 1–1800 characters.' });
      }

      const ticket = await ticketDatabase.collection(collectionName).findOne({
        _id: new ObjectId(ticketId)
      });
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      if (typeof ticket.status !== 'string' || ticket.status.toLocaleLowerCase('en') !== 'open') {
        return res.status(409).json({ error: 'Replies can only be sent on open tickets.' });
      }
      if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
        return res.status(409).json({ error: 'An administrator must link a Discord account before you can reply.' });
      }
      if (!/^\d{17,20}$/.test(ticket.userID || '') ||
          typeof ticket.ticketChannelID !== 'string' || !ticket.ticketChannelID) {
        return res.status(409).json({ error: 'This ticket is missing its Discord recipient or channel.' });
      }

      const result = await sendTicketReplyCallback({
        ticket,
        collectionName,
        appUsername: session.user.username,
        staffDiscordId: session.user.discordId,
        replyText
      });
      if (!result || result.ok !== true) {
        return res.status(result?.partial ? 502 : 503).json({
          error: result?.error || 'The reply could not be sent.',
          partial: result?.partial === true
        });
      }
      return res.status(200).json({
        authorName: typeof result.authorName === 'string' && result.authorName
          ? result.authorName
          : session.user.username
      });
    } catch (error) {
      return sendError(res, error, 'Ticket reply delivery failed:');
    }
  });

  app.post('/api/tickets/:collectionName/:ticketId/staff-chat', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });
      if (typeof sendTicketStaffMessageCallback !== 'function') {
        return res.status(503).json({ error: 'Staff chat is not available.' });
      }

      const { collectionName, ticketId } = req.params;
      if (!isTicketCollectionName(collectionName) || !/^[a-f\d]{24}$/i.test(ticketId)) {
        return res.status(400).json({ error: 'A valid ticket reference is required.' });
      }
      const messageText = typeof req.body?.messageText === 'string' ? req.body.messageText.trim() : '';
      if (!messageText || messageText.length > 1800) {
        return res.status(400).json({ error: 'Staff messages must contain 1–1800 characters.' });
      }
      if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
        return res.status(409).json({ error: 'An administrator must link a Discord account before you can use staff chat.' });
      }

      const ticket = await ticketDatabase.collection(collectionName).findOne({
        _id: new ObjectId(ticketId)
      });
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      if (typeof ticket.status !== 'string' || ticket.status.toLocaleLowerCase('en') !== 'open') {
        return res.status(409).json({ error: 'Staff chat is only available on open tickets.' });
      }
      if (!MEMBER_ID_PATTERN.test(ticket.userID || '') ||
          !MEMBER_ID_PATTERN.test(ticket.ticketChannelID || '')) {
        return res.status(409).json({ error: 'This ticket is missing its Discord recipient or channel.' });
      }

      const result = await sendTicketStaffMessageCallback({
        ticket,
        collectionName,
        staffDiscordId: session.user.discordId,
        messageText
      });
      if (!result || result.ok !== true) {
        return res.status(result?.partial ? 502 : 503).json({
          error: result?.error || 'The staff message could not be sent.',
          partial: result?.partial === true
        });
      }
      if (typeof result.authorName !== 'string' || !result.authorName) {
        return res.status(502).json({
          error: 'The staff message was sent, but its attribution could not be verified.',
          partial: true
        });
      }
      return res.status(200).json({ authorName: result.authorName });
    } catch (error) {
      return sendError(res, error, 'Ticket staff chat delivery failed:');
    }
  });

  app.post('/api/tickets/:collectionName/:ticketId/close', limited(10), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });
      if (typeof closeTicketCallback !== 'function') {
        return res.status(503).json({ error: 'Ticket closing is not available.' });
      }

      const { collectionName, ticketId } = req.params;
      const mode = req.body?.mode;
      if (!isTicketCollectionName(collectionName) ||
          !/^[a-f\d]{24}$/i.test(ticketId) ||
          !['normal', 'silent'].includes(mode)) {
        return res.status(400).json({ error: 'A valid ticket and close mode are required.' });
      }
      if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
        return res.status(409).json({ error: 'An administrator must link a Discord account before you can close tickets.' });
      }

      const ticket = await ticketDatabase.collection(collectionName).findOne({
        _id: new ObjectId(ticketId)
      });
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      if (typeof ticket.status !== 'string' || ticket.status.toLocaleLowerCase('en') !== 'open') {
        return res.status(409).json({ error: 'This ticket is already closed.' });
      }
      if (!MEMBER_ID_PATTERN.test(ticket.userID || '') ||
          typeof ticket.ticketChannelID !== 'string' || !ticket.ticketChannelID) {
        return res.status(409).json({ error: 'This ticket is missing its Discord recipient or channel.' });
      }

      const result = await closeTicketCallback({
        ticket,
        collectionName,
        mode,
        closedByID: session.user.discordId
      });
      if (!result || result.ok !== true) {
        return res.status(result?.partial ? 502 : 503).json({
          error: result?.error || 'The ticket could not be closed.',
          partial: result?.partial === true
        });
      }
      return res.status(200).json({
        mode,
        warning: typeof result.warning === 'string' ? result.warning : ''
      });
    } catch (error) {
      return sendError(res, error, 'Ticket close failed:');
    }
  });

  app.patch('/api/tickets/:collectionName/:ticketId/messages/:mirrorMessageID', limited(30), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!ticketDatabase) return res.status(503).json({ error: 'Ticket data is not configured.' });
      if (typeof editTicketReplyCallback !== 'function') {
        return res.status(503).json({ error: 'Ticket reply editing is not available.' });
      }

      const { collectionName, ticketId, mirrorMessageID } = req.params;
      if (!isTicketCollectionName(collectionName) ||
          !/^[a-f\d]{24}$/i.test(ticketId) ||
          !MEMBER_ID_PATTERN.test(mirrorMessageID)) {
        return res.status(400).json({ error: 'A valid ticket message reference is required.' });
      }
      const replyText = typeof req.body?.replyText === 'string' ? req.body.replyText.trim() : '';
      if (!replyText || replyText.length > 1800) {
        return res.status(400).json({ error: 'Edited replies must contain 1–1800 characters.' });
      }
      if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
        return res.status(409).json({ error: 'An administrator must link a Discord account before you can edit replies.' });
      }

      const tickets = ticketDatabase.collection(collectionName);
      const ticket = await tickets.findOne({ _id: new ObjectId(ticketId) });
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      if (typeof ticket.status !== 'string' || ticket.status.toLocaleLowerCase('en') !== 'open') {
        return res.status(409).json({ error: 'Replies can only be edited on open tickets.' });
      }
      const message = Array.isArray(ticket.messages)
        ? ticket.messages.find((item) => item.mirrorMessageID === mirrorMessageID)
        : null;
      if (!message) return res.status(404).json({ error: 'Ticket reply was not found.' });
      const messageAuthorID = typeof message.authorID === 'string' ? message.authorID : '';
      const isStaffReply = messageAuthorID !== ticket.userID &&
        ((Array.isArray(ticket.staffIDs) && ticket.staffIDs.includes(messageAuthorID)) ||
          messageAuthorID.startsWith('app:'));
      if (!isStaffReply ||
          !MEMBER_ID_PATTERN.test(message.sourceMessageID || '') ||
          !MEMBER_ID_PATTERN.test(message.mirrorMessageID || '')) {
        return res.status(403).json({ error: 'Only staff replies can be edited.' });
      }
      if (message.content === replyText) {
        return res.status(200).json({ authorName: message.authorName || '' });
      }

      const editedAt = new Date().toISOString();
      const result = await editTicketReplyCallback({
        ticket,
        collectionName,
        message,
        editorDiscordId: session.user.discordId,
        editedAt,
        replyText
      });
      if (!result || result.ok !== true) {
        return res.status(result?.partial ? 502 : 503).json({
          error: result?.error || 'The reply could not be edited.',
          partial: result?.partial === true
        });
      }
      if (typeof result.editedByName !== 'string' || !result.editedByName ||
          result.editedByID !== session.user.discordId || result.editedAt !== editedAt) {
        return res.status(502).json({
          error: 'The Discord messages were edited, but the edit attribution could not be verified.',
          partial: true
        });
      }

      const saved = await tickets.updateOne(
        { _id: ticket._id, status: ticket.status },
        {
          $set: {
            'messages.$[message].content': replyText,
            'messages.$[message].editedByID': result.editedByID,
            'messages.$[message].editedByName': result.editedByName,
            'messages.$[message].editedAt': result.editedAt
          }
        },
        { arrayFilters: [{ 'message.mirrorMessageID': mirrorMessageID, 'message.authorID': message.authorID }] }
      );
      if (saved.matchedCount !== 1 || saved.modifiedCount === 0) {
        return res.status(502).json({
          error: 'The Discord messages were edited, but the ticket transcript could not be updated.',
          partial: true
        });
      }
      return res.status(200).json({
        authorName: message.authorName || '',
        editedByName: result.editedByName
      });
    } catch (error) {
      return sendError(res, error, 'Ticket reply edit failed:');
    }
  });

  app.post('/api/avoids', limited(10), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!avoids || !members ||
          typeof saveAvoidRelationships !== 'function') {
        return res.status(503).json({ error: 'Avoid updates are not configured.' });
      }

      const avoiderDiscordId = req.body && req.body.avoiderDiscordId;
      const avoidedDiscordIds = req.body && req.body.avoidedDiscordIds;
      if (typeof avoiderDiscordId !== 'string' || !MEMBER_ID_PATTERN.test(avoiderDiscordId) ||
          !Array.isArray(avoidedDiscordIds) || avoidedDiscordIds.length === 0 ||
          avoidedDiscordIds.some((discordId) =>
            typeof discordId !== 'string' || !MEMBER_ID_PATTERN.test(discordId))) {
        return res.status(400).json({ error: 'Select an avoider and at least one valid Avoiding member.' });
      }
      if (new Set(avoidedDiscordIds).size !== avoidedDiscordIds.length) {
        return res.status(400).json({ error: 'Each Avoiding member can be selected only once.' });
      }
      if (avoidedDiscordIds.includes(avoiderDiscordId)) {
        return res.status(400).json({ error: 'The avoider cannot also be selected as an Avoiding member.' });
      }

      const discordIds = [avoiderDiscordId, ...avoidedDiscordIds];
      const profiles = await members.find(
        { _id: { $in: discordIds } },
        { projection: { _id: 1, discordId: 1, username: 1 } }
      ).toArray();
      const profilesById = new Map(profiles.map((profile) => [
        String(profile.discordId || profile._id || ''),
        profile
      ]));
      const users = [];
      for (const id of discordIds) {
        const profile = profilesById.get(id);
        if (!profile || typeof profile.username !== 'string' || !profile.username.trim()) {
          return res.status(400).json({ error: 'Every selected member must have a registered Discord username.' });
        }
        users.push({ id, username: profile.username.trim() });
      }

      let mongoResult;
      try {
        mongoResult = await saveAvoidRelationships(users);
      } catch (error) {
        console.error('Avoid MongoDB update failed:', error);
        return res.status(502).json({
          error: `MongoDB Avoids update failed: ${error.message}`
        });
      }
      if (!mongoResult || mongoResult.collectionName !== 'Avoids' ||
          !Number.isSafeInteger(mongoResult.relationshipCount)) {
        console.error('Avoid MongoDB update returned an invalid result.');
        return res.status(502).json({
          error: 'MongoDB Avoids update returned an invalid result.'
        });
      }

      return res.status(200).json({
        success: true,
        mongodb: { relationshipCount: mongoResult.relationshipCount }
      });
    } catch (error) {
      return sendError(res, error, 'Avoid update failed:');
    }
  });

  app.get('/api/rounds/grab-reactions/status', limited(60), async (req, res) => {
    try {
      const session = await readSession(req, res);
      if (!session) return;
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json(roundsActionState);
    } catch (error) {
      return sendError(res, error, 'Round action status lookup failed:');
    }
  });

  app.get('/api/rounds/draft/current', limited(60), async (req, res) => {
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const draft = await roundDraftCollection.findOne({ _id: 'current' });
      if (!draft || !['pending', 'approving', 'approved'].includes(draft.status)) {
        return res.status(404).json({ error: 'There is no pending Team Check draft to preview.' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        draft: await serializeCurrentRoundDraft(draft, session.user.discordId)
      });
    } catch (error) {
      return sendError(res, error, 'Team Check draft lookup failed:');
    }
  });

  app.post('/api/rounds/draft/current/open', limited(60), async (req, res) => {
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const currentDraft = await roundDraftCollection.findOne({ _id: 'current' });
      if (!currentDraft || !['pending', 'approving', 'approved'].includes(currentDraft.status)) {
        return res.status(404).json({ error: 'There is no pending Team Check draft to preview.' });
      }
      const generationId = currentDraft.generationId;
      const reviewer = {
        discordId: session.user.discordId,
        username: session.user.username,
        discordUsername: session.user.discordUsername || session.user.discordId,
        avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl)
          ? session.user.discordAvatarUrl
          : ''
      };
      if (currentDraft.status === 'pending') {
        await recordCurrentDraftViewer({
          teamCheckCollection: roundDraftCollection,
          generationId,
          reviewer
        });
      }
      if (currentDraft.status === 'approved') {
        res.set('Cache-Control', 'private, no-store');
        return res.status(200).json({
          draft: await serializeCurrentRoundDraft(currentDraft, session.user.discordId)
        });
      }
      const draft = await updateCurrentDraftViewerPresence({
        teamCheckCollection: roundDraftCollection,
        generationId,
        viewer: reviewer,
        viewing: true,
        staleAfterMs: ROUND_DRAFT_VIEWER_TTL_MS
      });
      broadcastMemberEvent('round-draft-updated', { generationId });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        draft: await serializeCurrentRoundDraft(draft, session.user.discordId)
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Team Check draft open failed:');
    }
  });

  app.post('/api/rounds/draft/current/presence', limited(120), async (req, res) => {
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const { generationId, viewing } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          typeof viewing !== 'boolean') {
        return res.status(400).json({ error: 'Choose a valid draft and viewer presence state.' });
      }
      const viewer = {
        discordId: session.user.discordId,
        username: session.user.username,
        discordUsername: session.user.discordUsername || session.user.discordId,
        avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl)
          ? session.user.discordAvatarUrl
          : ''
      };
      const draft = await updateCurrentDraftViewerPresence({
        teamCheckCollection: roundDraftCollection,
        generationId,
        viewer,
        viewing,
        staleAfterMs: ROUND_DRAFT_VIEWER_TTL_MS
      });
      if (!viewing) broadcastMemberEvent('round-draft-updated', { generationId });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        draft: await serializeCurrentRoundDraft(draft, session.user.discordId)
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Team Check viewer presence update failed:');
    }
  });

  app.post('/api/rounds/draft/current/approve', limited(10), async (req, res) => {
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      if (typeof approveCurrentRound !== 'function') {
        return res.status(503).json({ error: 'Round approval is not available right now.' });
      }
      const { generationId } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length < 1 || generationId.length > 64) {
        return res.status(400).json({ error: 'Choose a valid pending round to approve.' });
      }
      const currentDraft = await roundDraftCollection.findOne({ _id: 'current' });
      if (!currentDraft || !['pending', 'approving'].includes(currentDraft.status) ||
          currentDraft.generationId !== generationId) {
        return res.status(409).json({ error: 'The current round changed. Reload the preview and try again.' });
      }
      const result = await approveCurrentRound({
        generationId,
        actor: {
          discordId: session.user.discordId,
          username: session.user.username,
          discordUsername: session.user.discordUsername || session.user.discordId,
          avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl)
            ? session.user.discordAvatarUrl
            : ''
        }
      });
      const draft = result.draft
        ? await serializeCurrentRoundDraft(result.draft, session.user.discordId)
        : null;
      if (!result.approved) {
        return res.status(409).json({
          error: `Approval is incomplete and can be retried. ${(result.failures || []).join(' ')}`,
          partial: true,
          ...(draft ? { draft } : {})
        });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        draft,
        message: result.warnings?.length
          ? `Round #${result.round} approved with warnings: ${result.warnings.join(' ')}`
          : `Round #${result.round} approved successfully.`
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Current round approval failed:');
    }
  });

  app.post('/api/rounds/draft/current/review', limited(60), async (req, res) => {
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const { generationId, vote } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          !['approve', 'changes'].includes(vote)) {
        return res.status(400).json({ error: 'Choose a valid review mark for the current draft.' });
      }
      const reviewer = {
        discordId: session.user.discordId,
        username: session.user.username,
        discordUsername: session.user.discordUsername || session.user.discordId,
        avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl)
          ? session.user.discordAvatarUrl
          : ''
      };
      const draft = await recordCurrentDraftReview({
        teamCheckCollection: roundDraftCollection,
        generationId,
        reviewer,
        vote
      });
      broadcastMemberEvent('round-draft-updated', { generationId });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        draft: await serializeCurrentRoundDraft(draft, session.user.discordId)
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Team Check review update failed:');
    }
  });

  app.post('/api/rounds/draft/current/add-filler-team', limited(30), async (req, res) => {
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const { generationId } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64) {
        return res.status(400).json({ error: 'Choose a valid pending Team Check draft.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      const updatedDraft = await addCurrentDraftFillerTeam({
        teamCheckCollection: roundDraftCollection,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId
      });
      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'filler team addition');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Adding a filler team failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/draft/current/delete-filler-team', limited(30), async (req, res) => {
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const { generationId, teamName } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          typeof teamName !== 'string' || !teamName.trim() || teamName.length > 32) {
        return res.status(400).json({ error: 'Choose a valid filler team to delete.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      const updatedDraft = await deleteCurrentDraftFillerTeam({
        teamCheckCollection: roundDraftCollection,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId,
        teamName: teamName.trim()
      });
      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'filler team deletion');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Deleting the filler team failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/draft/current/replace-player', limited(30), async (req, res) => {
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      if (!members) return res.status(503).json({ error: 'Member data is not configured.' });
      const { generationId, playerDiscordId, replacementDiscordId } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          !MEMBER_ID_PATTERN.test(playerDiscordId || '') ||
          !MEMBER_ID_PATTERN.test(replacementDiscordId || '')) {
        return res.status(400).json({ error: 'Choose a valid player and replacement member.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      const updatedDraft = await replaceCurrentDraftPlayer({
        teamCheckCollection: roundDraftCollection,
        membersCollection: members,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId,
        playerDiscordId,
        replacementDiscordId
      });
      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'player replacement');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Replacing a draft player failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/draft/current/replace-player-with-filler', limited(30), async (req, res) => {
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const { generationId, playerDiscordId } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          !MEMBER_ID_PATTERN.test(playerDiscordId || '')) {
        return res.status(400).json({ error: 'Choose a valid player to replace with a filler.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      const updatedDraft = await replaceCurrentDraftPlayerWithFiller({
        teamCheckCollection: roundDraftCollection,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId,
        playerDiscordId
      });
      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'player-to-filler replacement');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Replacing a draft player with a filler failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/draft/current/fill-slot', limited(30), async (req, res) => {
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      if (!members) return res.status(503).json({ error: 'Member data is not configured.' });
      const {
        generationId,
        targetTeam,
        targetSlotIndex,
        replacementDiscordId
      } = req.body || {};
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          typeof targetTeam !== 'string' || !targetTeam.trim() || targetTeam.length > 32 ||
          !Number.isInteger(targetSlotIndex) ||
          !MEMBER_ID_PATTERN.test(replacementDiscordId || '')) {
        return res.status(400).json({ error: 'Choose a valid filler slot and replacement member.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      const updatedDraft = await addCurrentDraftMemberToFillerSlot({
        teamCheckCollection: roundDraftCollection,
        membersCollection: members,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId,
        targetTeamName: targetTeam.trim(),
        targetSlotIndex,
        replacementDiscordId
      });
      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'filler replacement');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Filling the Team Check slot failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/draft/current/swap', limited(30), async (req, res) => {
    let updatedDraft = null;
    let mutationLockAcquired = false;
    try {
      const session = await readRoundDraftSession(req, res);
      if (!session) return;
      const {
        generationId,
        playerDiscordId,
        sourceTeam,
        sourceSlotIndex,
        sourceDiscordId,
        targetTeam,
        targetSlotIndex,
        targetDiscordId
      } = req.body || {};
      const hasPlayerId = MEMBER_ID_PATTERN.test(playerDiscordId || '');
      const hasSourceSlot = typeof sourceTeam === 'string' && sourceTeam.trim() &&
        sourceTeam.length <= 32 && Number.isInteger(sourceSlotIndex) &&
        (sourceDiscordId === '' || MEMBER_ID_PATTERN.test(sourceDiscordId || ''));
      if (typeof generationId !== 'string' || generationId.length > 64 ||
          (!hasPlayerId && !hasSourceSlot) ||
          typeof targetTeam !== 'string' || !targetTeam.trim() || targetTeam.length > 32 ||
          !Number.isInteger(targetSlotIndex) ||
          (targetDiscordId !== '' && !MEMBER_ID_PATTERN.test(targetDiscordId || ''))) {
        return res.status(400).json({ error: 'Choose a valid player and destination team slot.' });
      }
      if (roundDraftMutationRunning) {
        return res.status(409).json({ error: 'Another team adjustment is being saved. Try again shortly.' });
      }
      roundDraftMutationRunning = true;
      mutationLockAcquired = true;
      updatedDraft = await swapCurrentDraftPlayers({
        teamCheckCollection: roundDraftCollection,
        avoidsCollection: roundAvoidsCollection,
        previousPairingsCollection,
        generationId,
        playerDiscordId,
        sourceTeamName: sourceTeam,
        sourceSlotIndex,
        sourceDiscordId,
        targetTeamName: targetTeam.trim(),
        targetSlotIndex,
        targetDiscordId
      });

      return await respondWithUpdatedRoundDraft(updatedDraft, session, res, 'team swap');
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return sendError(res, error, 'Team Check adjustment failed:');
    } finally {
      if (mutationLockAcquired) roundDraftMutationRunning = false;
    }
  });

  app.post('/api/rounds/grab-reactions', limited(3), async (req, res) => {
    let actionLockAcquired = false;
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!MEMBER_ID_PATTERN.test(session.user.discordId || '')) {
        return res.status(403).json({
          error: 'Link your Discord account before generating a round.'
        });
      }
      if (typeof canGrabRoundReactions !== 'function' ||
          typeof grabRoundReactions !== 'function') {
        return res.status(503).json({ error: 'Round generation is not configured.' });
      }
      if (!await canGrabRoundReactions(session.user.discordId)) {
        return res.status(403).json({
          error: 'Your linked Discord account does not have an allowed bot role.'
        });
      }
      if (roundsActionState.running) {
        res.set('Cache-Control', 'private, no-store');
        return res.status(409).json({
          error: 'Round generation is already in progress.',
          roundActionState: roundsActionState
        });
      }

      roundsActionState = {
        running: true,
        lastClickedBy: {
          username: session.user.username,
          discordUsername: session.user.discordUsername || session.user.discordId,
          avatarUrl: validDiscordAvatarUrl(session.user.discordAvatarUrl)
            ? session.user.discordAvatarUrl
            : ''
        },
        lastClickedAt: new Date().toISOString(),
        lastOutcome: 'running'
      };
      actionLockAcquired = true;
      broadcastMemberEvent('rounds-action-status', roundsActionState);
      const { draft, postingStatus } = await grabRoundReactions();
      const finalChecks = draft.checks?.final;
      if (!finalChecks ||
          !Array.isArray(finalChecks.previousConflicts) ||
          !Array.isArray(finalChecks.avoidConflicts) ||
          !Array.isArray(finalChecks.regionErrors)) {
        throw new Error('Team generation returned an invalid conflict audit.');
      }
      const cleanLabel = (label) => String(label || 'Unknown')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 80);
      const conflictDetails = [
        ...finalChecks.previousConflicts.map(({ team, playerA, playerB }) =>
          `Previous pairing in Team ${cleanLabel(team)}: ${cleanLabel(playerA)} and ${cleanLabel(playerB)}`),
        ...finalChecks.avoidConflicts.map(({ team, playerA, playerB }) =>
          `Avoid conflict in Team ${cleanLabel(team)}: ${cleanLabel(playerA)} and ${cleanLabel(playerB)}`),
        ...finalChecks.regionErrors.map((team) =>
          `Region conflict in Team ${cleanLabel(team)}`)
      ];
      const conflictsFound = conflictDetails.length > 0;
      broadcastMemberEvent('round-draft-updated', { generationId: draft.generationId });
      roundsActionState = { ...roundsActionState, running: false, lastOutcome: 'success' };
      broadcastMemberEvent('rounds-action-status', roundsActionState);
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        round: draft.round,
        reactedPlayerCount: draft.reactedPlayerCount,
        eligiblePlayerCount: draft.eligiblePlayerCount,
        excludedPlayerCount: draft.excludedPlayers.length,
        conflictsFound,
        conflictDetails,
        postingStatus,
        roundActionState: roundsActionState
      });
    } catch (error) {
      if (error instanceof TeamGenerationError) {
        if (actionLockAcquired) {
          roundsActionState = { ...roundsActionState, running: false, lastOutcome: 'failed' };
          broadcastMemberEvent('rounds-action-status', roundsActionState);
        }
        console.error('Rounds-tab team generation failed:', error);
        return res.status(error.statusCode).json({
          error: error.message,
          partial: error.partial,
          round: error.round,
          ...(actionLockAcquired ? { roundActionState: roundsActionState } : {})
        });
      }
      if (actionLockAcquired) {
        roundsActionState = { ...roundsActionState, running: false, lastOutcome: 'failed' };
        broadcastMemberEvent('rounds-action-status', roundsActionState);
      }
      return sendError(res, error, 'Rounds-tab team generation failed:');
    }
  });

  app.patch('/api/members/:discordId', limited(30), async (req, res) => {
    let discordNicknameUpdated = false;
    try {
      const session = await readSession(req, res);
      if (!session) return;
      if (!members) return res.status(503).json({ error: 'Member data is not configured.' });

      const { discordId } = req.params;
      if (!MEMBER_ID_PATTERN.test(discordId)) {
        return res.status(400).json({ error: 'A valid Discord ID is required.' });
      }
      let updates;
      try {
        updates = normalizeMemberUpdates(req.body);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const currentProfile = await members.findOne({ _id: discordId });
      if (!currentProfile) return res.status(404).json({ error: 'Member not found.' });
      if (Object.hasOwn(updates, 'nickname') && updates.nickname !== (currentProfile.nickname || '')) {
        if (typeof updateDiscordNickname !== 'function') {
          return res.status(503).json({ error: 'Discord nickname syncing is not configured.' });
        }
        try {
          await updateDiscordNickname(discordId, updates.nickname);
          discordNicknameUpdated = true;
        } catch (error) {
          console.error('Discord nickname update failed:', error);
          const code = Number(error.code);
          const message = code === 50013
            ? 'The bot cannot change this member’s nickname. Check its Manage Nicknames permission and role hierarchy.'
            : code === 10007
              ? 'This Discord user is not a member of the configured server.'
              : 'Could not update the Discord nickname. The member profile was not saved.';
          return res.status(502).json({ error: message });
        }
      }

      const result = await members.updateOne({ _id: discordId }, { $set: updates });
      if (!result.matchedCount) {
        if (discordNicknameUpdated) {
          return res.status(503).json({
            error: 'Discord nickname was updated, but the member profile no longer exists in MongoDB.'
          });
        }
        return res.status(404).json({ error: 'Member not found.' });
      }
      const profile = await members.findOne({ _id: discordId });
      if (!profile) {
        if (discordNicknameUpdated) {
          return res.status(503).json({
            error: 'Discord nickname was updated, but the member profile could not be reloaded from MongoDB.'
          });
        }
        return res.status(404).json({ error: 'Member not found.' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({
        member: serializeMember(profile),
        discordNicknameUpdated
      });
    } catch (error) {
      if (discordNicknameUpdated) {
        console.error('Member profile save failed after Discord nickname was updated:', error);
        return res.status(503).json({
          error: 'Discord nickname was updated, but the member profile could not be saved to MongoDB. Please retry the update.'
        });
      }
      return sendError(res, error, 'Member update failed:');
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
        projection: {
          _id: 0,
          username: 1,
          discordId: 1,
          discordUsername: 1,
          discordAvatarUrl: 1,
          active: 1,
          createdAt: 1,
          lastLoginAt: 1,
          lastAppVersion: 1
        }
      }).sort({ username: 1 }).toArray();
      return res.status(200).json({
        accounts: accounts.map((item) => ({
          username: item.username,
          discordId: typeof item.discordId === 'string' ? item.discordId : '',
          discordUsername: typeof item.discordUsername === 'string' ? item.discordUsername : '',
          discordAvatarUrl: validDiscordAvatarUrl(item.discordAvatarUrl) ? item.discordAvatarUrl : '',
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
    const rawDiscordId = req.body?.discordId;
    if (rawDiscordId !== undefined && typeof rawDiscordId !== 'string') {
      return res.status(400).json({ error: 'Discord ID must be text.' });
    }
    const discordId = typeof rawDiscordId === 'string' ? rawDiscordId.trim() : '';
    if (discordId && !MEMBER_ID_PATTERN.test(discordId)) {
      return res.status(400).json({ error: 'Enter a valid Discord user ID.' });
    }
    try {
      let discordProfile = null;
      if (discordId) {
        const existingLink = await users.findOne({ discordId });
        if (existingLink) return res.status(409).json({ error: 'That Discord ID is already linked to an app account.' });
        if (typeof getDiscordProfile !== 'function') {
          return res.status(503).json({ error: 'Discord profile lookup is not available.' });
        }
        try {
          discordProfile = await getDiscordProfile(discordId);
        } catch (error) {
          console.error('Discord profile lookup failed during account creation:', error);
          return res.status(502).json({ error: 'The bot could not verify that Discord ID.' });
        }
        if (!discordProfile || typeof discordProfile.username !== 'string' ||
            !validDiscordAvatarUrl(discordProfile.avatarUrl)) {
          return res.status(502).json({ error: 'The bot returned an invalid Discord profile.' });
        }
      }
      const password = generatePassword();
      await users.insertOne({
        username,
        passwordHash: await bcrypt.hash(password, 12),
        active: true,
        tokenVersion: 0,
        mustChangePassword: true,
        createdAt: new Date(),
        ...(discordProfile ? {
          discordId,
          discordUsername: discordProfile.username,
          discordAvatarUrl: discordProfile.avatarUrl
        } : {})
      });
      const auditLogged = await recordAdminAction('create-account', username);
      return res.status(201).json({
        username,
        password,
        discordId,
        discordUsername: discordProfile?.username || '',
        discordAvatarUrl: discordProfile?.avatarUrl || '',
        auditLogged
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'That username already exists.' });
      return sendError(res, error, 'Admin account creation failed:');
    }
  });

  app.post('/api/admin/users/link-discord', adminMutationLimit, async (req, res) => {
    if (!authorizeAdmin(req, res)) return;
    const username = normalizeUsername(req.body && req.body.username);
    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({ error: 'A valid account username is required.' });
    }
    if (typeof req.body?.discordId !== 'string') {
      return res.status(400).json({ error: 'Discord ID must be text.' });
    }
    const discordId = req.body.discordId.trim();
    if (discordId && !MEMBER_ID_PATTERN.test(discordId)) {
      return res.status(400).json({ error: 'Enter a valid Discord user ID.' });
    }

    try {
      let update;
      let discordProfile = null;
      if (discordId) {
        const existingLink = await users.findOne({ discordId, username: { $ne: username } });
        if (existingLink) return res.status(409).json({ error: 'That Discord ID is already linked to another app account.' });
        if (typeof getDiscordProfile !== 'function') {
          return res.status(503).json({ error: 'Discord profile lookup is not available.' });
        }
        try {
          discordProfile = await getDiscordProfile(discordId);
        } catch (error) {
          console.error('Discord profile lookup failed while linking an app account:', error);
          return res.status(502).json({ error: 'The bot could not verify that Discord ID.' });
        }
        if (!discordProfile || typeof discordProfile.username !== 'string' ||
            !validDiscordAvatarUrl(discordProfile.avatarUrl)) {
          return res.status(502).json({ error: 'The bot returned an invalid Discord profile.' });
        }
        update = {
          $set: {
            discordId,
            discordUsername: discordProfile.username,
            discordAvatarUrl: discordProfile.avatarUrl
          }
        };
      } else {
        update = { $unset: { discordId: '', discordUsername: '', discordAvatarUrl: '' } };
      }

      const result = await users.updateOne({ username }, update);
      if (!result.matchedCount) return res.status(404).json({ error: 'Account was not found.' });
      const auditLogged = await recordAdminAction(
        discordId ? 'link-discord-account' : 'unlink-discord-account',
        username
      );
      return res.status(200).json({
        username,
        discordId,
        discordUsername: discordProfile?.username || '',
        discordAvatarUrl: discordProfile?.avatarUrl || '',
        auditLogged
      });
    } catch (error) {
      return sendError(res, error, 'Discord account link update failed:');
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
    const fromIsDateOnly = typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from);
    const toIsDateOnly = typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to);
    if ((from !== undefined && fromIsDateOnly && !validDateFilter(from)) ||
        (to !== undefined && toIsDateOnly && !validDateFilter(to))) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
    }
    const fromDate = from === undefined
      ? null
      : fromIsDateOnly ? easternDateBoundary(from) : new Date(from);
    let toDate = to === undefined
      ? null
      : toIsDateOnly ? easternDateBoundary(nextCalendarDate(to)) : new Date(to);
    if ((fromDate && Number.isNaN(fromDate.getTime())) ||
        (toDate && Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: 'Audit date range is invalid.' });
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
        projection: { _id: 0, actor: 1, action: 1, username: 1, at: 1, details: 1 }
      }).sort({ at: -1 }).limit(1001).toArray();
      return res.status(200).json({
        events: events.slice(0, 1000).map((event) => ({
          actor: event.actor,
          action: event.action,
          username: event.username,
          at: event.at instanceof Date ? event.at.toISOString() : null,
          details: event.details && typeof event.details === 'object' ? event.details : null
        })),
        truncated: events.length > 1000
      });
    } catch (error) {
      return sendError(res, error, 'Admin audit search failed:');
    }
  });

  return app;
}

async function createRuntime({ discordClient, discordGuildId = process.env.GUILD_ID } = {}) {
  const {
    MONGO_URI,
    MONGODB_ADMIN,
    MONGODB_HOEDOWNINFO,
    MONGODB_ROUNDS,
    MONGODB_TICKETS,
    JWT_SECRET,
    ADMIN_API_KEY,
    ADMIN_PUBLIC_ORIGIN
  } = process.env;
  if (!MONGO_URI || !MONGODB_ADMIN || !JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('Set MONGO_URI, MONGODB_ADMIN, and a JWT_SECRET of at least 32 characters.');
  }
  if (ADMIN_API_KEY && ADMIN_API_KEY.length < 32) {
    throw new Error('ADMIN_API_KEY must be at least 32 characters when set.');
  }
  if (!validAdminPublicOrigin(ADMIN_PUBLIC_ORIGIN)) {
    throw new Error('Set ADMIN_PUBLIC_ORIGIN to the exact HTTPS service origin (HTTP localhost is allowed for development).');
  }
  const client = new MongoClient(MONGO_URI);
  let unregisterTeamCheckPreviewSync = () => {};
  try {
    await client.connect();
    const database = client.db(MONGODB_ADMIN);
    const users = database.collection('users');
    const devices = database.collection('userDevices');
    const audit = database.collection('adminAudit');
    const adminPasskeyCredentials = database.collection('adminPasskeyCredentials');
    const adminPasskeyChallenges = database.collection('adminPasskeyChallenges');
    const adminPasskeyTickets = database.collection('adminPasskeyTickets');
    const adminHandoffCodes = database.collection('adminHandoffCodes');
    const adminSessions = database.collection('adminSessions');
    const adminPasskeyState = database.collection('adminPasskeyState');
    const botSettingsCollection = database.collection(BOT_SETTINGS_COLLECTION);
    const hoedownDatabaseName = typeof MONGODB_HOEDOWNINFO === 'string'
      ? MONGODB_HOEDOWNINFO.trim()
      : '';
    const hoedownDatabase = hoedownDatabaseName
      ? client.db(hoedownDatabaseName)
      : null;
    const roundsDatabaseName = typeof MONGODB_ROUNDS === 'string'
      ? MONGODB_ROUNDS.trim()
      : '';
    const roundsDatabase = roundsDatabaseName ? client.db(roundsDatabaseName) : null;
    const roundCollections = roundsDatabase
      ? {
        playersThatReacted: roundsDatabase.collection('PlayersThatReacted'),
        teamCheck: roundsDatabase.collection('TeamCheck')
      }
      : null;
    const ticketDatabaseName = typeof MONGODB_TICKETS === 'string'
      ? MONGODB_TICKETS.trim()
      : '';
    const ticketDatabase = ticketDatabaseName ? client.db(ticketDatabaseName) : null;
    const adminDatabaseName = MONGODB_ADMIN.trim();
    const backupSources = [
      { databaseName: hoedownDatabaseName, database: hoedownDatabase },
      { databaseName: roundsDatabaseName, database: roundsDatabase },
      { databaseName: ticketDatabaseName, database: ticketDatabase }
    ].filter(({ databaseName, database }) =>
      database && databaseName && databaseName !== adminDatabaseName && databaseName !== 'Backups');
    const backupDatabase = adminDatabaseName === 'Backups' ? null : client.db('Backups');
    const members = hoedownDatabase ? hoedownDatabase.collection('Members') : null;
    const avoids = hoedownDatabase ? hoedownDatabase.collection('Avoids') : null;
    const sendTicketReply = discordClient && ticketDatabase
      ? async ({ ticket, collectionName, appUsername, staffDiscordId, replyText }) => {
        if (!discordClient.isReady()) {
          return { ok: false, error: 'The Discord bot is not ready to send replies.' };
        }

        let recipient;
        let channel;
        let staffProfile;
        try {
          [recipient, channel, staffProfile] = await Promise.all([
            discordClient.users.fetch(ticket.userID),
            discordClient.channels.fetch(ticket.ticketChannelID),
            discordClient.users.fetch(staffDiscordId)
          ]);
        } catch (error) {
          console.error('Could not load a Discord account or destination for a ticket reply:', error);
          return { ok: false, error: 'Could not access the linked Discord account, ticket recipient, or channel.' };
        }
        if (!recipient || !channel || typeof channel.send !== 'function' ||
            typeof channel.isTextBased !== 'function' || !channel.isTextBased() ||
            !staffProfile || typeof staffProfile.displayAvatarURL !== 'function') {
          return { ok: false, error: 'The linked Discord account, recipient, or text channel is unavailable.' };
        }

        let dmMessage;
        try {
          dmMessage = await recipient.send(`${SUPPORT_REPLY_PREFIX}${replyText}`);
        } catch (error) {
          console.error('Could not send a ticket reply to the customer DM:', error);
          return { ok: false, error: 'Could not send the reply to the customer’s DMs.' };
        }

        const timestamp = dmMessage.createdAt instanceof Date
          ? dmMessage.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })
          : new Date().toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
        const staffAvatarUrl = staffProfile.displayAvatarURL({ extension: 'png', size: 64 });
        const staffName = staffProfile.tag;
        const mirrorEmbed = {
          color: 0x3498db,
          author: { name: staffName, icon_url: staffAvatarUrl },
          description: replyText,
          footer: { text: `Sent DM Message ID: ${dmMessage.id} | Staff ID: ${staffDiscordId} | App Username: ${appUsername}` },
          timestamp: dmMessage.createdAt instanceof Date
            ? dmMessage.createdAt.toISOString()
            : new Date().toISOString()
        };
        let mirroredMessage;
        try {
          mirroredMessage = await channel.send({ embeds: [mirrorEmbed] });
        } catch (error) {
          console.error('Ticket reply DM was sent but its channel mirror failed:', error);
          return {
            ok: false,
            partial: true,
            error: 'The DM was sent, but the ticket-channel mirror failed. Do not resend this reply.'
          };
        }

        try {
          const result = await ticketDatabase.collection(collectionName).updateOne(
            { _id: ticket._id, status: ticket.status },
            {
              $addToSet: {
                messages: {
                  sourceMessageID: dmMessage.id,
                  mirrorMessageID: mirroredMessage.id,
                  authorID: staffDiscordId,
                  authorName: staffName,
                  authorAvatarUrl: staffAvatarUrl,
                  content: replyText,
                  timestamp
                },
                staffIDs: staffDiscordId
              }
            }
          );
          if (result.matchedCount !== 1) {
            return {
              ok: false,
              partial: true,
              error: 'The DM and channel mirror were sent, but the ticket changed before the transcript could be saved.'
            };
          }
        } catch (error) {
          console.error('Ticket reply was delivered but could not be saved to the transcript:', error);
          return {
            ok: false,
            partial: true,
            error: 'The DM and channel mirror were sent, but the transcript could not be saved.'
          };
        }
        return { ok: true, authorName: staffName };
      }
      : null;
    const editTicketReply = discordClient && ticketDatabase
      ? async ({ ticket, message, editorDiscordId, editedAt, replyText }) => {
        if (!discordClient.isReady()) {
          return { ok: false, error: 'The Discord bot is not ready to edit replies.' };
        }

        let recipient;
        let channel;
        let editorProfile;
        try {
          [recipient, channel, editorProfile] = await Promise.all([
            discordClient.users.fetch(ticket.userID),
            discordClient.channels.fetch(ticket.ticketChannelID),
            discordClient.users.fetch(editorDiscordId)
          ]);
        } catch (error) {
          console.error('Could not load a Discord account or destination for a ticket reply edit:', error);
          return { ok: false, error: 'Could not access the linked editor account, ticket recipient, or channel.' };
        }
        if (!recipient || !channel || typeof channel.isTextBased !== 'function' ||
            !channel.isTextBased() || !channel.messages?.fetch) {
          return { ok: false, error: 'The ticket recipient or text channel is unavailable.' };
        }

        let dmMessage;
        let mirroredMessage;
        try {
          const dmChannel = recipient.dmChannel || await recipient.createDM();
          [dmMessage, mirroredMessage] = await Promise.all([
            dmChannel.messages.fetch(message.sourceMessageID),
            channel.messages.fetch(message.mirrorMessageID)
          ]);
        } catch (error) {
          console.error('Could not load the Discord messages for a ticket reply edit:', error);
          return { ok: false, error: 'Could not find both original reply messages to edit.' };
        }

        const botId = discordClient.user && discordClient.user.id;
        const mirrorEmbed = mirroredMessage.embeds[0];
        const mirrorFooter = mirrorEmbed?.footer?.text || '';
        const footerStaffId = /Staff ID:\s*(\d+)/.exec(mirrorFooter)?.[1] || '';
        const footerAppUsername = /App Username:\s*([A-Za-z0-9._-]{1,64})/.exec(mirrorFooter)?.[1] || '';
        const expectedAttribution = message.authorID.startsWith('app:')
          ? footerAppUsername === message.authorID.slice('app:'.length)
          : footerStaffId === message.authorID;
        if (!botId || dmMessage.author.id !== botId || mirroredMessage.author.id !== botId ||
            !editorProfile || typeof editorProfile.tag !== 'string' || !editorProfile.tag ||
            !dmMessage.content.startsWith(SUPPORT_REPLY_PREFIX) ||
            dmMessage.content !== `${SUPPORT_REPLY_PREFIX}${message.content}` ||
            !mirrorEmbed || typeof mirrorEmbed.toJSON !== 'function' ||
            mirrorEmbed.description !== message.content || !expectedAttribution) {
          return { ok: false, error: 'The original Discord messages no longer match this archived support reply.' };
        }

        const previousDmContent = dmMessage.content;
        const embedData = mirrorEmbed.toJSON();
        const previousFooter = mirrorFooter
          .replace(/\s*\|\s*Edited by:\s*[^|]*/g, '')
          .replace(/\s*\|\s*Edited by ID:\s*\d+/g, '')
          .replace(/\s*\|\s*Edited at ISO:\s*[^|]*/g, '')
          .replace(/\s*\|\s*Edited at:\s*[^|]*/g, '')
          .trim();
        const editedAtDisplay = new Date(editedAt).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          timeZoneName: 'short'
        });
        const updatedEmbed = {
          ...embedData,
          description: replyText,
          footer: {
            ...(embedData.footer || {}),
            text: [
              previousFooter,
              `Edited by: ${editorProfile.tag}`,
              `Edited by ID: ${editorDiscordId}`,
              `Edited at: ${editedAtDisplay}`
            ].filter(Boolean).join(' | ')
          }
        };
        let dmUpdated = false;
        try {
          await dmMessage.edit({ content: `${SUPPORT_REPLY_PREFIX}${replyText}` });
          dmUpdated = true;
          await mirroredMessage.edit({ embeds: [updatedEmbed] });
        } catch (error) {
          console.error('Could not edit a Discord ticket reply:', error);
          if (dmUpdated) {
            try {
              await dmMessage.edit({ content: previousDmContent });
            } catch (rollbackError) {
              console.error('Could not restore the customer DM after a partial ticket reply edit:', rollbackError);
              return {
                ok: false,
                partial: true,
                error: 'The DM was edited, but the channel mirror failed and the original DM could not be restored.'
              };
            }
          }
          return { ok: false, error: 'Could not update both original Discord messages; no transcript change was saved.' };
        }
        return {
          ok: true,
          editedByID: editorDiscordId,
          editedByName: editorProfile.tag,
          editedAt
        };
      }
      : null;
    const ticketManager = discordClient && ticketDatabase
      ? require('../../database/ticketManager')
      : null;
    const closeTicketAndSave = ticketManager && ticketManager.closeTicketAndSave;
    const recordTicketMessage = ticketManager && ticketManager.recordTicketMessage;
    const staffChatSyncs = new Map();
    const syncTicketStaffChat = typeof recordTicketMessage === 'function'
      ? async ({ ticket, collectionName }) => {
        if (!discordClient.isReady()) {
          return { ok: false, error: 'The Discord bot is not ready to load staff chat history.' };
        }
        if (staffChatSyncs.has(ticket.ticketChannelID)) {
          return staffChatSyncs.get(ticket.ticketChannelID);
        }

        const sync = (async () => {
          const channel = await discordClient.channels.fetch(ticket.ticketChannelID);
          if (!channel || !channel.messages?.fetch) {
            throw new Error('The ticket text channel is unavailable.');
          }

          const channelMessages = [];
          let lastID = null;
          while (true) {
            const options = { limit: 100 };
            if (lastID) options.before = lastID;
            const fetched = await channel.messages.fetch(options);
            if (fetched.size === 0) break;
            channelMessages.push(...fetched.values());
            lastID = fetched.last().id;
          }

          const knownMessageIDs = new Set(
            (Array.isArray(ticket.messages) ? ticket.messages : [])
              .flatMap((message) => [message.sourceMessageID, message.mirrorMessageID])
              .filter(Boolean)
          );
          const username = typeof ticket.username === 'string' && ticket.username
            ? ticket.username
            : collectionName.slice(0, -'_Tickets'.length);
          const user = { id: ticket.userID, username };
          for (const message of channelMessages.reverse()) {
            const footer = message.embeds.map((embed) => embed.footer?.text || '').join(' ');
            const isAppStaffChat = /Message Type:\s*Staff Chat/i.test(footer);
            const isHumanStaffChat = message.author.bot === false &&
              message.author.id !== ticket.userID &&
              !message.content?.trim().startsWith('!');
            if ((!isAppStaffChat && !isHumanStaffChat) || knownMessageIDs.has(message.id)) continue;

            const staffId = /Staff ID:\s*(\d+)/.exec(footer)?.[1] || message.author.id;
            const embedAuthor = message.embeds.find((embed) => embed.author?.name)?.author;
            const attachments = [...message.attachments.values()]
              .map((attachment) => `[Attachment: ${attachment.url}]`)
              .join('\n');
            await recordTicketMessage(channel, user, {
              sourceMessageID: message.id,
              mirrorMessageID: message.id,
              authorID: staffId,
              authorName: embedAuthor?.name || message.author.tag || message.author.username,
              authorAvatarUrl: embedAuthor?.iconURL ||
                message.author.displayAvatarURL({ extension: 'png', size: 64 }),
              content: isAppStaffChat
                ? message.embeds.find((embed) => embed.description)?.description || '*No text content*'
                : message.content?.trim() || attachments || '*No text content*',
              timestamp: message.createdAt.toLocaleString('en-US', {
                timeZone: 'America/New_York',
                timeZoneName: 'short'
              }),
              messageType: 'staff-chat',
              staffID: staffId
            });
            knownMessageIDs.add(message.id);
          }
          return { ok: true };
        })();
        staffChatSyncs.set(ticket.ticketChannelID, sync);
        try {
          return await sync;
        } catch (error) {
          staffChatSyncs.delete(ticket.ticketChannelID);
          console.error('Could not synchronize existing Discord staff chat messages:', error);
          return { ok: false, error: 'Could not load existing staff chat from the ticket channel.' };
        }
      }
      : null;
    const sendTicketStaffMessage = discordClient && ticketDatabase
      ? async ({ ticket, collectionName, staffDiscordId, messageText }) => {
        if (!discordClient.isReady()) {
          return { ok: false, error: 'The Discord bot is not ready to send staff chat messages.' };
        }

        let channel;
        let staffProfile;
        try {
          [channel, staffProfile] = await Promise.all([
            discordClient.channels.fetch(ticket.ticketChannelID),
            discordClient.users.fetch(staffDiscordId)
          ]);
        } catch (error) {
          console.error('Could not load a Discord channel or staff profile for staff chat:', error);
          return { ok: false, error: 'Could not access the linked Discord account or ticket channel.' };
        }
        if (!channel || typeof channel.send !== 'function' ||
            typeof channel.isTextBased !== 'function' || !channel.isTextBased() ||
            !staffProfile || typeof staffProfile.displayAvatarURL !== 'function' ||
            typeof staffProfile.tag !== 'string' || !staffProfile.tag) {
          return { ok: false, error: 'The linked Discord account or ticket channel is unavailable.' };
        }

        const authorAvatarUrl = staffProfile.displayAvatarURL({ extension: 'png', size: 64 });
        const timestamp = new Date();
        let channelMessage;
        try {
          channelMessage = await channel.send({
            embeds: [{
              color: 0x5865f2,
              author: { name: staffProfile.tag, icon_url: authorAvatarUrl },
              description: messageText,
              footer: { text: `Message Type: Staff Chat | Staff ID: ${staffDiscordId}` },
              timestamp: timestamp.toISOString()
            }]
          });
        } catch (error) {
          console.error('Could not post a staff chat message in the ticket channel:', error);
          return { ok: false, error: 'Could not post the staff message in the ticket channel.' };
        }

        try {
          const result = await ticketDatabase.collection(collectionName).updateOne(
            { _id: ticket._id, status: ticket.status },
            {
              $addToSet: {
                messages: {
                  sourceMessageID: channelMessage.id,
                  mirrorMessageID: channelMessage.id,
                  authorID: staffDiscordId,
                  authorName: staffProfile.tag,
                  authorAvatarUrl,
                  messageType: 'staff-chat',
                  content: messageText,
                  timestamp: timestamp.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    timeZoneName: 'short'
                  })
                },
                staffIDs: staffDiscordId
              }
            }
          );
          if (result.matchedCount !== 1) {
            return {
              ok: false,
              partial: true,
              error: 'The staff message was posted, but the ticket changed before it could be saved. Do not resend it.'
            };
          }
        } catch (error) {
          console.error('Staff chat message was posted but could not be saved to the transcript:', error);
          return {
            ok: false,
            partial: true,
            error: 'The staff message was posted, but could not be saved to the transcript. Do not resend it.'
          };
        }
        return { ok: true, authorName: staffProfile.tag };
      }
      : null;
    const closeTicket = typeof closeTicketAndSave === 'function'
      ? async ({ ticket, collectionName, mode, closedByID }) => {
        if (!discordClient.isReady()) {
          return { ok: false, error: 'The Discord bot is not ready to close tickets.' };
        }

        let recipient;
        let channel;
        try {
          [recipient, channel] = await Promise.all([
            discordClient.users.fetch(ticket.userID),
            discordClient.channels.fetch(ticket.ticketChannelID)
          ]);
        } catch (error) {
          console.error('Could not load a Discord account or channel for ticket closure:', error);
          return { ok: false, error: 'Could not access the ticket recipient or channel.' };
        }
        if (!recipient || !channel || typeof channel.delete !== 'function' ||
            !channel.messages?.fetch) {
          return { ok: false, error: 'The ticket recipient or channel is unavailable.' };
        }

        const collectionSuffix = '_Tickets';
        const username = typeof ticket.username === 'string' && ticket.username
          ? ticket.username
          : collectionName.slice(0, -collectionSuffix.length);
        try {
          await closeTicketAndSave(channel, { id: recipient.id, username }, closedByID);
        } catch (error) {
          console.error('Could not archive a ticket before closing its channel:', error);
          return { ok: false, error: 'Could not save the ticket transcript; the channel was left open.' };
        }

        let warning = '';
        if (mode === 'normal') {
          try {
            await recipient.send('📩 Your support ticket has been closed.');
          } catch (error) {
            console.error('Ticket was archived, but the customer closure notice could not be sent:', error);
            warning = 'The ticket was closed, but the customer could not be notified.';
          }
        }

        try {
          await channel.delete();
        } catch (error) {
          console.error('Ticket was archived, but its Discord channel could not be deleted:', error);
          return {
            ok: false,
            partial: true,
            error: warning
              ? `${warning} The ticket was archived, but its Discord channel could not be deleted.`
              : 'The ticket was archived, but its Discord channel could not be deleted.'
          };
        }
        return { ok: true, warning };
      }
      : null;
    const canGrabRoundReactions = discordClient && discordGuildId
      ? async (discordId) => {
        if (!discordClient.isReady()) return false;
        const guild = discordClient.guilds.cache.get(discordGuildId)
          || await discordClient.guilds.fetch(discordGuildId);
        let member;
        try {
          member = await guild.members.fetch(discordId);
        } catch (error) {
          if (error.code === 10007) return false;
          throw error;
        }
        const allowedRoles = Array.isArray(config.allowedRoles) ? config.allowedRoles : [];
        return member.roles.cache.some((role) => allowedRoles.includes(role.id));
      }
      : null;
    const grabRoundReactions = async () => {
      if (!discordClient || !discordClient.isReady() || !roundsDatabase ||
          !roundCollections || !members || !avoids || !hoedownDatabase) {
        throw new TeamGenerationError('Round generation is not available right now.');
      }

      const botSettings = await readBotSettings(botSettingsCollection);
      const optInChannelId = botSettings.channels.OptInChannelID || config.OptInChannelID;
      if (!optInChannelId) {
        throw new TeamGenerationError('The Opt-In channel is not configured in bot settings or config.json.');
      }

      let round;
      try {
        round = await findNextRound(roundsDatabase);
      } catch (error) {
        if (error.message === 'All 16 round collections already contain approved data.') {
          throw new TeamGenerationError(error.message, 409);
        }
        throw error;
      }

      const message = await findLatestRoundOptInMessage({
        client: discordClient,
        channelId: optInChannelId,
        guildId: discordGuildId,
        roundNumber: round
      });
      if (!message) {
        throw new TeamGenerationError(
          `Could not find a bot-posted Opt-In message titled "Round ${round}!" in the configured channel.`,
          404
        );
      }

      return generateTeamDraftFromMessage({
        message,
        client: discordClient,
        botSettings,
        config,
        collections: {
          members,
          avoids,
          previousPairings: hoedownDatabase.collection('PreviousPairings'),
          ...roundCollections
        },
        roundsDatabase,
        targetRound: round
      });
    };
    const syncRoundDraftPreview = async (draft) => {
      if (!discordClient || !discordClient.isReady() || !roundCollections?.teamCheck) {
        throw new Error('The Discord bot is not ready to update the Team Check preview.');
      }
      const settings = await readBotSettings(botSettingsCollection);
      const channelId = draft.previewChannelId ||
        settings.channels.TeamCheckChannelID ||
        config.TeamCheckChannelID ||
        process.env.TEAM_CHECK_CHANNEL_ID;
      if (!channelId) throw new Error('The Team Check channel is not configured.');
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Team Check channel is not a text channel: ${channelId}`);
      }

      const messageIds = Array.isArray(draft.previewMessageIds) ? [...draft.previewMessageIds] : [];
      const contents = splitDiscordMessage(formatTeamCheckPreview(draft));
      for (let index = 0; index < contents.length; index += 1) {
        let message = null;
        if (messageIds[index]) {
          try {
            message = await channel.messages.fetch(messageIds[index]);
          } catch (error) {
            if (error.code !== 10008) throw error;
          }
        }
        if (message) {
          await message.edit(contents[index]);
        } else {
          const posted = await channel.send(contents[index]);
          messageIds[index] = posted.id;
        }
        const saved = await roundCollections.teamCheck.updateOne({
          _id: 'current',
          generationId: draft.generationId,
          status: 'pending'
        }, {
          $set: { previewMessageIds: messageIds, previewStatus: 'posting' }
        });
        if (!saved.matchedCount) {
          throw new Error('The Team Check draft changed while refreshing its Discord preview.');
        }
      }

      for (const extraMessageId of messageIds.slice(contents.length)) {
        try {
          const message = await channel.messages.fetch(extraMessageId);
          await message.delete();
        } catch (error) {
          if (error.code !== 10008) throw error;
        }
      }
      return { previewMessageIds: messageIds.slice(0, contents.length) };
    };
    const refreshTeamCheckPreview = async (draft) => {
      const generationId = draft.generationId;
      try {
        const currentDraft = await roundCollections.teamCheck.findOne({
          _id: 'current',
          generationId,
          status: 'pending'
        });
        if (!currentDraft) {
          throw new Error('The pending Team Check draft changed before its preview could be refreshed.');
        }
        if (currentDraft.previewStatus === 'disabled') return currentDraft;
        const synced = await syncRoundDraftPreview(currentDraft);
        const savedPreview = await roundCollections.teamCheck.updateOne({
          _id: 'current',
          generationId,
          status: 'pending'
        }, {
          $set: {
            previewMessageIds: synced.previewMessageIds,
            previewStatus: 'posted'
          },
          $unset: { previewError: '' }
        });
        if (!savedPreview.matchedCount) {
          throw new Error('The saved draft changed while the Discord preview was being updated.');
        }
        const updatedDraft = {
          ...currentDraft,
          previewMessageIds: synced.previewMessageIds,
          previewStatus: 'posted'
        };
        app.locals.broadcastRoundDraftUpdate(generationId);
        return updatedDraft;
      } catch (error) {
        const previewError = String(error.message || 'Unknown Discord preview error').slice(0, 1000);
        let failureMessage = `Discord Team Check preview refresh failed: ${previewError}`;
        try {
          const markedFailed = await roundCollections.teamCheck.updateOne({
            _id: 'current',
            generationId,
            status: 'pending'
          }, {
            $set: { previewStatus: 'failed', previewError, updatedAt: new Date() }
          });
          if (!markedFailed.matchedCount) {
            failureMessage += ' The draft also changed before its preview failure could be recorded.';
          }
        } catch (markError) {
          failureMessage += ` The preview failure could not be recorded: ${markError.message}`;
        }
        app.locals.broadcastRoundDraftUpdate(generationId);
        const syncError = new Error(failureMessage);
        syncError.statusCode = 502;
        throw syncError;
      }
    };
    await users.createIndex({ username: 1 }, { unique: true });
    await users.createIndex({ discordId: 1 }, { unique: true, sparse: true });
    await devices.createIndex({ userId: 1, deviceId: 1 }, { unique: true });
    await devices.createIndex({ userId: 1, lastSeenAt: -1 });
    await audit.createIndex({ at: 1 }, { expireAfterSeconds: AUDIT_RETENTION_SECONDS });
    await adminPasskeyCredentials.createIndex({ credentialId: 1 }, { unique: true });
    await adminPasskeyChallenges.createIndex({ challengeId: 1 }, { unique: true });
    await adminPasskeyChallenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await adminPasskeyTickets.createIndex({ ticketHash: 1 }, { unique: true });
    await adminPasskeyTickets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await adminHandoffCodes.createIndex({ codeHash: 1 }, { unique: true });
    await adminHandoffCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await adminSessions.createIndex({ tokenHash: 1 }, { unique: true });
    await adminSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await adminSessions.createIndex({ deviceId: 1, createdAt: -1 });
    if (!await adminPasskeyState.findOne({ _id: 'owner' })) {
      await adminPasskeyState.insertOne({ _id: 'owner', bootstrapped: false });
    }
    if (!await adminPasskeyCredentials.findOne({ owner: 'owner' })) {
      await adminPasskeyState.updateOne(
        { _id: 'owner', bootstrapped: true },
        { $set: { bootstrapped: false }, $unset: { credentialId: '' } }
      );
      if (!ADMIN_API_KEY) {
        throw new Error('Set ADMIN_API_KEY until the first owner passkey is enrolled.');
      }
    }
    const dummyPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const approveCurrentRound = discordClient && discordGuildId &&
      roundCollections?.teamCheck && roundsDatabase && hoedownDatabase
      ? async ({ generationId, actor }) => {
        if (!discordClient.isReady()) {
          const error = new Error('The Discord bot is not ready to approve a round.');
          error.statusCode = 503;
          throw error;
        }
        const guild = discordClient.guilds.cache.get(discordGuildId)
          || await discordClient.guilds.fetch(discordGuildId);
        const settings = await readBotSettings(botSettingsCollection);
        return approveLatestRound({
          teamCheckCollection: roundCollections.teamCheck,
          roundsDatabase,
          previousPairingsCollection: hoedownDatabase.collection('PreviousPairings'),
          botSettings: settings,
          discordClient,
          guild,
          generationId,
          actor
        });
      }
      : null;
    const app = createApp({
      users,
      devices,
      audit,
      members,
      avoids,
      ticketDatabase,
      botSettings: botSettingsCollection,
      backupDatabase,
      backupSources,
      adminDatabaseName,
      hoedownInfoDatabaseName: hoedownDatabaseName,
      adminPublicOrigin: ADMIN_PUBLIC_ORIGIN,
      adminPasskeyCredentials,
      adminPasskeyChallenges,
      adminPasskeyTickets,
      adminHandoffCodes,
      adminSessions,
      adminPasskeyState,
      saveAvoidRelationships: hoedownDatabase
        ? (users) => addAvoidRelationships(hoedownDatabase, users)
        : null,
      roundDraftCollection: roundCollections?.teamCheck,
      roundAvoidsCollection: avoids,
      previousPairingsCollection: hoedownDatabase
        ? hoedownDatabase.collection('PreviousPairings')
        : null,
      syncRoundDraftPreview,
      sendTicketReply,
      sendTicketStaffMessage,
      syncTicketStaffChat,
      editTicketReply,
      closeTicket,
      grabRoundReactions,
      canGrabRoundReactions,
      approveCurrentRound,
      jwtSecret: JWT_SECRET,
      adminApiKey: ADMIN_API_KEY,
      dummyPasswordHash,
      updateFeed: createUpdateFeed(),
      updateDiscordNickname: discordClient && discordGuildId
        ? async (discordId, nickname) => {
          if (!discordClient.isReady()) {
            throw new Error('The Discord bot is not ready to update nicknames.');
          }
          const guild = discordClient.guilds.cache.get(discordGuildId)
            || await discordClient.guilds.fetch(discordGuildId);
          const member = await guild.members.fetch(discordId);
          await member.setNickname(nickname || null, 'Updated through the Hoedown desktop app');
        }
        : null,
      getDiscordProfile: discordClient
        ? async (discordId) => {
          if (!discordClient.isReady()) throw new Error('The Discord bot is not ready to look up profiles.');
          const user = await discordClient.users.fetch(discordId);
          return {
            username: user.username,
            avatarUrl: user.displayAvatarURL({ extension: 'png', size: 64 })
          };
        }
        : null
    });
    unregisterTeamCheckPreviewSync = discordClient
      ? registerTeamCheckPreviewSync(discordClient, refreshTeamCheckPreview)
      : () => {};
    const unsubscribeRoundApprovalUpdates = subscribeRoundApprovalUpdates(
      app.locals.broadcastRoundDraftUpdate
    );
    return {
      app,
      closeMembersLiveUpdates: app.locals.closeMembersLiveUpdates,
      close: async () => {
        unregisterTeamCheckPreviewSync();
        unsubscribeRoundApprovalUpdates();
        await app.locals.closeMembersLiveUpdates();
        await client.close();
      }
    };
  } catch (error) {
    unregisterTeamCheckPreviewSync();
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
    await runtime.closeMembersLiveUpdates();
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
  normalizeMemberUpdates,
  normalizeUsername,
  readToken,
  validPassword
};
