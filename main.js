﻿﻿require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, REST, Routes } = require('discord.js');

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

const ReactionPostsManager = require('./reactionPosts');
const reactionPostsManager = new ReactionPostsManager();

const { Hoedown_New_banner } = require('./config.json');

const commandFiles = fs.readdirSync('./commands/').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
    } else {
        console.error(`Command file ${file} is missing a valid command structure.`);
    }
}

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.get('/ping', (req, res) => {
    res.send('Pong!');
});




client.once('ready', async () => {
    console.log(`✅ Bot is online and ready as ${client.user.tag}!`);

    const { statusChannelId } = require('./config.json'); // Load status channel ID
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
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});





client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return; // Ignore bot's own reactions
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
    if (user.bot) return; // Ignore bot's own reactions
    if (!reaction.message.guild) return;

    const post = reactionPostsManager.findPostByMessageId(reaction.message.id);
    if (post) {
        const index = post.reactions.indexOf(reaction.emoji.name);
        if (index > -1) post.reactions.splice(index, 1);
        console.log(`Removed reaction ${reaction.emoji.name} from post: ${reaction.message.id}`);
    }
    console.log(reactionPostsManager.getAllPosts());
});







client.on('messageCreate', async message => {


    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }

});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    client.login(botToken);
});