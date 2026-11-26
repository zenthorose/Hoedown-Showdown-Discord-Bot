const { connectAdminDatabase } = require('./hoedownInfo');

const BOT_SETTINGS_COLLECTION = 'botSettings';
const BOT_SETTINGS_ID = 'global';
const DEFAULT_BOT_SETTINGS = {
  grabReactions: {
    ENABLE_TEAM_CHECK_POSTING: true
  },
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
  },
  channels: {
    STATUS_CHANNEL_ID: '',
    LOG_CHANNEL_ID: '',
    OptInChannelID: '',
    TeamCheckChannelID: '',
    roundChannels: {},
    teamChannels: {}
  }
};

function copyDefaultBotSettings() {
  return {
    grabReactions: { ...DEFAULT_BOT_SETTINGS.grabReactions },
    approveRound: { ...DEFAULT_BOT_SETTINGS.approveRound },
    hoedownReset: { ...DEFAULT_BOT_SETTINGS.hoedownReset },
    channels: {
      ...DEFAULT_BOT_SETTINGS.channels,
      roundChannels: {},
      teamChannels: {}
    }
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
    if (group === 'channels') {
      settings[group] = validateChannels(values);
      continue;
    }
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

function validateChannelId(value, label) {
  if (typeof value !== 'string' || (value !== '' && !/^\d{17,20}$/.test(value))) {
    throw new TypeError(`${label} must be a Discord channel ID or an empty string.`);
  }
  return value;
}

function validateChannelMap(input, label, keyPattern) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!keyPattern.test(key)) throw new TypeError(`${label} contains an invalid key: ${key}.`);
    result[key] = validateChannelId(value, `${label}.${key}`);
  }
  return result;
}

function validateChannels(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== Object.keys(DEFAULT_BOT_SETTINGS.channels).length ||
      Object.keys(input).some((field) => !Object.hasOwn(DEFAULT_BOT_SETTINGS.channels, field))) {
    throw new TypeError('Provide all bot channel settings.');
  }
  return {
    STATUS_CHANNEL_ID: validateChannelId(input.STATUS_CHANNEL_ID, 'STATUS_CHANNEL_ID'),
    LOG_CHANNEL_ID: validateChannelId(input.LOG_CHANNEL_ID, 'LOG_CHANNEL_ID'),
    OptInChannelID: validateChannelId(input.OptInChannelID, 'OptInChannelID'),
    TeamCheckChannelID: validateChannelId(input.TeamCheckChannelID, 'TeamCheckChannelID'),
    roundChannels: validateChannelMap(input.roundChannels, 'roundChannels', /^(?:[1-9]|1[0-6])$/),
    teamChannels: validateChannelMap(input.teamChannels, 'teamChannels', /^Team [A-Z]{1,3}$/)
  };
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
    if (group === 'channels') {
      for (const field of Object.keys(defaults)) {
        if (values[field] === undefined) continue;
        if (field === 'roundChannels' || field === 'teamChannels') {
          settings.channels[field] = {
            ...settings.channels[field],
            ...validateChannelMap(
              values[field],
              field,
              field === 'roundChannels' ? /^(?:[1-9]|1[0-6])$/ : /^Team [A-Z]{1,3}$/
            )
          };
        } else {
          settings.channels[field] = validateChannelId(values[field], field);
        }
      }
      continue;
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
  validateBotSettings,
  validateChannels
};
