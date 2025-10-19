const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only command for backend testing.')
    .addSubcommandGroup(group =>
      group
        .setName('misc')
        .setDescription('Miscellaneous dev actions')
        .addSubcommand(sub =>
          sub
            .setName('run')
            .setDescription('Send a raw backend action/payload')
            .addStringOption(opt =>
              opt.setName('action')
                .setDescription('Action keyword')
                .setRequired(true))
            .addStringOption(opt =>
              opt.setName('payload')
                .setDescription('Optional payload (string or JSON)'))
            .addStringOption(opt =>
              opt.setName('channel_id')
                .setDescription('ID of the channel to modify permissions'))
            .addBooleanOption(opt =>
              opt.setName('enable')
                .setDescription('Set permissions ON (true) or OFF (false)'))
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `📝 **/dev-command ${group} ${sub}** used by **${interaction.user.tag}** in **#${interaction.channel?.name || "DM"}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    try {
      let responseMessage = "";

      if (group === 'misc' && sub === 'run') {
        const action = interaction.options.getString('action');
        let payload = interaction.options.getString('payload') || "";
        const channelId = interaction.options.getString('channel_id');
        const enable = interaction.options.getBoolean('enable');

        try {
          if (payload.startsWith('{') || payload.startsWith('[')) {
            payload = JSON.parse(payload);
          }
        } catch {
          // keep as string if JSON parse fails
        }

        if (action === 'set_perms' && channelId && enable !== null) {
          const guild = interaction.guild;
          const channel = guild.channels.cache.get(channelId);
          if (!channel) return interaction.editReply(`❌ Channel ID ${channelId} not found.`);

          const everyoneRole = guild.roles.everyone;

          // Get all available permissions
          const allPerms = Object.values(PermissionsBitField.Flags);

          // Build permission object
          const permOverwrite = {};
          for (const perm of allPerms) {
            permOverwrite[perm] = enable;
          }

          await channel.permissionOverwrites.edit(everyoneRole, permOverwrite);
          responseMessage = `✅ Permissions for @everyone in <#${channelId}> have been ${enable ? 'enabled' : 'disabled'}.`;
        } else {
          const triggerUrl = process.env.Google_Apps_Script_URL;
          const postData = { command: action, payload };
          const res = await axios.post(triggerUrl, postData);
          responseMessage = `✅ Ran raw action: \`${action}\`\nResponse: \`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\``;
        }
      }

      await interaction.editReply(responseMessage);
      await logUsage("✅ Success");

    } catch (err) {
      console.error("❌ Error in /dev-command:", err);
      await interaction.editReply(`❌ Error: ${err.message}`);
      await logUsage(`❌ Error: ${err.message}`);
    }
  },
};
