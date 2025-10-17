const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

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
      option.setName('steamfriendcode')
        .setDescription('Enter your Steam Friend Code (numbers only)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('streamlink')
        .setDescription(`Enter the full link for your stream or N/A if this doesn't apply to you`)
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const region = interaction.options.getString('region');
    const steamId = interaction.options.getString('steamfriendcode');
    const streamLink = interaction.options.getString('streamlink');
    const member = interaction.member;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/register** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // --- Validate Steam ID (digits only) ---
      if (!/^\d+$/.test(steamId)) {
        await interaction.editReply('❌ Invalid Steam ID. Must only contain numbers.');
        await logUsage("❌ Invalid Steam ID entered.");
        return;
      }

      // --- Validate Stream Link ---
      const validLinkRegex = /^(?:(?:https?:\/\/)?(?:www\.)?twitch\.tv\/[a-zA-Z0-9_\-/?=&#%.]+|https?:\/\/(?:www\.|m\.)?(kick\.com|youtube\.com|youtu\.be|tiktok\.com)\/[a-zA-Z0-9_\-/?=&#%.]+|N\/A)$/i;
      if (!validLinkRegex.test(streamLink)) {
        await interaction.editReply('❌ Invalid stream link. Must be Twitch, Kick, YouTube, or TikTok.');
        await logUsage("❌ Invalid stream link entered.");
        return;
      }


      // --- Check if already Registered ---
      const registeredRole = interaction.guild.roles.cache.find(r => r.name === 'Registered');
      if (registeredRole && member.roles.cache.has(registeredRole.id)) {
        await interaction.editReply(
          "⚠️ You are already registered.\n" +
          "➡️ Use `/update-info` to change any info you need to.\n" +
          "➡️ Use `/info-check` to see your current submitted info."
        );
        await logUsage("⚠️ Already registered, stopped.");
        return;
      }

      // --- Send registration data to Google Sheets ---
      const registerData = {
        command: 'register',
        registerData: [[
          member.user.username,  // Username
          member.user.id,        // Discord ID
          region,
          steamId,
          streamLink
        ]]
      };

      const response = await axios.post(process.env.Google_Apps_Script_URL, registerData);

      // --- Check GAS response ---
      if (!response.data || response.data.error) {
        const errorMsg = response.data?.error || "Unknown error from backend.";
        await interaction.editReply(`❌ Registration failed: ${errorMsg}`);
        await logUsage(`❌ Backend error: ${errorMsg}`);
        return;
      }

      // --- Assign roles ---
      const roleName = region === 'East' ? 'East' : region === 'West' ? 'West' : 'Both';
      const role = interaction.guild.roles.cache.find(r => r.name === roleName);

      if (role) {
        await member.roles.add(role).catch(err =>
          console.error(`❌ Failed to add region role (${roleName}):`, err)
        );
      }
      if (registeredRole) {
        await member.roles.add(registeredRole).catch(err =>
          console.error("❌ Failed to add Registered role:", err)
        );
      }

      await interaction.editReply('✅ You have been successfully registered!');
      await logUsage("✅ Registration successful.");
    } catch (error) {
      console.error('❌ Error with register command:', error);
      await interaction.editReply('❌ Registration failed. Please try again.');
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};
