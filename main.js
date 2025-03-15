require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');

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
const fs = require('fs');
client.commands = new Collection();
const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

const { Hoedown_New_banner, statusChannelId } = require('./config.json');

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
