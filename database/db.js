// db.js
const mongoose = require('mongoose');

const uri = "mongodb+srv://Zenthorose:PeOOOiLsIBkhA4GJ@hoedowncluster.bhez5kk.mongodb.net/HoeDownCluster";

// Connect only once globally
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
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
