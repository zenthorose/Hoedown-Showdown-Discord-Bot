﻿require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

const client = new Client({
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

const prefix = '.';
client.commands = new Collection();
const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

const { Hoedown_New_banner, statusChannelId } = require('./config.json');

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE";
const credentials = require('./service-account.json'); // Your Google API Key JSON file

// Load commands from /commands/ folder
const commandFiles = fs.readdirSync('./commands/').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
    } else {
        console.error(`⚠️ Command file ${file} is missing a valid structure.`);
    }
}

// 🔄 Register slash commands on startup
const rest = new REST({ version: '10' }).setToken(botToken);
(async () => {
    try {
        console.log('🔄 Registering slash commands...');
        const commands = client.commands.map(command => command.data.toJSON());
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('✅ Successfully registered slash commands.');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();

client.once('ready', async () => {
    console.log(`✅ Bot is online and ready as ${client.user.tag}!`);
    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        channel.send("✅ The Hoedown Showdown Bot is now online and ready to start blasting! 🚀");
        console.log(`✅ Startup message sent to status channel: ${statusChannelId}`);

        // Auto-upload members to Google Sheets on startup
        try {
            await client.guilds.fetch();
            const guild = client.guilds.cache.first();
            if (!guild) return console.log("❌ No guilds found.");

            await guild.members.fetch();
            const sortedMembers = guild.members.cache
                .map(member => [member.user.username, member.user.id])
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));

            // Authenticate with Google Sheets API
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });

            const sheets = google.sheets({ version: "v4", auth });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: "A1",
                valueInputOption: "RAW",
                resource: { values: [["Username", "User ID"], ...sortedMembers] }
            });

            console.log("✅ Member list successfully uploaded to Google Sheets!");
            channel.send("📊 Member list has been updated in Google Sheets!");
        } catch (error) {
            console.error("❌ Error uploading member list:", error);
            channel.send("⚠️ Failed to upload member list to Google Sheets.");
        }
    } else {
        console.error("❌ Failed to find the status channel. Check config.json.");
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, reactionPostsManager);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ There was an error executing this command!', ephemeral: true });
    }
});

client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

// ✅ Start Express Server (Required for Render)
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.get('/ping', (req, res) => res.send('Pong!'));

app.listen(port, () => {
    console.log(`🌐 Server is running on port ${port}`);
    client.login(botToken);
});
