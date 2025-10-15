const monk = require('monk');

// Use environment variable or default local MongoDB connection
const db = monk(process.env.MONGO_URI || 'mongodb://localhost:27017/supportbot');

// "tickets" collection
const tickets = db.get('tickets');

// Optional: add indexes for performance
tickets.createIndex({ userId: 1 });
tickets.createIndex({ ticketId: 1 }, { unique: true });

module.exports = { db, tickets };