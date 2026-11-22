const mongoose = require('mongoose');
const moment = require('moment-timezone');
require('dotenv').config();

const uri = process.env.MONGO_URI;
const ticketsDatabase = process.env.MONGODB_TICKETS;

// --- Connect once when the bot starts ---
if (!uri || !ticketsDatabase) {
  throw new Error('Set MONGO_URI and MONGODB_TICKETS before starting the ticket manager.');
}

mongoose.connect(uri, { dbName: ticketsDatabase }).then(() => console.log(`✅ MongoDB connected (TicketManager: ${ticketsDatabase})`))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- Helper Functions ---
function getESTTime() {
  return moment().tz('America/New_York').format('MM/DD/YYYY, hh:mm A z');
}

function formatMessageTime(date) {
  return date.toLocaleString('en-US', { timeZone: 'America/New_York' });
}

function getCollectionForUser(username) {
  const modelName = `${username}_Tickets`;

  // Prevent Mongoose model overwrite error on repeated calls
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName];
  }

  const ticketMessageSchema = new mongoose.Schema({
    sourceMessageID: String,
    mirrorMessageID: String,
    authorID: String,
    authorName: String,
    authorAvatarUrl: String,
    editedByID: String,
    editedByName: String,
    editedAt: String,
    content: String,
    timestamp: String,
  }, { _id: false });

  const schema = new mongoose.Schema({
    ticketID: String,
    ticketChannelID: String,
    username: String,
    userID: String,
    createdAt: String,
    closedAt: String,
    status: String,
    messages: [ticketMessageSchema],
    staffIDs: [String],
  });
  schema.index({ ticketChannelID: 1 }, { unique: true, sparse: true });

  return mongoose.model(modelName, schema, modelName);
}

async function updateTicket(Model, ticketChannelID, update, options = {}) {
  try {
    return await Model.updateOne({ ticketChannelID }, update, options);
  } catch (error) {
    if (error.code !== 11000 || !options.upsert) throw error;
    return Model.updateOne({ ticketChannelID }, update, { ...options, upsert: false });
  }
}

async function ensureTicketOpen(channel, user, staffID) {
  const TicketModel = getCollectionForUser(user.username);
  const createdAt = formatMessageTime(channel.createdAt || new Date());
  const update = {
    $setOnInsert: {
      ticketID: `${user.username} ${createdAt}`,
      ticketChannelID: channel.id,
      username: user.username,
      userID: user.id,
      createdAt,
      status: 'Open',
      messages: [],
    },
  };
  if (staffID) update.$addToSet = { staffIDs: staffID };
  else update.$setOnInsert.staffIDs = [];

  await updateTicket(TicketModel, channel.id, update, { upsert: true });
}

async function recordTicketMessage(channel, user, message) {
  if (!message.sourceMessageID || !message.mirrorMessageID || !message.authorID) {
    throw new TypeError('Ticket messages require source, mirror, and author IDs.');
  }

  await ensureTicketOpen(channel, user, message.staffID);
  const TicketModel = getCollectionForUser(user.username);
  const storedMessage = {
    sourceMessageID: message.sourceMessageID,
    mirrorMessageID: message.mirrorMessageID,
    authorID: message.authorID,
    authorName: message.authorName,
    authorAvatarUrl: message.authorAvatarUrl,
    editedByID: message.editedByID,
    editedByName: message.editedByName,
    editedAt: message.editedAt,
    content: message.content,
    timestamp: message.timestamp,
  };
  const update = { $addToSet: { messages: storedMessage } };
  if (message.staffID) update.$addToSet.staffIDs = message.staffID;

  await updateTicket(TicketModel, channel.id, update);
}

async function updateTicketMessage(channel, user, mirrorMessageID, content, staffID) {
  const TicketModel = getCollectionForUser(user.username);
  const update = { $set: { 'messages.$[message].content': content } };
  if (staffID) update.$addToSet = { staffIDs: staffID };

  const result = await TicketModel.updateOne(
    { ticketChannelID: channel.id, 'messages.mirrorMessageID': mirrorMessageID },
    update,
    { arrayFilters: [{ 'message.mirrorMessageID': mirrorMessageID }] }
  );
  if (result.matchedCount === 0) {
    throw new Error(`Ticket message ${mirrorMessageID} was not found for live update.`);
  }
}

