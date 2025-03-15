require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const moment = require('moment-timezone');

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
const { statusChannelId } = require('./config.json');

// Load commands from /commands/ folder
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
    } else {
        console.error(`⚠️ Command file ${file} is missing a valid structure.`);
    }
}

// Function to get current EST time
function getCurrentESTTime() {
    return moment().tz("America/New_York").format("hh:mm A");
}

// Send a startup message when the bot is ready
client.once('ready', async () => {
    console.log(`✅ Bot is online and ready!`);

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        const currentTimeEST = getCurrentESTTime();
        channel.send(`🚀 Bot has successfully restarted at ${currentTimeEST} EST!`);
        console.log(`✅ Startup message sent at ${currentTimeEST} EST.`);
    } else {
        console.log("⚠️ Warning: Could not find the status channel. Check your config.json.");
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Basic ping command
client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

client.login(botToken);
