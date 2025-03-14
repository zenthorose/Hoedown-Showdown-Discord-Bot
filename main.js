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

const { MaleEmoji, MaleRole, FemaleEmoji, FemaleRole, MaleName, FemaleName } = require('./config.json');

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
    let totalFemaleReactions = 0;
    post.reactions.forEach(reaction => {
        if (reaction === MaleEmoji) {
            totalMaleReactions++;
        }
        if (reaction === FemaleEmoji) {
            totalFemaleReactions++;
        }
    });
    return { totalMaleReactions, totalFemaleReactions };
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
        if (reaction.emoji.name === MaleEmoji) {
            await reaction.message.guild.members.cache.get(user.id).roles.add(MaleRole);
            post.reactions.push(MaleEmoji);
            console.log(`Added MaleEmoji reaction to post: ${reaction.message.id}`);
        }
        if (reaction.emoji.name === FemaleEmoji) {
            await reaction.message.guild.members.cache.get(user.id).roles.add(FemaleRole);
            post.reactions.push(FemaleEmoji);
            console.log(`Added FemaleEmoji reaction to post: ${reaction.message.id}`);
        }
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
        if (reaction.emoji.name === MaleEmoji) {
            await reaction.message.guild.members.cache.get(user.id).roles.remove(MaleRole);
            const index = post.reactions.indexOf(MaleEmoji);
            if (index > -1) post.reactions.splice(index, 1);
            console.log(`Removed MaleEmoji reaction from post: ${reaction.message.id}`);
        }
        if (reaction.emoji.name === FemaleEmoji) {
            await reaction.message.guild.members.cache.get(user.id).roles.remove(FemaleRole);
            const index = post.reactions.indexOf(FemaleEmoji);
            if (index > -1) post.reactions.splice(index, 1);
            console.log(`Removed FemaleEmoji reaction from post: ${reaction.message.id}`);
        }
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
                const { totalMaleReactions, totalFemaleReactions } = calculateTotalReactions(post);
                message.channel.send(`Post in channel ${post.channelId} with message ID ${post.messageId} has ${totalMaleReactions} male reactions and ${totalFemaleReactions} female reactions.`);
            } else {
                message.channel.send(`No post found with message ID ${postId}.`);
            }
        } else {
            message.channel.send(`Total reactions for each post:`);
            // reactionPosts.forEach(post => {
                reactionPostsManager.getAllPosts().forEach(post => {
                const { totalMaleReactions, totalFemaleReactions } = calculateTotalReactions(post);
                message.channel.send(`Post in channel ${post.channelId} with message ID ${post.messageId} has ${totalMaleReactions} male reactions and ${totalFemaleReactions} female reactions.`);
            });
        }
    }






    if (message.content.startsWith('!reactions')) {
        const splitMessage = message.content.split(' ');
        if (splitMessage.length > 1) {
            const messageId = splitMessage[1];
            try {
                const targetMessage = await message.channel.messages.fetch(messageId);
                const reactions = targetMessage.reactions.cache;

                if (reactions.size > 0) {
                    const embed = new EmbedBuilder()
                        .setColor('#444444')
                        .setTitle(`Reactions for message ID ${messageId}`)
                        .setTimestamp();

                    for (const reaction of reactions.values()) {
                        const users = await reaction.users.fetch();
                        const userList = users
                            .filter(user => user.id !== client.user.id) // Ignore bot's own reactions
                            .map(user => user.username)
                            .join(', ');
                        embed.addFields({ name: `Emoji: ${reaction.emoji.name}`, value: userList || 'No users' });
                    }

                    message.channel.send({ embeds: [embed] });
                } else {
                    message.channel.send(`No reactions found for message ID ${messageId}.`);
                }
            } catch (error) {
                console.error(error);
                message.channel.send(`Failed to fetch reactions for message ID ${messageId}.`);
            }
        } else {
            message.channel.send(`Usage: !reactions <messageId>`);
        }
    }






    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }






    if (message.content === '!reactionrole') {
        const exampleEmbed = new EmbedBuilder()
            .setColor('#444444')
            .setTitle('React to the emoji if you are able to make it to this time slot.')
            .setDescription(`Once you have reacted you will be added to the list for the round! If you are unable to make this round please remove your reaction.\n\n${MaleEmoji} for ${MaleName}\n${FemaleEmoji} for ${FemaleName}\n`)
            .setTimestamp();

        message.channel.send({ embeds: [exampleEmbed] }).then(async msg => {
            reactionPostsManager.addPost({ channelId: msg.channel.id, messageId: msg.id, embedId: exampleEmbed.id, reactions: [] });
            console.log(`Added new reaction post: ${msg.id}`);
            console.log(reactionPostsManager.getAllPosts());

            // Add a slight delay before adding the bot's reactions
            await new Promise(resolve => setTimeout(resolve, 500));
            await msg.react(MaleEmoji);
            await msg.react(FemaleEmoji);
            console.log(`Bot reacted to message: ${msg.id}`);
        });
    }
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    client.login(botToken);
});

