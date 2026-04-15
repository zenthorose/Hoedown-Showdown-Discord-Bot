const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

// Per-feature send toggles for this command
const SENDS = {
  LOGS: true,
  REPLIES: false,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('Counts members by selected roles and logic type.')
    .setDefaultMemberPermissions(0)
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Choose how to count members')
        .setRequired(true)
        .addChoices(
          { name: 'Only', value: 'only' },
          { name: 'Both', value: 'both' },
          { name: 'Neither', value: 'neither' }
        )
    )
    .addRoleOption(option =>
      option
        .setName('role1')
        .setDescription('The main role to check')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role2')
        .setDescription('Optional secondary role for comparison')
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName('role3')
        .setDescription('Optional third role for comparison')
        .setRequired(false)
    ),

  async execute(interaction) {
    let replied = false;

    async function safeReply(content, isEphemeral = false) {
      // If replies are globally disabled for this command, inform the user.
      if (!SENDS.REPLIES) {
        try {
          if (replied || interaction.deferred) {
            const res = await interaction.followUp({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          } else {
            const res = await interaction.reply({ content: 'This command is disabled', flags: 64 });
            replied = true;
            return res;
          }
        } catch (err) {
          return null;
        }
      }

      const options = typeof content === 'string' ? { content } : content;
      if (isEphemeral) options.flags = 64;
      try {
        if (replied || interaction.deferred) {
          return await interaction.followUp(options);
        } else {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        }
      } catch (err) {
        // Fallback: try reply if followUp failed because interaction wasn't replied/deferred
        try {
          const res = await interaction.reply(options);
          replied = true;
          return res;
        } catch (err2) {
          return null;
        }
      }
    }

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel && SENDS.LOGS) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`🧮 **/count** used by **${userTag}** in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      const hasPermission = await checkPermissions(interaction);
      await logUsage("Attempting to count roles");

      if (!hasPermission) {
        if (SENDS.LOGS) await logUsage("❌ Permission denied");
        return safeReply("❌ You do not have permission to run this command!", true);
      }

      const guild = interaction.guild;
      if (!guild) return safeReply("❌ This command can only be used in a server.", true);

      await guild.members.fetch();

      const type = interaction.options.getString('type');
      const role1 = interaction.options.getRole('role1');
      const role2 = interaction.options.getRole('role2');
      const role3 = interaction.options.getRole('role3');

      let count = 0;
      let total = guild.memberCount;

      guild.members.cache.forEach(member => {
        const has1 = member.roles.cache.has(role1.id);
        const has2 = role2 ? member.roles.cache.has(role2.id) : false;
        const has3 = role3 ? member.roles.cache.has(role3.id) : false;

        if (type === 'only') {
          if (has1 && !has2 && !has3) count++;
        } else if (type === 'both') {
          if (has1 && has2) count++;
        } else if (type === 'neither') {
          if (!has1 && (!role2 || !has2) && (!role3 || !has3)) count++;
        }
      });

      let desc = '';
      if (type === 'only')
        desc = `✅ Members with **${role1}** only${role2 || role3 ? ' (and not the others)' : ''}: **${count}**`;
      else if (type === 'both')
        desc = `✅ Members with **both ${role1}** and **${role2}**: **${count}**`;
      else
        desc = `✅ Members with **neither ${role1}${role2 ? ` nor ${role2}` : ''}${role3 ? ` nor ${role3}` : ''}**: **${count}**`;

      const result = [
        `**Count Type:** ${type.toUpperCase()}`,
        `**Total Members:** ${total}`,
        desc
      ].join('\n');

      if (SENDS.LOGS) await logUsage(`✅ Count completed (${type}): ${count}`);
      return safeReply(result);

    } catch (error) {
      console.error("❌ Error executing /count:", error);
      if (SENDS.LOGS) await logUsage("❌ Unexpected error during count");
      try {
        await safeReply("❌ Error executing command.", true);
      } catch (err) {
        console.error("❌ Failed to send error message via safeReply:", err);
      }
    }
  }
};
