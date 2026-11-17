const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { generatePassword } = require('./password.cjs');

async function main() {
  const { MONGODB_URI, MONGODB_DB } = process.env;
  if (!MONGODB_URI || !MONGODB_DB) throw new Error('Set MONGODB_URI and MONGODB_DB.');
  const client = new MongoClient(MONGODB_URI);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const username = (process.argv[2] || await rl.question('Username: ')).trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error('Username is invalid.');
    await client.connect();
    const users = client.db(MONGODB_DB).collection('users');
    const password = generatePassword();
    await users.insertOne({
      username,
      passwordHash: await bcrypt.hash(password, 12),
      active: true,
      tokenVersion: 0,
      mustChangePassword: true,
      createdAt: new Date()
    });
    console.log(`Created ${username}. Temporary password (shown once): ${password}`);
  } finally {
    rl.close();
    await client.close();
  }
}

main().catch((error) => {
  console.error('Account creation failed:', error.message);
  process.exitCode = 1;
});
