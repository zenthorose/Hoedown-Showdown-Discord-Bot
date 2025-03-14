require('dotenv').config();
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

const { MaleEmoji, MaleRole, MaleName } = require('./config.json');

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

const calculateTotalReactions = (post) => {
    let totalMaleReactions = 0;
    post.reactions.forEach(reaction => {
        if (reaction === MaleEmoji) {
            totalMaleReactions++;
        }
    });
    return { totalMaleReactions };
};



client.once('ready', async () => {
    console.log(`Bot is online!`);

    const commands = client.commands.map(command => command.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(botToken);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error(error);
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


    
    if (message.content.startsWith('!total')) {
        const splitMessage = message.content.split(' ');
        if (splitMessage.length > 1) {
            const postId = splitMessage[1];
            // const post = reactionPosts.find(post => post.messageId === postId);
            const post = reactionPostsManager.findPostByMessageId(postId);
            if (post) {
                const { totalMaleReactions } = calculateTotalReactions(post);
                message.channel.send(`Post in channel ${post.channelId} with message ID ${post.messageId} has ${totalMaleReactions} male reactions.`);
            } else {
                message.channel.send(`No post found with message ID ${postId}.`);
            }
        } else {
            message.channel.send(`Total reactions for each post:`);
            // reactionPosts.forEach(post => {
                reactionPostsManager.getAllPosts().forEach(post => {
                const { totalMaleReactions } = calculateTotalReactions(post);
                message.channel.send(`Post in channel ${post.channelId} with message ID ${post.messageId} has ${totalMaleReactions} male reactions.`);
            });
        }
    }


    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }

});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    client.login(botToken);
});

