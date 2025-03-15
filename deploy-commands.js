require('dotenv').config();
const { REST, Routes } = require('discord.js');

const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!clientId) {
    console.error("❌ CLIENT_ID is missing! Add it to your environment variables.");
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(botToken);

(async () => {
    try {
        console.log('❌ Removing ALL slash commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        console.log('✅ All commands have been removed from Discord.');
    } catch (error) {
        console.error('❌ Failed to remove commands:', error);
    }
})();
