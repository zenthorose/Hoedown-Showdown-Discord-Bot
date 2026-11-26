const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { upsertMemberProfile } = require('../database/memberListImport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register yourself with region, Steam ID, stream link, and gender.')
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
        .setRequired(true))
    .addStringOption(option =>
      option.setName('gender')
        .setDescription('Enter your gender (free text)')
        .setRequired(true)
        .setMaxLength(100)),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    const region = interaction.options.getString('region');
    const gender = interaction.options.getString('gender');
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

      const results = [];
      let registrationSaved = false;
      try {
        const database = await connectHoedownInfoDatabase();
        await upsertMemberProfile(database, {
          discordId: member.user.id,
          username: member.user.username,
          nickname: member.displayName || member.user.username,
          region,
          steamId,
          streamLink,
          gender
        });
        registrationSaved = true;
        results.push('✅ MongoDB (HoedownInfo.Members): registration saved.');
      } catch (error) {
        console.error('❌ MongoDB registration failed:', error);
        results.push(`❌ MongoDB (HoedownInfo.Members): ${error.message}`);
      }

      // --- Assign roles ---
      if (registrationSaved) {
        const roleName = region === 'East' ? 'East' : region === 'West' ? 'West' : 'Both';
        const role = interaction.guild.roles.cache.find(r => r.name === roleName);

        if (role) {
          try {
            await member.roles.add(role);
          } catch (error) {
            console.error(`❌ Failed to add region role (${roleName}):`, error);
            results.push(`⚠️ MongoDB registration was saved, but the ${roleName} Discord role could not be assigned: ${error.message}`);
          }
        }
        if (registeredRole) {
          try {
            await member.roles.add(registeredRole);
          } catch (error) {
            console.error("❌ Failed to add Registered role:", error);
            results.push(`⚠️ MongoDB registration was saved, but the Registered Discord role could not be assigned: ${error.message}`);
          }
        }
      }

      const failures = results.filter(result => result.startsWith('❌') || result.startsWith('⚠️'));
      if (failures.length) {
        const outcome = [
          registrationSaved ? '⚠️ Registration partially completed.' : '❌ Registration failed.',
          ...results,
          ...(!registrationSaved ? ['⚠️ Discord registration roles were not assigned because the MongoDB profile was not saved.'] : [])
        ].join('\n');
        await interaction.editReply(outcome);
        await logUsage(`⚠️ Partial failure | ${failures.join(' | ')}`);
        return;
      }

      await interaction.editReply(`✅ You have been successfully registered!\n${results.join('\n')}`);
      await logUsage("✅ Registration successful.");
    } catch (error) {
      console.error('❌ Error with register command:', error);
      await interaction.editReply('❌ Registration failed. Please try again.');
      await logUsage(`❌ Error: ${error.message}`);
    }
  },
};