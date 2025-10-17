const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

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
        .setName('steamfriendcode')
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
        .setDescription('Update your full stream link')
        .addStringOption(option =>
          option.setName('link')
            .setDescription(`Enter the full link for your stream or N/A if this doesn't apply to you`)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const member = interaction.member;
    const triggerUrl = process.env.Google_Apps_Script_URL;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/update-info** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    if (!triggerUrl) {
      await interaction.reply({
        content: '❌ Error: Google Apps Script URL is not set in environment variables.',
        ephemeral: true
      });
      await logUsage("❌ Failed - Missing Google Apps Script URL.");
      return;
    }

    // --- Require Registered role ---
    const registeredRole = interaction.guild.roles.cache.find(r => r.name === 'Registered');
    if (!registeredRole || !member.roles.cache.has(registeredRole.id)) {
      await interaction.reply({
        content: "❌ You must be registered to use this command. Use `/register` first.",
        ephemeral: true
      });
      await logUsage("❌ Permission denied - not registered.");
      return;
    }

    try {
      await interaction.reply({ content: '⏳ Processing your update…', ephemeral: true });
    } catch {}

    let infoType, newValue;

    if (subcommand === 'region') {
      infoType = 'region';
      newValue = interaction.options.getString('region');

      // Remove old region roles
      const allRegionRoles = ['East', 'West', 'Both'];
      for (const roleName of allRegionRoles) {
        const role = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
        }
      }

      // Assign new region role
      const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
      if (newRole) {
        await member.roles.add(newRole);
      }
    }

    if (subcommand === 'steamfriendcode') {
      infoType = 'steamfriendcode';
      newValue = interaction.options.getString('friendcode');

      // Only digits allowed, no length restriction
      if (!/^\d+$/.test(newValue)) {
        await interaction.editReply({ content: '❌ Invalid Steam ID. Must only contain numbers.' });
        await logUsage("❌ Failed - Invalid Steam ID.");
        return;
      }
    }

    if (subcommand === 'streamlink') {
      infoType = 'streamlink';
      newValue = interaction.options.getString('link');

      const validLinkRegex = /^(?:(?:https?:\/\/)?(?:www\.)?twitch\.tv\/[a-zA-Z0-9_\-/?=&#%.]+|https?:\/\/(?:www\.|m\.)?(kick\.com|youtube\.com|youtu\.be|tiktok\.com)\/[a-zA-Z0-9_\-/?=&#%.]+|N\/A)$/i;
      if (!validLinkRegex.test(newValue)) {
        await interaction.editReply({ content: '❌ Invalid link. Must be Twitch, Kick, YouTube, or TikTok.' });
        await logUsage("❌ Failed - Invalid stream link.");
        return;
      }
    }

    try {
      const updateData = {
        command: 'update',
        updateData: [[member.user.id, infoType, newValue]]
      };

      await axios.post(triggerUrl, updateData);

      try {
        await interaction.editReply({ content: `✅ Your **${infoType}** has been updated to **${newValue} **!` });
        await logUsage(`✅ Successfully updated **${infoType}** → **${newValue} **.`);
      } catch {}
    } catch (error) {
      console.error("❌ Error updating info:", error);
      try {
        await interaction.editReply({ content: '❌ Failed to update your info.' });
      } catch {}
      await logUsage(`❌ Error: ${error.message}`);
    }
  }
};
