const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');
const { checkPermissions } = require('../permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register yourself with region, Steam ID, and stream link.')
        .addStringOption(option =>
            option.setName('region')
                .setDescription('Select your region')
                .setRequired(true)
                .addChoices(
                    { name: 'East', value: 'East' },
                    { name: 'West', value: 'West' },
                    { name: 'Both', value: 'Both' }
                ))
        .addStringOption(option =>
            option.setName('steamid')
                .setDescription('Enter your Steam ID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('streamlink')
                .setDescription('Enter your Twitch/stream link')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const region = interaction.options.getString('region');
        const steamId = interaction.options.getString('steamid');
        const streamLink = interaction.options.getString('streamlink');
        const member = interaction.member;

        try {
            const roleName = region === 'East' ? 'East' : region === 'West' ? 'West' : 'Both';
            const role = interaction.guild.roles.cache.find(r => r.name === roleName);
            const registeredRole = interaction.guild.roles.cache.find(r => r.name === 'Registered');

            if (role) await member.roles.add(role);
            if (registeredRole) await member.roles.add(registeredRole);

            const registerData = {
                command: 'register',
                registerData: [[
                    member.nickname || member.user.username,
                    member.user.username,
                    member.user.id,
                    region,
                    steamId,
                    streamLink
                ]]
            };
            
            await axios.post(process.env.Google_Apps_Script_URL, registerData);            

            await interaction.editReply('✅ You have been successfully registered!');
        } catch (error) {
            console.error('❌ Error with register command:', error);
            await interaction.editReply('❌ Registration failed. Please try again.');
        }
    },
};