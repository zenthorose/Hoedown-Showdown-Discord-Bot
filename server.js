const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');  // Require fs to read the config file

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Load configuration from the config.json file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// POST route to handle the team data
app.post('/send-teams', async (req, res) => {
  try {
    const { teams } = req.body;  // Expecting the teams data from the request body

    if (!teams || teams.length === 0) {
      return res.status(400).json({ message: 'No teams data received.' });
    }

    // Format the teams data (adjust formatting as needed)
    const teamMessage = teams.map((team, index) => {
      return `**Team ${index + 1}:**\n- ${team.join('\n- ')}`;
    }).join('\n\n');

    // Discord bot token from environment variable (Render.com will provide this)
    const discordToken = process.env.DISCORD_TOKEN; // Token from Render environment variables
    const channelId = config.TeamChannelPostingID; // Channel ID from config.json

    if (!discordToken) {
      return res.status(500).json({ message: 'Discord token not found in environment variables.' });
    }

    // Discord API URL for sending messages
    const discordApiUrl = `https://discord.com/api/v10/channels/${channelId}/messages`;

    // Prepare payload for Discord API
    const payload = {
      content: `Here are the teams:\n\n${teamMessage}`
    };

    // Set authorization headers using the bot token
    const headers = {
      Authorization: `Bot ${discordToken}`,
      'Content-Type': 'application/json'
    };

    // Send to Discord via the bot API (not webhook)
    await axios.post(discordApiUrl, payload, { headers });
    return res.status(200).json({ message: 'Teams sent to Discord successfully!' });

  } catch (error) {
    console.error('Error sending to Discord:', error);
    return res.status(500).json({ message: 'Error sending to Discord', error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
