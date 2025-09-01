const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-info')
        .setDescription('Update one piece of your registration info.')
        
        // --- REGION SUBCOMMAND ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('region')
                .setDescription('Update your region')
                .addStringOption(option =>
                    option.setName('region')
                        .setDescription('Select your region')
                        .setRequired(true)
                        .addChoices(
                            { name: 'East', value: 'East' },
                            { name: 'West', value: 'West' },
                            { name: 'Both', value: 'Both' }
                        )
                )
        )

        // --- STEAM ID SUBCOMMAND ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('steamid')
                .setDescription('Update your Steam Friend Code')
                .addStringOption(option =>
                    option.setName('friendcode')
                        .setDescription('Enter your 17-digit Steam Friend Code')
                        .setRequired(true)
                )
        )

        // --- STREAM LINK SUBCOMMAND ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('streamlink')
                .setDescription('Update your Twitch or Kick stream link')
                .addStringOption(option =>
                    option.setName('link')
                        .setDescription('Enter your Twitch or Kick link')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        console.log('[DEBUG] Command execution started');
        const subcommand = interaction.options.getSubcommand();
        const member = interaction.member;
        const triggerUrl = process.env.Google_Apps_Script_URL;

        if (!triggerUrl) {
            console.error('[DEBUG] Google Apps Script URL not set');
            return interaction.reply({ content: '❌ Error: Google Apps Script URL is not set.', flags: 64 });
        }

        let infoType, newValue;

        try {
            console.log('[DEBUG] Attempting deferReply');
            await interaction.deferReply({ flags: 64 }); // ephemeral
            console.log('[DEBUG] deferReply successful');
        } catch (err) {
            console.error('[DEBUG] deferReply failed:', err);
        }

        // --- Determine subcommand type ---
        if (subcommand === 'region') {
            infoType = 'region';
            newValue = interaction.options.getString('region');

            const validRegions = ['East', 'West', 'Both'];
            if (!validRegions.includes(newValue)) {
                console.log('[DEBUG] Invalid region selected:', newValue);
                return interaction.editReply({ content: '❌ Invalid region.' });
            }

            console.log('[DEBUG] Updating roles for region');

            const allRegionRoles = ['East', 'West', 'Both'];
            for (const roleName of allRegionRoles) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role && member.roles.cache.has(role.id)) {
                    try {
                        await member.roles.remove(role);
                        console.log(`[DEBUG] Removed role: ${roleName}`);
                    } catch (err) {
                        console.error(`[DEBUG] Failed to remove role ${roleName}:`, err);
                    }
                }
            }

            const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
            if (newRole) {
                try {
                    await member.roles.add(newRole);
                    console.log(`[DEBUG] Added new role: ${newValue}`);
                } catch (err) {
                    console.error(`[DEBUG] Failed to add role ${newValue}:`, err);
                }
            }
        }

        if (subcommand === 'steamid') {
            infoType = 'steamid';
            newValue = interaction.options.getString('friendcode');

            if (!/^\d{17}$/.test(newValue)) {
                console.log('[DEBUG] Invalid Steam ID:', newValue);
                return interaction.editReply({ content: '❌ Invalid Steam ID. Must be 17 digits.' });
            }
        }

        if (subcommand === 'streamlink') {
            infoType = 'streamlink';
            newValue = interaction.options.getString('link');

            const twitchOrKickRegex = /^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\/[a-zA-Z0-9_]+$/;
            if (!twitchOrKickRegex.test(newValue)) {
                console.log('[DEBUG] Invalid stream link:', newValue);
                return interaction.editReply({ content: '❌ Invalid link. Must be Twitch or Kick.' });
            }
        }

        console.log('[DEBUG] Sending update to Google Script:', { infoType, newValue });

        try {
            const updateData = {
                command: 'update',
                updateData: [[
                    member.user.id,
                    infoType,
                    newValue
                ]]
            };

            await axios.post(triggerUrl, updateData);
            console.log('[DEBUG] Google Script update successful');

            await interaction.editReply({ content: `✅ Your **${infoType}** has been updated to **${newValue}**!` });
            console.log('[DEBUG] editReply successful');

        } catch (error) {
            console.error('[DEBUG] Error updating info or editing reply:', error);
            try {
                await interaction.editReply({ content: '❌ Failed to update your info.' });
            } catch (err) {
                console.error('[DEBUG] editReply failed:', err);
            }
        }

        console.log('[DEBUG] Command execution finished');
    }
};
