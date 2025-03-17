require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
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

const { Hoedown_New_banner, statusChannelId, SPREADSHEET_ID, SHEET_MEMBERS } = require('./config.json');
const credentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT
};

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
        const currentTime = moment().tz("America/New_York").format("hh:mm:ss A [EST]"); // ✅ Corrected time format
        channel.send(`✅ The Hoedown Showdown Bot is now online and ready to start blasting! 🚀\n🕒 Current Time: **${currentTime}**`);
        console.log(`✅ Startup message sent at ${currentTime}`);

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

            // 🔴 Step 1: Clear columns A & B before updating
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_MEMBERS}!A:B`, // Clears columns A & B
            });

            console.log("🧹 Cleared columns A & B before updating.");

            // 🟢 Step 2: Upload new member list
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_MEMBERS}!A1`, // Start at A1 after clearing
                valueInputOption: "RAW",
                resource: { values: [["Full Discord List User Name", "Discord ID's"], ...sortedMembers] }
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
