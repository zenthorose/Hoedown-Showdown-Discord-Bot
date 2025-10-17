const mongoose = require('mongoose');
const moment = require('moment-timezone');
require('dotenv').config();

const uri = process.env.MONGO_URI;

// --- Connect once when the bot starts ---
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB connected (TicketManager)'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// --- Helper Functions ---
function getESTTime() {
  return moment().tz('America/New_York').format('MM/DD/YYYY, hh:mm A z');
}

function getCollectionForUser(username) {
  const modelName = `${username}_Tickets`;

  // Prevent Mongoose model overwrite error on repeated calls
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName];
  }

  const schema = new mongoose.Schema({
    ticketID: String,
    username: String,
    userID: String,
    createdAt: String,
    closedAt: String,
    status: String,
    messages: [
      {
        authorID: String,
        authorName: String,
        content: String,
        timestamp: String,
      },
    ],
    staffIDs: [String],
  });

  return mongoose.model(modelName, schema, modelName);
}

// --- Close Ticket and Save to MongoDB ---
async function closeTicketAndSave(channel, user) {
  try {
    console.log(`📥 Collecting messages for ${channel.name}...`);

    // Fetch all messages in batches (100 per request)
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

    // --- Format messages (with embeds & attachments) ---
    const formattedMessages = allMessages.reverse().map(m => {
      let parts = [];

      // Message text
      if (m.content?.trim()) parts.push(m.content.trim());

      // Handle embeds (even if message has text)
      if (m.embeds.length > 0) {
        const embedText = m.embeds
          .map(embed => {
            const embedParts = [];
            if (embed.title) embedParts.push(`**${embed.title}**`);
            if (embed.description) embedParts.push(embed.description);
            if (embed.fields?.length) {
              embedParts.push(embed.fields.map(f => `${f.name}: ${f.value}`).join('\n'));
            }
            if (embed.footer?.text) embedParts.push(`_Footer: ${embed.footer.text}_`);
            return embedParts.join('\n');
          })
          .join('\n\n');
        if (embedText.trim().length > 0) parts.push(embedText);
      }

      // Handle attachments
      if (m.attachments.size > 0) {
        const attachText = [...m.attachments.values()]
          .map(a => `[Attachment: ${a.url}]`)
          .join('\n');
        parts.push(attachText);
      }

      // Fallback
      if (parts.length === 0) parts.push("[No content / embed / attachment]");

      return {
        authorID: m.author.id,
        authorName: m.author.username,
        content: parts.join('\n\n'),
        timestamp: m.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      };
    });

    // --- Identify staff members ---
    const staffRoleIDs = ['YOUR_STAFF_ROLE_ID_HERE']; // TODO: Replace with your real role IDs
    const staffIDs = [...new Set(
      allMessages
        .filter(m => m.member && m.member.roles.cache.some(r => staffRoleIDs.includes(r.id)))
        .map(m => m.author.id)
    )];

    // --- Build ticket data ---
    const createdAt = formattedMessages[0]?.timestamp || getESTTime();
    const closedAt = getESTTime();
    const ticketID = `${user.username} ${createdAt}`;
    const TicketModel = getCollectionForUser(user.username);

    const ticketData = new TicketModel({
      ticketID,
      username: user.username,
      userID: user.id,
      createdAt,
      closedAt,
      status: 'Closed',
      messages: formattedMessages,
      staffIDs,
    });

    // --- Save to MongoDB ---
    await ticketData.save();
    console.log(`🧾 Ticket "${ticketID}" saved to ${user.username}_Tickets`);

  } catch (err) {
    console.error("❌ Error saving ticket:", err);
  }
}

module.exports = {
  closeTicketAndSave
};
