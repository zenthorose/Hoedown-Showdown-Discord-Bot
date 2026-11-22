const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const recordsByCollection = new Map();
const modelsByName = new Map();
const originalConnect = mongoose.connect;
const originalModel = mongoose.model;
const originalMongoUri = process.env.MONGO_URI;
const originalTicketsDatabase = process.env.MONGODB_TICKETS;

process.env.MONGO_URI = 'mongodb://localhost/test';
process.env.MONGODB_TICKETS = 'TicketManagerTest';
mongoose.connect = () => Promise.resolve();
mongoose.model = (name, schema, collectionName) => {
  if (modelsByName.has(name)) return modelsByName.get(name);

  const records = recordsByCollection.get(collectionName) || [];
  recordsByCollection.set(collectionName, records);
  const model = {
    async updateOne(filter, update, options = {}) {
      let record = records.find(item => item.ticketChannelID === filter.ticketChannelID);
      if (!record && options.upsert) {
        record = { ticketChannelID: filter.ticketChannelID };
        records.push(record);
        Object.assign(record, structuredClone(update.$setOnInsert || {}));
      }
      if (!record) return { matchedCount: 0 };

      const requiredMirrorID = filter['messages.mirrorMessageID'];
      if (requiredMirrorID && !record.messages?.some(message => message.mirrorMessageID === requiredMirrorID)) {
        return { matchedCount: 0 };
      }

      for (const [key, value] of Object.entries(update.$set || {})) {
        if (key.startsWith('messages.$[message].')) {
          const field = key.slice('messages.$[message].'.length);
          const mirrorID = options.arrayFilters[0]['message.mirrorMessageID'];
          const message = record.messages.find(item => item.mirrorMessageID === mirrorID);
          message[field] = value;
        } else {
          record[key] = structuredClone(value);
        }
      }

      for (const [key, value] of Object.entries(update.$addToSet || {})) {
        if (!Array.isArray(record[key])) record[key] = [];
        const values = value && Array.isArray(value.$each) ? value.$each : [value];
        for (const item of values) {
          const exists = key === 'messages'
            ? record[key].some(message => message.sourceMessageID === item.sourceMessageID)
            : record[key].includes(item);
          if (!exists) record[key].push(structuredClone(item));
        }
      }

      return { matchedCount: 1 };
    }
  };
  modelsByName.set(name, model);
  return model;
};

const {
  closeTicketAndSave,
  recordTicketMessage,
  updateTicketMessage
} = require('./ticketManager');

