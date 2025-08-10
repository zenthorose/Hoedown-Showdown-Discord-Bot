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
        // Region-specific value choices
        .addStringOption(option =>
            option.setName('region_value')
                .setDescription('Choose your region (only used if info = Region).')
                .addChoices(
                    { name: 'East', value: 'East' },
                    { name: 'West', value: 'West' },
                    { name: 'Both', value: 'Both' }
                )
        )
        // Generic value for steamid or streamlink
        .addStringOption(option =>
            option.setName('value')
                .setDescription('Enter the new value for the selected info.')
        ),

    async execute(interaction) {
        const infoType = interaction.options.getString('info');
        let newValue;

        if (infoType === 'region') {
            newValue = interaction.options.getString('region_value');
            if (!newValue) {
                return await interaction.reply({ 
                    content: '❌ Please select a region option.', 
                    ephemeral: true 
                });
            }
        } else {
            newValue = interaction.options.getString('value');
            if (!newValue) {
                return await interaction.reply({ 
                    content: '❌ Please enter a value.', 
                    ephemeral: true 
                });
            }
        }

        const member = interaction.member;
        await interaction.reply({ content: `🔄 Updating your **${infoType}**...`, ephemeral: true });

        try {
            const triggerUrl = process.env.Google_Apps_Script_URL;
            if (!triggerUrl) {
                return await interaction.editReply('❌ Google Apps Script URL is not set.');
            }

            // Region role management
            if (infoType === 'region') {
                const allRegionRoles = ['East', 'West', 'Both'];
                for (const roleName of allRegionRoles) {
                    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                    if (role && member.roles.cache.has(role.id)) {
                        await member.roles.remove(role);
                    }
                }

                const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
                if (newRole) await member.roles.add(newRole);
            }

            // Validation for other types
            if (infoType === 'streamlink') {
                const twitchOrKickRegex = /^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\/[a-zA-Z0-9_]+$/;
                if (!twitchOrKickRegex.test(newValue)) {
                    return await interaction.editReply('❌ Invalid stream link. Please provide a valid Twitch or Kick link.');
                }
            }

            if (infoType === 'steamid') {
                if (!/^\d{17}$/.test(newValue)) {
                    return await interaction.editReply('❌ Invalid Steam ID. It must be a 17-digit number.');
                }
            }

            // Send update to Google Script
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
