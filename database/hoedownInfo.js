const { MongoClient } = require('mongodb');
require('dotenv').config();

const databaseConfig = {
  avoidPairings: {
    env: 'MONGODB_HOEDOWNINFO',
    collections: { avoids: 'Avoids' }
  },
  rounds: {
    env: 'MONGODB_ROUNDS',
    collections: {
      playersThatReacted: 'PlayersThatReacted',
      teamCheck: 'TeamCheck',
      ...Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [`round${index + 1}`, `Round ${index + 1}`])
      )
    }
  },
  pastHoedownTeams: {
    env: 'MONGODB_HOEDOWNINFO',
    collections: { pastHoedownTeams: 'PastHoedownTeams' }
  },
  discordMemberList: {
    env: 'MONGODB_HOEDOWNINFO',
    collections: { members: 'Members' }
  },
  previousPairings: {
    env: 'MONGODB_HOEDOWNINFO',
    collections: { previousPairings: 'PreviousPairings' }
  }
};

let clientPromise;

async function connectMongoClient() {
  const { MONGO_URI } = process.env;
  if (!MONGO_URI) throw new Error('Set MONGO_URI before connecting to MongoDB.');
  if (!clientPromise) {
    const client = new MongoClient(MONGO_URI);
    clientPromise = client.connect()
      .then(() => client)
      .catch(async (error) => {
        clientPromise = undefined;
        await client.close();
        throw error;
      });
  }
  return clientPromise;
}

async function connectHoedownInfo() {
  const requiredNames = new Set(Object.values(databaseConfig).map(({ env }) => env));
  const missing = [...requiredNames].filter((name) => !process.env[name] || !process.env[name].trim());
  if (missing.length) throw new Error(`Set database names for: ${missing.join(', ')}.`);
  const client = await connectMongoClient();
  const collections = {};
  const databases = {};
  for (const [group, config] of Object.entries(databaseConfig)) {
    const database = client.db(process.env[config.env].trim());
    databases[group] = database;
    for (const [name, collectionName] of Object.entries(config.collections)) {
      collections[name] = database.collection(collectionName);
    }
  }
  return { client, collections, databases };
}

async function connectHoedownInfoDatabase() {
  const databaseName = process.env.MONGODB_HOEDOWNINFO;
  if (!databaseName || !databaseName.trim()) {
    throw new Error('Set MONGODB_HOEDOWNINFO to the Hoedown info database name.');
  }
  const client = await connectMongoClient();
  return client.db(databaseName.trim());
}

async function connectAdminDatabase() {
  const databaseName = process.env.MONGODB_ADMIN;
  if (!databaseName || !databaseName.trim()) {
    throw new Error('Set MONGODB_ADMIN to the admin database name.');
  }
  const client = await connectMongoClient();
  return client.db(databaseName.trim());
}

async function closeHoedownInfo() {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = undefined;
  await client.close();
}

module.exports = {
  closeHoedownInfo,
  connectAdminDatabase,
  connectHoedownInfo,
  connectHoedownInfoDatabase
};
