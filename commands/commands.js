const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');

// Load environment variables from Render.com
const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Optional, for testing in a specific guild

if (!TOKEN || !CLIENT_ID) {
    console.error('Missing environment variables. Ensure BOT_TOKEN and CLIENT_ID are set in Render.');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Define commands
const commands = [
    { name: '/info', description: 'Provides bot information' },
    { name: '/commands', description: 'Shows this list of commands' },
    { name: '/members', description: 'Gathers a list of all members of the discord before sending it to the google sheet. This command is ran automatically each time the bot is launched.' },
    { name: '/purgebot', description: 'Deletes all previous messages from the bot in whatever channel the command was entered in.' },
    { name: '/reactions', description: 'Sends the list of reactions from the selected message to the google sheet to begin the team creation.' },
    { name: '/reactionrole', description: 'Posts all of the timeslot posts for people to opt in or out of.' },
    { name: '/testreactions', description: 'Temp command will be removed and likely wont work currently.' },
    { name: '/ping', description: 'Checks bot latency' }
    
];

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'commands') {
        let commandList = commands.map(cmd => `**${cmd.name}** - ${cmd.description}`).join('\n');

        await interaction.reply({ content: `Here are my commands:\n\n${commandList}`, ephemeral: true });
    }
});

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Refreshing application (/) commands...');

        const commandData = [
            new SlashCommandBuilder().setName('commands').setDescription('Shows a list of available commands')
        ].map(cmd => cmd.toJSON());

        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandData });
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandData });
        }

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

client.login(TOKEN);
