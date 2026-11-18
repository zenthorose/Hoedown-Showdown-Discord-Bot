// db.js
const mongoose = require('mongoose');
require('dotenv').config();
const uri = process.env.MONGO_URI;
const ticketsDatabase = process.env.MONGODB_TICKETS;

// Connect only once globally
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  if (!uri) throw new Error('Set MONGO_URI before connecting to MongoDB.');
  if (!ticketsDatabase) throw new Error('Set MONGODB_TICKETS to the ticket database name.');
  await mongoose.connect(uri, { dbName: ticketsDatabase });
  isConnected = true;
  console.log("✅ MongoDB connected (db.js)");
}

function getTicketModel(username) {
  const ticketSchema = new mongoose.Schema({
    ticketID: String,
    username: String,
    userID: String,
    createdAt: String,
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

  const collectionName = `${username}_Tickets`;
  return mongoose.models[collectionName] || mongoose.model(collectionName, ticketSchema, collectionName);
}

module.exports = { connectDB, getTicketModel };
