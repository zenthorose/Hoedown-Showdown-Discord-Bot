require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, REST, Routes } = require('discord.js');
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
const { statusChannelId } = require('./config.json');

const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();
const { Hoedown_New_banner } = require('./config.json');

// Load commands from /commands/
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
    } else {
        console.error(`⚠️ Command file ${file} is missing a valid structure.`);
    }
}

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.get('/ping', (req, res) => {
    res.send('Pong!');
});

// Auto-register slash commands when the bot starts
client.once('ready', async () => {
    console.log(`✅ Bot is online and ready!`);

    const commands = [];
    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        commands.push(command.data.toJSON());
    }

    const rest = new REST({ version: '10' }).setToken(botToken);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registered successfully.');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        channel.send("🚀 Bot has successfully restarted and is ready!");
        console.log(`✅ Startup message sent to #${channel.name}`);
    } else {
        console.log("⚠️ Warning: Could not find the status channel. Check your config.json.");
    }
});

// Detect when Render stops the bot (for a GitHub push restart)
process.on('SIGTERM', async () => {
    console.log("🔄 Render is stopping the bot for redeployment...");

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        await channel.send("🔄 Bot is restarting (GitHub Deploy)...");
    }

    process.exit(0);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, reactionPostsManager);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Reaction handling
client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return;
    if (!reaction.message.guild) return;

    const post = reactionPostsManager.findPostByMessageId(reaction.message.id);
    if (post) {
        post.reactions.push(reaction.emoji.name);
        console.log(`Added reaction ${reaction.emoji.name} to post: ${reaction.message.id}`);
    }
    console.log(reactionPostsManager.getAllPosts());
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return;
    if (!reaction.message.guild) return;

    const post = reactionPostsManager.findPostByMessageId(reaction.message.id);
    if (post) {
        const index = post.reactions.indexOf(reaction.emoji.name);
        if (index > -1) post.reactions.splice(index, 1);
        console.log(`Removed reaction ${reaction.emoji.name} from post: ${reaction.message.id}`);
    }
    console.log(reactionPostsManager.getAllPosts());
});

// Basic ping command
client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    client.login(botToken);
});
