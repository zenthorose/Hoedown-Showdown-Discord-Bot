const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-info')
        .setDescription('Update one piece of your registration info.')
        .addStringOption(option =>
            option.setName('info')
                .setDescription('Select what you want to update.')
                .setRequired(true)
                .addChoices(
                    { name: 'Region', value: 'region' },
                    { name: 'Steam ID', value: 'steamid' },
                    { name: 'Stream Link', value: 'streamlink' }
                ))
        .addStringOption(option =>
            option.setName('value')
                .setDescription('Enter the new value for the selected info.')
                .setRequired(true)
        ),

    async execute(interaction) {
        const infoType = interaction.options.getString('info');
        let newValue = interaction.options.getString('value');
        const member = interaction.member;

        // Initial user feedback
        await interaction.reply({ content: `🔄 Updating your **${infoType}**...`, ephemeral: true });

        try {
            // Check Google Apps Script URL
            const triggerUrl = process.env.Google_Apps_Script_URL;
            if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');
            if (!triggerUrl) {
                return await interaction.editReply('❌ Error: Google Apps Script URL is not set in environment variables.');
            }

            // Region normalization and validation
            if (infoType === 'region') {
                newValue = newValue.charAt(0).toUpperCase() + newValue.slice(1).toLowerCase();
                const validRegions = ['East', 'West', 'Both'];

                if (!validRegions.includes(newValue)) {
                    return await interaction.editReply('❌ Invalid region. Please choose East, West, or Both.');
                }

                // Remove any existing region roles
                const allRegionRoles = ['East', 'West', 'Both'];
                for (const roleName of allRegionRoles) {
                    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                    if (role && member.roles.cache.has(role.id)) {
                        await member.roles.remove(role);
                    }
                }

                // Assign the new region role
                const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
                if (newRole) await member.roles.add(newRole);
            }

            // Validate stream link
            if (infoType === 'streamlink') {
                const twitchOrKickRegex = /^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\/[a-zA-Z0-9_]+$/;
                if (!twitchOrKickRegex.test(newValue)) {
                    return await interaction.editReply('❌ Invalid stream link. Please provide a valid Twitch or Kick link.');
                }
            }

            // Validate Steam ID (17-digit number)
            if (infoType === 'steamid') {
                if (!/^\d{17}$/.test(newValue)) {
                    return await interaction.editReply('❌ Invalid Steam ID. It must be a 17-digit number.');
                }
            }

            // Send update payload to Google Apps Script
            const updateData = {
                command: 'update',
                updateData: [[
                    member.user.id,
                    infoType,
                    newValue
                ]]
            };

            await axios.post(triggerUrl, updateData);

            await interaction.editReply(`✅ Your **${infoType}** has been successfully updated!`);
        } catch (error) {
            console.error('❌ Error in /update-info:', error);
            await interaction.editReply('❌ Failed to update your info. Please try again later.');
        }
    },
};