function getEmbedAttribution(message, user) {
  const footer = message.embeds.map(embed => embed.footer?.text || '').join(' ');
  const authorIDMatch = footer.match(/(?:Author|Staff) ID:\s*(\d+)/);
  const appUsernameMatch = footer.match(/App Username:\s*([A-Za-z0-9._-]{1,64})/);
  const sourceMessageIDMatch = footer.match(/(?:DM|Sent DM) Message ID:\s*(\d+)/);
  const staffIDMatch = footer.match(/Staff ID:\s*(\d+)/);
  const editedByIDMatch = footer.match(/Edited by ID:\s*(\d+)/);
  const editedByNameMatch = footer.match(/Edited by:\s*([^|]+)/);
  const editedAtMatch = footer.match(/Edited at ISO:\s*([^|]+)/) ||
    footer.match(/Edited at:\s*([^|]+)/);
  const editedAtDate = typeof message.editedTimestamp === 'number'
    ? new Date(message.editedTimestamp)
    : message.editedAt instanceof Date ? message.editedAt : null;
  const editedAt = editedAtDate && !Number.isNaN(editedAtDate.getTime())
    ? editedAtDate.toISOString()
    : editedAtMatch?.[1]?.trim() || '';
  const isUserDM = /DM Message ID:\s*\d+/.test(footer);
  const embedAuthor = message.embeds.find(embed => embed.author?.name)?.author?.name;
  const authorAvatarUrl = message.embeds.find(embed => embed.author?.iconURL)?.author?.iconURL || '';

  return {
    authorID: authorIDMatch?.[1] ||
      (appUsernameMatch ? `app:${appUsernameMatch[1]}` : isUserDM ? user.id : message.author.id),
    authorName: embedAuthor || message.author.username,
    authorAvatarUrl,
    editedByID: editedByIDMatch?.[1] || '',
    editedByName: editedByNameMatch?.[1]?.trim() || '',
    editedAt,
    sourceMessageID: sourceMessageIDMatch?.[1] || message.id,
    staffID: staffIDMatch?.[1] || '',
  };
}

function formatTicketMessage(message, user) {
  const attribution = getEmbedAttribution(message, user);
  const parts = [];
  if (message.content?.trim()) parts.push(message.content.trim());

  if (message.embeds.length > 0) {
    const embedText = message.embeds
      .map(embed => {
        const embedParts = [];
        if (embed.title) embedParts.push(`**${embed.title}**`);
        if (embed.description) embedParts.push(embed.description);
        if (embed.fields?.length) {
          embedParts.push(embed.fields.map(field => `${field.name}: ${field.value}`).join('\n'));
        }
        if (embed.footer?.text) {
          const visibleFooter = embed.footer.text.replace(
            /\s*\|\s*(?:(?:Author|Staff|Edited by) ID:\s*\d+|App Username:\s*[A-Za-z0-9._-]{1,64}|Edited by:\s*[^|]+|Edited at(?: ISO)?:\s*[^|]+)/g,
            ''
          );
          if (visibleFooter) embedParts.push(`_Footer: ${visibleFooter}_`);
        }
        return embedParts.join('\n');
      })
      .join('\n\n');
    if (embedText.trim()) parts.push(embedText);
  }

  if (message.attachments.size > 0) {
    parts.push([...message.attachments.values()]
      .map(attachment => `[Attachment: ${attachment.url}]`)
      .join('\n'));
  }

  if (parts.length === 0) parts.push('[No content / embed / attachment]');

  return {
    ...attribution,
    mirrorMessageID: message.id,
    content: parts.join('\n\n'),
    timestamp: formatMessageTime(message.createdAt),
  };
}

async function closeTicketAndSave(channel, user, closedByID) {
  console.log(`📥 Collecting messages for ${channel.name}...`);

  let allMessages = [];
  let lastID = null;
  while (true) {
    const options = { limit: 100 };
    if (lastID) options.before = lastID;

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    allMessages = allMessages.concat(Array.from(fetched.values()));
    lastID = fetched.last().id;
  }

  console.log(`💬 Collected ${allMessages.length} messages.`);
  const formattedMessages = allMessages.reverse().map(message => formatTicketMessage(message, user));
  const staffIDs = [...new Set([
    ...formattedMessages.map(message => message.staffID).filter(Boolean),
    closedByID,
  ].filter(Boolean))];
  const createdAt = formattedMessages[0]?.timestamp || formatMessageTime(channel.createdAt || new Date());
  const closedAt = getESTTime();
  const TicketModel = getCollectionForUser(user.username);
  const update = {
    $set: {
      status: 'Closed',
      closedAt,
      messages: formattedMessages.map(({ sourceMessageID, mirrorMessageID, authorID, authorName, authorAvatarUrl, editedByID, editedByName, editedAt, content, timestamp }) => ({
        sourceMessageID,
        mirrorMessageID,
        authorID,
        authorName,
        authorAvatarUrl,
        editedByID,
        editedByName,
        editedAt,
        content,
        timestamp,
      })),
    },
    $setOnInsert: {
      ticketID: `${user.username} ${createdAt}`,
      ticketChannelID: channel.id,
      username: user.username,
      userID: user.id,
      createdAt,
    },
  };
  if (staffIDs.length) update.$addToSet = { staffIDs: { $each: staffIDs } };
  else update.$setOnInsert.staffIDs = [];

  await updateTicket(TicketModel, channel.id, update, { upsert: true });
  console.log(`🧾 Ticket for ${user.username} closed and saved to ${user.username}_Tickets`);
}

module.exports = {
  closeTicketAndSave,
  ensureTicketOpen,
  recordTicketMessage,
  updateTicketMessage
};
