const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { upsertMemberProfile } = require('../database/memberListImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-info')
    .setDescription('Update one piece of your registration info.')

    // --- GENDER SUBCOMMAND ---
    .addSubcommand(subcommand =>
      subcommand
        .setName('gender')
        .setDescription('Update your gender')
        .addStringOption(option =>
          option.setName('gender')
            .setDescription('Enter your gender (free text)')
            .setRequired(true)
            .setMaxLength(100)
        )
    )

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

    // --- Require Registered role ---
    const registeredRole = interaction.guild.roles.cache.find(r => r.name === 'Registered');
    if (!registeredRole || !member.roles.cache.has(registeredRole.id)) {
      await interaction.reply({
        content: "❌ You must be registered to use this command. Use `/register` first.",
        flags: 64
      });
      await logUsage("❌ Permission denied - not registered.");
      return;
    }

    try {
      await interaction.reply({ content: '⏳ Processing your update…', flags: 64 });
    } catch {}

    let infoType, mongoField, newValue;

    if (subcommand === 'gender') {
      infoType = 'gender';
      mongoField = 'gender';
      newValue = interaction.options.getString('gender');
    }

    if (subcommand === 'region') {
      infoType = 'region';
      mongoField = 'region';
      newValue = interaction.options.getString('region');
    }

    if (subcommand === 'steamfriendcode') {
      infoType = 'steamid';
      mongoField = 'steamId';
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
      mongoField = 'streamLink';
      newValue = interaction.options.getString('link');

      const validLinkRegex = /^(?:(?:https?:\/\/)?(?:www\.)?twitch\.tv\/[a-zA-Z0-9_\-/?=&#%.]+|https?:\/\/(?:www\.|m\.)?(kick\.com|youtube\.com|youtu\.be|tiktok\.com)\/[a-zA-Z0-9_\-/?=&#%.]+|N\/A)$/i;
      if (!validLinkRegex.test(newValue)) {
        await interaction.editReply({ content: '❌ Invalid link. Must be Twitch, Kick, YouTube, or TikTok.' });
        await logUsage("❌ Failed - Invalid stream link.");
        return;
      }
    }

    const results = [];
    let profileSaved = false;
    try {
      const database = await connectHoedownInfoDatabase();
      await upsertMemberProfile(database, {
        discordId: member.user.id,
        username: member.user.username,
        nickname: member.displayName,
        [mongoField]: newValue
      });
      profileSaved = true;
      results.push(`✅ MongoDB (HoedownInfo.Members): updated ${mongoField}.`);
    } catch (error) {
      console.error('❌ MongoDB member update failed:', error);
      results.push(`❌ MongoDB (HoedownInfo.Members): ${error.message}`);
    }

    if (profileSaved && subcommand === 'region') {
      try {
        const allRegionRoles = ['East', 'West', 'Both'];
        for (const roleName of allRegionRoles) {
          const role = interaction.guild.roles.cache.find(r => r.name === roleName);
          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
          }
        }

        const newRole = interaction.guild.roles.cache.find(r => r.name === newValue);
        if (newRole) await member.roles.add(newRole);
      } catch (error) {
        console.error(`❌ Failed to update Discord region role (${newValue}):`, error);
        results.push(`⚠️ MongoDB was updated, but the Discord region role could not be updated: ${error.message}`);
      }
    }

    const failures = results.filter(result => result.startsWith('❌') || result.startsWith('⚠️'));
    const resultMessage = failures.length
      ? `⚠️ Your **${infoType}** update was only partially completed.\n${results.join('\n')}`
      : `✅ Your **${infoType}** has been updated to **${newValue}**!\n${results.join('\n')}`;
    await interaction.editReply({ content: resultMessage });
    await logUsage(
      failures.length
        ? `⚠️ Partial failure | ${failures.join(' | ')}`
        : `✅ Successfully updated **${infoType}** → **${newValue}**.`
    );
  }
};