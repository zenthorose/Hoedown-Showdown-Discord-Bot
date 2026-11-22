const {
  BOT_SETTINGS_ID,
  DEFAULT_BOT_SETTINGS,
  validateChannels
} = require('./botSettings');

function getConfiguredBotChannels(config, env = process.env) {
  return validateChannels({
    STATUS_CHANNEL_ID: String(config.STATUS_CHANNEL_ID || ''),
    LOG_CHANNEL_ID: String(config.LOG_CHANNEL_ID || ''),
    OptInChannelID: String(config.OptInChannelID || ''),
    TeamCheckChannelID: String(config.TeamCheckChannelID || env.TEAM_CHECK_CHANNEL_ID || ''),
    roundChannels: Object.fromEntries(
      Object.entries(config.roundChannels || {}).map(([round, channelId]) => [String(round), String(channelId)])
    ),
    teamChannels: Object.fromEntries(
      Object.entries(config.teamChannels || {}).map(([team, channelId]) => [team, String(channelId)])
    )
  });
}

function listConfiguredChannels(channels) {
  const entries = [
    ...Object.entries(channels)
      .filter(([key]) => key !== 'roundChannels' && key !== 'teamChannels')
      .map(([key, value]) => [`channels.${key}`, value]),
    ...Object.entries(channels.roundChannels).map(([key, value]) => [`channels.roundChannels.${key}`, value]),
    ...Object.entries(channels.teamChannels).map(([key, value]) => [`channels.teamChannels.${key}`, value])
  ];
  return entries.filter(([, value]) => value);
}

async function importMissingBotChannels(collection, channels) {
  await collection.updateOne(
    { _id: BOT_SETTINGS_ID },
    { $setOnInsert: { settings: DEFAULT_BOT_SETTINGS } },
    { upsert: true }
  );

  const imported = [];
  const preserved = [];
  for (const [path, value] of listConfiguredChannels(channels)) {
    const result = await collection.updateOne({
      _id: BOT_SETTINGS_ID,
      $or: [
        { [`settings.${path}`]: { $exists: false } },
        { [`settings.${path}`]: '' }
      ]
    }, {
      $set: { [`settings.${path}`]: value }
    });
    (result.modifiedCount ? imported : preserved).push(path);
  }
  return { imported, preserved };
}

module.exports = {
  getConfiguredBotChannels,
  importMissingBotChannels,
  listConfiguredChannels
};
