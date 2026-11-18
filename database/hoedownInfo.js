const { MongoClient } = require('mongodb');
require('dotenv').config();

const collectionNames = [
  'DiscordMemberList',
  'PastHoedownTeams',
  'PreviousPairings',
  'AvoidPairing',
  'PlayersThatReacted'
];

let connectionPromise;

async function connectHoedownInfo() {
  const { MONGO_URI, MONGODB_HOEDOWNINFO } = process.env;
  if (!MONGO_URI || !MONGODB_HOEDOWNINFO) {
    throw new Error('Set MONGO_URI and MONGODB_HOEDOWNINFO before using HoedownInfo collections.');
  }
  if (!connectionPromise) {
    const client = new MongoClient(MONGO_URI);
    connectionPromise = client.connect()
      .then(() => ({
        client,
        collections: Object.fromEntries(
          collectionNames.map((name) => [name, client.db(MONGODB_HOEDOWNINFO).collection(name)])
        )
      }))
      .catch(async (error) => {
        connectionPromise = undefined;
        await client.close();
        throw error;
      });
  }
  return (await connectionPromise).collections;
}

async function closeHoedownInfo() {
  if (!connectionPromise) return;
  const connection = await connectionPromise;
  connectionPromise = undefined;
  await connection.client.close();
}

module.exports = { connectHoedownInfo, closeHoedownInfo };
