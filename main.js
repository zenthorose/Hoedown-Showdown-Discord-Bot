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
    } else {
        console.error("❌ Failed to find the status channel. Check config.json.");
    }
});

// ✅ Add back the ping command to keep the bot awake
client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'muffin') {
        try {
            await interaction.update({
                content: 'You clicked the muffin button! Here is your muffin! <:muffin:1355005309604593714>',
                components: []
            });

        } catch (error) {
            console.error(error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Something went wrong!',
                    ephemeral: true
                });
            }
        }
    }
});



// Watch for the word "muffin" in a specific channel
client.on('messageCreate', async message => {
    if (message.author.bot) return; // Ignore bot messages

    // Define the target channel ID and word to watch for
    const targetChannelId = '1355001958825463968'; // Replace with your actual channel ID
    const targetWord = 'muffin';

    // Check if the message is from the target channel and contains the target word
    if (message.channel.id === targetChannelId && message.content.toLowerCase().includes(targetWord)) {
        try {
            // Replace 'muffinEmoji' with your custom emoji's name
            const customEmoji = message.guild.emojis.cache.find(emoji => emoji.name === 'Muffin'); // Replace 'muffinEmoji' with your emoji's name
            if (customEmoji) {
                // React with the custom emoji
                await message.react(customEmoji);
            } else {
                console.error('Custom emoji not found!');
            }
        } catch (error) {
            console.error('Error reacting to message:', error);
        }
    }
});

// Handle command interactions (existing functionality)
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

// ✅ Start Express Server (Required for Render)
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Existing ping endpoint
app.get('/ping', (req, res) => res.send('Pong!'));

// New endpoint to send a message to Discord
app.post('/sendmessage', async (req, res) => {
    const { channelId, message } = req.body;

    if (!channelId || !message) {
        return res.status(400).json({ error: 'Missing required fields: channelId and message' });
    }

    try {
        // Get the channel object
        const channel = await client.channels.fetch(channelId);
        
        // Send the message to the channel
        await channel.send(message);
        
        res.status(200).json({ success: `Message sent to channel ${channelId}` });
    } catch (error) {
        console.error('Error sending message to Discord:', error);
        res.status(500).json({ error: 'Failed to send message to Discord' });
    }
});

app.listen(port, () => {
    console.log(`🌐 Server is running on port ${port}`);
    client.login(botToken);
});
