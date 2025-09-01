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
                        .setDescription('Enter your Steam Friend Code')
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
        const subcommand = interaction.options.getSubcommand();
        const member = interaction.member;
        const triggerUrl = process.env.Google_Apps_Script_URL;

        if (!triggerUrl) {
            return interaction.reply({ content: '❌ Error: Google Apps Script URL is not set in environment variables.', flags: 64 });
        }

        try {
            await interaction.reply({ content: '⏳ Processing your update…', flags: 64 });
        } catch {}

        let infoType, newValue;

        if (subcommand === 'region') {
            infoType = 'region';
            newValue = interaction.options.getString('region');

            const allRegionRoles = ['East', 'West', 'Both'];
            for (const roleName of allRegionRoles) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role);
                }
            }

            const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
            if (newRole) {
                await member.roles.add(newRole);
            }
        }

        if (subcommand === 'steamid') {
            infoType = 'steamid';
            newValue = interaction.options.getString('friendcode');

            // Only digits allowed, no length restriction
            if (!/^\d+$/.test(newValue)) {
                return interaction.editReply({ content: '❌ Invalid Steam ID. Must only contain numbers.' });
            }
        }

        if (subcommand === 'streamlink') {
            infoType = 'streamlink';
            newValue = interaction.options.getString('link');

            const twitchOrKickRegex = /^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\/[a-zA-Z0-9_]+$/;
            if (!twitchOrKickRegex.test(newValue)) {
                return interaction.editReply({ content: '❌ Invalid link. Must be Twitch or Kick.' });
            }
        }

        try {
            const updateData = {
                command: 'update',
                updateData: [[ member.user.id, infoType, newValue ]]
            };

            await axios.post(triggerUrl, updateData);

            try {
                await interaction.editReply({ content: `✅ Your **${infoType}** has been updated to **${newValue}**!` });
            } catch {}
        } catch {
            try {
                await interaction.editReply({ content: '❌ Failed to update your info.' });
            } catch {}
        }
    }
};
