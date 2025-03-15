require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');

const botToken = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!clientId) {
    console.error("❌ CLIENT_ID is missing! Add it to your environment variables.");
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(botToken);

(async () => {
    try {
        console.log('🔄 Registering new slash commands...');

        const commands = [];
        const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const command = require(`./commands/${file}`);
            commands.push(command.data.toJSON());
        }

        await rest.put(Routes.applicationCommands(clientId), { body: commands });

        console.log('✅ Successfully registered slash commands.');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }
})();
