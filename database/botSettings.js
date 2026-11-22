const { connectAdminDatabase } = require('./hoedownInfo');

const BOT_SETTINGS_COLLECTION = 'botSettings';
const BOT_SETTINGS_ID = 'global';
const DEFAULT_BOT_SETTINGS = {
  approveRound: {
    ENABLE_ROUND_CHANNEL_PERMS: true,
    ENABLE_TEAM_CLEANUP: true,
    ENABLE_VC_RESET: true,
    ENABLE_TEAM_POSTING_PERMS: true,
    ENABLE_DISCORD_POSTING: true
  },
  hoedownReset: {
    ENABLE_WIPE_OPTIN: true,
    ENABLE_SET_EVERYONE_VIEW_DENY: true,
    ENABLE_WIPE_ROUND_CHANNELS: true,
    ENABLE_SET_EVERYONE_VIEW_DENY_ROUNDS: true,
    ENABLE_WIPE_TEAM_CHANNELS: true,
    ENABLE_SET_EVERYONE_VIEW_DENY_TEAMS: true,
    ENABLE_REMOVE_MEMBER_OVERWRITES: true,
    ENABLE_LOGGING: false
  }
};

function copyDefaultBotSettings() {
  return {
    approveRound: { ...DEFAULT_BOT_SETTINGS.approveRound },
    hoedownReset: { ...DEFAULT_BOT_SETTINGS.hoedownReset }
  };
}

function validateBotSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== Object.keys(DEFAULT_BOT_SETTINGS).length ||
      Object.keys(input).some((group) => !Object.hasOwn(DEFAULT_BOT_SETTINGS, group))) {
    throw new TypeError('Provide all bot setting groups.');
  }

  const settings = {};
  for (const [group, defaults] of Object.entries(DEFAULT_BOT_SETTINGS)) {
    const values = input[group];
    const fields = Object.keys(defaults);
    if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.keys(values).length !== fields.length ||
        Object.keys(values).some((field) => !fields.includes(field))) {
      throw new TypeError(`Provide all settings for ${group}.`);
    }
    settings[group] = {};
    for (const field of fields) {
      if (typeof values[field] !== 'boolean') {
        throw new TypeError(`${field} must be true or false.`);
      }
      settings[group][field] = values[field];
    }
  }
  return settings;
}

function normalizeStoredBotSettings(input) {
  const settings = copyDefaultBotSettings();
  if (input === undefined || input === null) return settings;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Stored bot settings must be an object.');
  }

  for (const [group, defaults] of Object.entries(DEFAULT_BOT_SETTINGS)) {
    const values = input[group];
    if (values === undefined) continue;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError(`Stored ${group} settings must be an object.`);
    }
    for (const [field, value] of Object.entries(values)) {
      if (!Object.hasOwn(defaults, field)) continue;
      if (typeof value !== 'boolean') {
        throw new TypeError(`Stored ${field} setting must be true or false.`);
      }
      settings[group][field] = value;
    }
  }
  return settings;
}

async function readBotSettings(collection) {
  const document = await collection.findOne({ _id: BOT_SETTINGS_ID }, {
    projection: { _id: 0, settings: 1 }
  });
  return normalizeStoredBotSettings(document && document.settings);
}

async function getBotSettings() {
  const database = await connectAdminDatabase();
  return readBotSettings(database.collection(BOT_SETTINGS_COLLECTION));
}

module.exports = {
  BOT_SETTINGS_COLLECTION,
  BOT_SETTINGS_ID,
  DEFAULT_BOT_SETTINGS,
  getBotSettings,
  normalizeStoredBotSettings,
  readBotSettings,
  validateBotSettings
};