test.after(() => {
  mongoose.connect = originalConnect;
  mongoose.model = originalModel;
  if (originalMongoUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalMongoUri;
  if (originalTicketsDatabase === undefined) delete process.env.MONGODB_TICKETS;
  else process.env.MONGODB_TICKETS = originalTicketsDatabase;
});

function makeCollection(messages) {
  const collection = new Map(messages.map(message => [message.id, message]));
  collection.last = () => [...collection.values()].at(-1);
  return collection;
}

test('live ticket messages create an open record, avoid duplicates, and track staff edits', async () => {
  const channel = {
    id: 'ticket-channel-live',
    name: 'player',
    createdAt: new Date('2026-11-22T18:00:00.000Z')
  };
  const user = { id: '123456789012345678', username: 'player' };
  const message = {
    sourceMessageID: 'dm-message-1',
    mirrorMessageID: 'mirror-message-1',
    authorID: user.id,
    authorName: 'player',
    content: 'I need help.',
    timestamp: '11/22/2026, 01:00 PM'
  };

  await recordTicketMessage(channel, user, message);
  await recordTicketMessage(channel, user, message);
  let ticket = recordsByCollection.get('player_Tickets')
    .find(record => record.ticketChannelID === channel.id);

  assert.equal(ticket.status, 'Open');
  assert.equal(ticket.userID, user.id);
  assert.equal(ticket.messages.length, 1);

  await updateTicketMessage(channel, user, message.mirrorMessageID, 'Updated reply.', '987654321098765432');
  ticket = recordsByCollection.get('player_Tickets')
    .find(record => record.ticketChannelID === channel.id);
  assert.equal(ticket.messages[0].content, 'Updated reply.');
  assert.deepEqual(ticket.staffIDs, ['987654321098765432']);
});

test('closing reconciles live messages with their human authors and closes the record', async () => {
  const channel = {
    id: 'ticket-channel-close',
    name: 'player',
    createdAt: new Date('2026-11-22T18:00:00.000Z'),
    messages: {
      fetch: async () => {
        if (channel.fetchCount++) return makeCollection([]);
        return makeCollection([legacyAppMessage, appMessage, staffMessage, userMessage]);
      }
    },
    fetchCount: 0
  };
  const user = { id: '123456789012345678', username: 'player' };
  const userMessage = {
    id: 'mirror-user-1',
    author: { id: 'bot-id', username: 'bot' },
    content: '',
    embeds: [{
      author: { name: 'player#0001', iconURL: 'https://cdn.discordapp.com/avatars/123456789012345678/player.png' },
      description: 'I need help.',
      footer: { text: `DM Message ID: user-dm-1 | Author ID: ${user.id}` }
    }],
    attachments: new Map(),
    createdAt: new Date('2026-11-22T18:01:00.000Z')
  };
  const staffMessage = {
    id: 'mirror-staff-1',
    author: { id: 'bot-id', username: 'bot' },
    content: '',
    embeds: [{
      author: { name: 'helper#0001', iconURL: 'https://cdn.discordapp.com/avatars/987654321098765432/helper.png' },
      description: 'We can help.',
      footer: { text: 'Sent DM Message ID: staff-dm-1 | Staff ID: 987654321098765432' }
    }],
    attachments: new Map(),
    createdAt: new Date('2026-11-22T18:02:00.000Z')
  };
  const appMessage = {
    id: 'mirror-app-1',
    author: { id: 'bot-id', username: 'bot' },
    content: '',
    embeds: [{
      author: { name: 'cowboy', iconURL: 'https://cdn.discordapp.com/avatars/345678901234567890/cowboy.png' },
      description: 'I can help with that.',
      footer: { text: 'Sent DM Message ID: app-dm-1 | Staff ID: 345678901234567890 | App Username: cowboy' }
    }],
    attachments: new Map(),
    createdAt: new Date('2026-11-22T18:03:00.000Z')
  };
  const legacyAppMessage = {
    id: 'mirror-legacy-app-1',
    author: { id: 'bot-id', username: 'bot' },
    content: '',
    embeds: [{
      author: { name: 'legacy-account' },
      description: 'An older app reply.',
      footer: { text: 'Sent DM Message ID: legacy-dm-1 | App Username: legacy-account' }
    }],
    attachments: new Map(),
    createdAt: new Date('2026-11-22T18:04:00.000Z')
  };

  await closeTicketAndSave(channel, user, '876543210987654321');
  const ticket = recordsByCollection.get('player_Tickets')
    .find(record => record.ticketChannelID === channel.id);

  assert.equal(ticket.status, 'Closed');
  assert.deepEqual(ticket.messages.map(message => message.authorID), [
    user.id,
    '987654321098765432',
    '345678901234567890',
    'app:legacy-account'
  ]);
  assert.equal(ticket.messages[2].authorName, 'cowboy');
  assert.equal(ticket.messages[0].authorAvatarUrl, 'https://cdn.discordapp.com/avatars/123456789012345678/player.png');
  assert.equal(ticket.messages[2].authorAvatarUrl, 'https://cdn.discordapp.com/avatars/345678901234567890/cowboy.png');
  assert.deepEqual(ticket.staffIDs.sort(), [
    '345678901234567890',
    '876543210987654321',
    '987654321098765432'
  ]);
  assert.equal(ticket.messages[1].content.includes('Staff ID:'), false);
});
