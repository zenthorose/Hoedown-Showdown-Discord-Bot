require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const { exec } = require('child_process');

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

// Run deploy-commands.js only if commands are missing
console.log("🔍 Checking if commands need to be registered...");
exec("node deploy-commands.js", (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Error running deploy-commands.js: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`⚠️ deploy-commands.js stderr: ${stderr}`);
        return;
    }
    console.log(`✅ deploy-commands.js output: ${stdout}`);
});

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

// Send a startup message when the bot is ready
client.once('ready', async () => {
    console.log(`✅ Bot is online and ready!`);

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        channel.send(`🚀 Bot has successfully restarted and commands are updated!`);
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
