require('dotenv').config();
const config = require('../config.json');
const { connectAdminDatabase } = require('../database/hoedownInfo');
const {
  getConfiguredBotChannels,
  importMissingBotChannels,
  listConfiguredChannels
} = require('../database/botChannelImport');
const { BOT_SETTINGS_COLLECTION, BOT_SETTINGS_ID } = require('../database/botSettings');

async function main() {
  const apply = process.argv.includes('--apply');
  const channels = getConfiguredBotChannels(config);
  const configured = listConfiguredChannels(channels);
  if (configured.length === 0) throw new Error('No channel IDs were found in config.json or TEAM_CHECK_CHANNEL_ID.');

  console.log(`Validated ${configured.length} channel ID(s):`);
  for (const [path, channelId] of configured) console.log(`  ${path}: ${channelId}`);

  const database = await connectAdminDatabase();
  const collection = database.collection(BOT_SETTINGS_COLLECTION);
  const existing = await collection.findOne({ _id: BOT_SETTINGS_ID });
  if (!apply) {
    const storedChannels = existing?.settings?.channels || {};
    for (const [path, channelId] of configured) {
      const current = path.slice('channels.'.length).split('.').reduce((value, key) => value?.[key], storedChannels);
      console.log(`  ${current ? 'KEEP' : 'IMPORT'} ${path}${current ? `: ${current}` : `: ${channelId}`}`);
    }
    console.log('\nDry run only. Existing MongoDB channel values will be kept; missing values will be imported.');
    console.log('Run with --apply to write the listed channel IDs.');
    return;
  }

  const result = await importMissingBotChannels(collection, channels);
  if (result.imported.length > 0) {
    await collection.updateOne({ _id: BOT_SETTINGS_ID }, {
      $set: { updatedAt: new Date(), updatedBy: 'config-import' }
    });
  }
  console.log(`\nImported ${result.imported.length} channel setting(s); preserved ${result.preserved.length} existing value(s).`);
  if (!existing) console.log('Created the global settings document with built-in toggle defaults.');
}

main().catch((error) => {
  console.error('Bot channel import failed:', error);
  process.exitCode = 1;
});
