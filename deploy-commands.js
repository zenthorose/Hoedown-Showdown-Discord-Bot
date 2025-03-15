require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!clientId) {
    console.error("❌ CLIENT_ID is missing! Add it to your environment variables.");
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(botToken);

(async () => {
    try {
        console.log('❌ Removing old commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        console.log('🔄 Registering new slash commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('❌ Failed to refresh commands:', error);
    }
})();
