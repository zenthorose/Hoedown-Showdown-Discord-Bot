const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-info')
        .setDescription('Update one piece of your registration info.')
        
        // REGION SUBCOMMAND
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

        // STEAM ID SUBCOMMAND
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

        // STREAM LINK SUBCOMMAND
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
        // Immediately defer the reply to avoid "Unknown interaction" issues
        await interaction.deferReply({ flags: 64 }); // ephemeral

        const subcommand = interaction.options.getSubcommand();
        const member = interaction.member;
        const triggerUrl = process.env.Google_Apps_Script_URL;

        if (!triggerUrl) {
            return interaction.editReply({ content: '❌ Error: Google Apps Script URL is not set.' });
        }

        let infoType, newValue;

        try {
            // --- REGION ---
            if (subcommand === 'region') {
                infoType = 'region';
                newValue = interaction.options.getString('region');

                const validRegions = ['East', 'West', 'Both'];
                if (!validRegions.includes(newValue)) {
                    return interaction.editReply({ content: '❌ Invalid region selected.' });
                }

                // Remove old region roles
                const allRegionRoles = ['East', 'West', 'Both'];
                for (const roleName of allRegionRoles) {
                    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                    if (role && member.roles.cache.has(role.id)) {
                        await member.roles.remove(role).catch(console.error);
                    }
                }

                // Add the new role
                const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
                if (newRole) await member.roles.add(newRole).catch(console.error);
            }

            // --- STEAM ID ---
            else if (subcommand === 'steamid') {
                infoType = 'steamid';
                newValue = interaction.options.getString('friendcode');

                if (!/^\d{17}$/.test(newValue)) {
                    return interaction.editReply({ content: '❌ Invalid Steam ID. Must be 17 digits.' });
                }
            }

            // --- STREAM LINK ---
            else if (subcommand === 'streamlink') {
                infoType = 'streamlink';
                newValue = interaction.options.getString('link');

                const twitchOrKickRegex = /^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\/[a-zA-Z0-9_]+$/;
                if (!twitchOrKickRegex.test(newValue)) {
                    return interaction.editReply({ content: '❌ Invalid link. Must be Twitch or Kick.' });
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

            // Confirm to user
            return interaction.editReply({
                content: `✅ Your **${infoType}** has been updated to **${newValue}**!`
            });

        } catch (error) {
            console.error('❌ Error in /update-info:', error);
            return interaction.editReply({ content: '❌ Failed to update your info.' });
        }
    }
};
