const { tickets } = require('./db');
const moment = require('moment-timezone');

// Generate formatted timestamp (EST)
function getESTTime() {
  return moment().tz('America/New_York').format('MM/DD/YYYY, hh:mm A z');
}

// Create new ticket
async function createTicket(username, userId, ticketCount) {
  const ticketId = `${username}-${ticketCount}`;
  const newTicket = {
    ticketId,
    userId,
    createdAt: getESTTime(),
    status: "Opened",
    messages: [],
    staffIds: []
  };
  await tickets.insert(newTicket);
  return newTicket;
}

// Add a message
async function addMessage(ticketId, author, content) {
  const timestamp = getESTTime();
  await tickets.update(
    { ticketId },
    { $push: { messages: { author, content, timestamp } } }
  );
}

// Add staff member to the list
async function addStaff(ticketId, staffId) {
  await tickets.update(
    { ticketId },
    { $addToSet: { staffIds: staffId } } // prevents duplicates
  );
}

// Close a ticket
async function closeTicket(ticketId) {
  await tickets.update(
    { ticketId },
    { $set: { status: "Closed" } }
  );
}

// Fetch ticket
async function getTicket(ticketId) {
  return tickets.findOne({ ticketId });
}

// Fetch all tickets from a user
async function getUserTickets(userId) {
  return tickets.find({ userId });
}

module.exports = {
  createTicket,
  addMessage,
  addStaff,
  closeTicket,
  getTicket,
  getUserTickets
};
