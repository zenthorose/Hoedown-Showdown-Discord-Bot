const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

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
                .setDescription('Optional payload (string or JSON)')))
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // --- Permission check ---
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

      // --- MISC → run ---
      if (group === 'misc' && sub === 'run') {
        const action = interaction.options.getString('action');
        let payload = interaction.options.getString('payload') || "";

        try {
          if (payload.startsWith('{') || payload.startsWith('[')) {
            payload = JSON.parse(payload);
          }
        } catch {
          // keep as string if JSON parse fails
        }

        // If the action is "hide", remove @everyone view permissions for all teamChannels
        if (action === 'hide') {
          const guild = interaction.guild;
          const everyoneRole = guild.roles.everyone;

          for (const channelName of Object.keys(config.teamChannels || {})) {
            const channel = guild.channels.cache.find(c => c.name === channelName);
            if (channel) {
              await channel.permissionOverwrites.edit(everyoneRole, { ViewChannel: false });
            }
          }

          responseMessage = `✅ All team channels are now hidden from @everyone.`;
        } else {
          // Default behavior: send to Google Apps Script
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
