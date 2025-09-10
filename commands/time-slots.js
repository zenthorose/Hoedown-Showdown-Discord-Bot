const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('time-slots')
    .setDescription('Send an announcement followed by multiple time slot sign-up messages!')
    .setDefaultMemberPermissions(0), // Requires Manage Messages permission

  async execute(interaction, reactionPostsManager) {
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const userId = interaction.user.id;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/time-slots** used by **${userTag}** (${userId}) in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      // --- Role / user permission check ---
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const allowedRoles = Array.isArray(config.allowedRoles) ? config.allowedRoles : [];
      const hasRequiredRole = member && member.roles.cache.some(role => allowedRoles.includes(role.id));
      const isAllowedUser = Array.isArray(config.allowedUserIds)
        ? config.allowedUserIds.includes(interaction.user.id)
        : false;

      if (!hasRequiredRole && !isAllowedUser) {
        await interaction.reply({
          content: "❌ You don't have the required role or ID to use this command.",
          ephemeral: true
        });
        await logUsage("❌ Permission denied.");
        return;
      }

      // --- Fetch the OptIn channel from config ---
      const targetChannel = await interaction.client.channels.fetch(config.OptInChannelID);
      if (!targetChannel) {
        console.error("❌ Could not find OptInChannelID in this server");
        await interaction.reply({ content: "❌ Could not find the Opt-In channel.", ephemeral: true });
        await logUsage("❌ Failed - Opt-In channel not found.");
        return;
      }

      // --- Validate timeSlots / emojis length ---
      if (config.timeSlots.length !== config.emojis.length) {
        console.warn("⚠️ Warning: The number of emojis does not match the number of time slots.");
        await logUsage("⚠️ Mismatch between timeSlots and emojis.");
      }

      // --- Send a public processing message so it can be deleted later ---
      const responseMessage = await interaction.reply({
        content: "Posting time slot sign-up messages...",
        fetchReply: true
      });

      // --- Post introductory embed ---
      const introEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle("Hoedown Showdown <t:1761440940:D> Time Slot Sign-Ups")
        .setDescription("React to the messages below to sign up for a time slot. Make sure to remove your reaction if you are no longer available.")
        .setTimestamp();

      await targetChannel.send({ embeds: [introEmbed] });

      // --- Post each time slot ---
      let roundNumber = 1;
      for (let i = 0; i < config.timeSlots.length; i++) {
        const timeSlot = config.timeSlots[i];
        const emoji = config.emojis[i];

        const exampleEmbed = new EmbedBuilder()
          .setColor('#444444')
          .setTitle(`Round ${roundNumber}!`)
          .setDescription(`React to the emoji below to join the ${timeSlot} time slot!`)
          .setTimestamp();

        const message = await targetChannel.send({ embeds: [exampleEmbed] });
        if (reactionPostsManager && typeof reactionPostsManager.addPost === 'function') {
          reactionPostsManager.addPost({
            channelId: message.channel.id,
            messageId: message.id,
            embedId: exampleEmbed.id,
            reactions: []
          });
        }

        console.log(`Posted time slot for: ${timeSlot} in ${targetChannel.name} with emoji ${emoji}`);
        await message.react(emoji);
        await new Promise(resolve => setTimeout(resolve, 1000));

        roundNumber++;
      }

      // --- Delete processing message after all posts ---
      if (responseMessage) {
        setTimeout(async () => {
          try {
            await responseMessage.delete();
          } catch (err) {
            console.error(err);
          }
        }, 5000);
      }

      await logUsage("✅ Successfully posted all time slots.");
    } catch (error) {
      console.error("❌ Error executing time-slots command:", error);
      try {
        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
      } catch (_) {}
      await logUsage(`❌ Error: ${error.message}`);
    }
  }
};
