const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'notify.json');

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('❌ Failed to load notify data:', err);
    return {};
  }
}

function save(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Failed to save notify data:', err);
  }
}

function getSubscribers(channelId) {
  const data = load();
  return Array.isArray(data[channelId]) ? data[channelId] : [];
}

function addSubscriber(channelId, userId) {
  const data = load();
  data[channelId] = Array.isArray(data[channelId]) ? data[channelId] : [];
  if (!data[channelId].includes(userId)) data[channelId].push(userId);
  save(data);
}

function removeSubscriber(channelId, userId) {
  const data = load();
  if (!Array.isArray(data[channelId])) return;
  data[channelId] = data[channelId].filter(id => id !== userId);
  if (data[channelId].length === 0) delete data[channelId];
  save(data);
}

module.exports = {
  getSubscribers,
  addSubscriber,
  removeSubscriber,
};
