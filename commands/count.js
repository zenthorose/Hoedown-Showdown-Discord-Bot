const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('Counts members by role combinations and absence.')
    .setDefaultMemberPermissions(0), // Requires Manage Messages or equivalent

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      if (replied) {
        return interaction.followUp({
          content,
          ephemeral: isEphemeral,
        });
      } else {
        replied = true;
        return interaction.reply({
          content,
          ephemeral: isEphemeral,
        });
      }
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `🧮 **/count** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (logError) {
        console.error("❌ Failed to send log message:", logError);
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);
      await logUsage("Attempting to count roles.");

      if (!hasPermission) {
        await logUsage("❌ Permission denied");
        return safeReply('❌ You do not have permission to run this command!', true);
      }

      const guild = interaction.guild;
      if (!guild) {
        await logUsage("❌ Not run in a guild");
        return safeReply('❌ This command can only be used in a server.', true);
      }

      await guild.members.fetch(); // ensure full member cache

      // Role IDs
      const roleA = '1183686835130601487';
      const roleB = '1111938775409496135';

      let onlyA = 0;
      let onlyB = 0;
      let both = 0;
      let neither = 0;

      guild.members.cache.forEach(member => {
        const hasA = member.roles.cache.has(roleA);
        const hasB = member.roles.cache.has(roleB);

        if (hasA && hasB) both++;
        else if (hasA && !hasB) onlyA++;
        else if (hasB && !hasA) onlyB++;
        else neither++;
      });

      const result = [
        `**Count Results:**`,
        `🟩 Have roleA only (<@&${roleA}>): **${onlyA}**`,
        `🟦 Have roleB only (<@&${roleB}>): **${onlyB}**`,
        `🟨 Have both roles: **${both}**`,
        `⬜ Have neither role: **${neither}**`,
      ].join('\n');

      await logUsage(`✅ Count completed. A:${onlyA}, B:${onlyB}, Both:${both}, Neither:${neither}`);
      return safeReply(result);

    } catch (error) {
      console.error("❌ Error executing /count:", error);
      await logUsage("❌ Unexpected error during count");
      try {
        if (replied || interaction.deferred) {
          await interaction.followUp({
            content: '❌ There was an error executing this command!',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: '❌ There was an error executing this command!',
            ephemeral: true,
          });
        }
      } catch (err) {
        console.error('❌ Failed to send error message:', err);
      }
    }
  }
};
