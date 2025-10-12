require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const fs = require('fs');
const axios = require('axios');
const express = require('express');

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

const { Hoedown_New_banner, STATUS_CHANNEL_ID, SPREADSHEET_ID, SHEET_MEMBERS } = require('./config.json');
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

    try {
        const response = await axios.get(process.env.Google_Apps_Script_URL);
        console.log("Google Script response:", response.data);
    } catch (error) {
        console.error("Error connecting to Google Script:", error.message);
    }

    const channel = client.channels.cache.get(STATUS_CHANNEL_ID);
    if (channel) {
        const currentTime = moment().tz("America/New_York").format("hh:mm:ss A [EST]");
        channel.send(`✅ The Hoedown Showdown Bot is now online and ready to start blasting! 🚀\n🕒 Current Time: **${currentTime}**`);
        console.log(`✅ Startup message sent at ${currentTime}`);
    } else {
        console.error("❌ Failed to find the status channel. Check config.json.");
    }
});

// ✅ Auto trigger "member-update" command when someone joins (run as the BOT)
client.on('guildMemberAdd', async (member) => {
    console.log(`🎉 New member joined: ${member.user.tag} (${member.id})`);

    try {
        const commandName = 'member-update';
        const command = client.commands.get(commandName);

        if (!command) {
            console.error(`❌ Command "${commandName}" not found.`);
            return;
        }

        // Use the bot as the executor instead of the new user
        const botMember = member.guild.members.me;

        const fakeInteraction = {
            user: client.user,
            member: botMember,
            guild: member.guild,
            client,
            commandName,
            options: {
                getString: () => null,
                getUser: () => null,
                getRole: () => null,
                getChannel: () => null
            },
            reply: async (data) => {
                const logChannel = member.guild.channels.cache.get(STATUS_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(data?.content || `✅ Ran "${commandName}" for ${member.user.tag}`);
                }
                console.log(`[auto-command] Replied for ${member.user.tag}`);
            },
            deferReply: async () => {},
            editReply: async () => {},
        };

        // Execute the command as if the bot called it
        await command.execute(fakeInteraction, reactionPostsManager);
        console.log(`✅ Auto-ran "${commandName}" for ${member.user.tag}`);

    } catch (error) {
        console.error(`❌ Failed to auto-run member-update for ${member.user.tag}:`, error);
    }
});

// ✅ Catch DM's to the bot to make a support ticket
const modmailHandler = require('./events/swampmail.js');
client.on('messageCreate', (message) => modmailHandler(client, message));


// ✅ Keep bot awake with ping
client.on('messageCreate', async message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

// ✅ Muffin Button Interaction
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'muffin') {
        try {
            await interaction.update({
                content: 'Howdy partner, here is your muffin! <:muffin:1355005309604593714>',
                embeds: [{
                    image: {
                        url: 'https://static.wikia.nocookie.net/teamfourstar/images/e/e5/ImagesCAJ3ZF22.jpg/revision/latest?cb=20120306001642'
                    }
                }],
                components: []
            });
        } catch (error) {
            console.error(error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Something went wrong!', ephemeral: true });
            }
        }
    }
});

// ✅ Muffin word watcher
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const targetChannelId = '1052393482699948132';
    const targetWord = 'muffin';

    if (message.channel.id === targetChannelId && message.content.toLowerCase().includes(targetWord)) {
        try {
            const customEmoji = message.guild.emojis.cache.find(emoji => emoji.name === 'Muffin');
            if (customEmoji) {
                await message.react(customEmoji);
            } else {
                console.error('Custom emoji not found!');
            }
        } catch (error) {
            console.error('Error reacting to message:', error);
        }
    }
});

// ✅ Handle slash command interactions
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

// ✅ Express server (Render keep-alive)
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.get('/ping', (req, res) => res.send('Pong!'));

app.post('/sendmessage', async (req, res) => {
    const { channelId, message } = req.body;
    if (!channelId || !message) return res.status(400).json({ error: 'Missing required fields: channelId and message' });

    try {
        const channel = await client.channels.fetch(channelId);
        await channel.send(message);
        res.status(200).json({ success: `Message sent to channel ${channelId}` });
    } catch (error) {
        console.error('Error sending message to Discord:', error);
        res.status(500).json({ error: 'Failed to send message to Discord' });
    }
});

app.listen(port, () => {
    console.log(`🌐 Server running on port ${port}`);
    client.login(botToken);
});
