const { SlashCommandBuilder, AttachmentBuilder } = require('@discordjs/builders');
const axios = require('axios');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only command for backend testing.')
    // --- TEST group ---
    .addSubcommandGroup(group =>
      group
        .setName('test')
        .setDescription('Testing utilities')
        .addSubcommand(sub =>
          sub
            .setName('echo')
            .setDescription('Echo back a message')
            .addStringOption(opt =>
              opt.setName('message')
                .setDescription('Message to echo')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('ping')
            .setDescription('Test latency check')
        )
        .addSubcommand(sub =>
          sub
            .setName('team-ids')
            .setDescription('Fetch Discord IDs for teamChannels in config.json')
        )
    )
    // --- RESET group ---
    .addSubcommandGroup(group =>
      group
        .setName('reset')
        .setDescription('Reset data/actions')
        .addSubcommand(sub =>
          sub
            .setName('avoid-list')
            .setDescription('Clear avoid list data'))
        .addSubcommand(sub =>
          sub
            .setName('member-list')
            .setDescription('Reset member list data'))
    )
    // --- MISC group ---
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

      // --- TEST group ---
      if (group === 'test') {
        if (sub === 'echo') {
          const msg = interaction.options.getString('message');
          responseMessage = `🪞 Echo: ${msg}`;
        } else if (sub === 'ping') {
          responseMessage = "🏓 Pong!";
        } else if (sub === 'team-ids') {
          const guild = interaction.guild;
          const teamNames = Object.keys(config.teamChannels || {});
          const mapped = {};

          for (const name of teamNames) {
            const channel = guild.channels.cache.find(c => c.name === name);
            mapped[name] = channel ? channel.id : "❌ Not Found";
          }

          const jsonOutput = JSON.stringify({ teamChannels: mapped }, null, 2);
          const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);

          if (logChannel) {
            // If JSON too long, send as file
            if (jsonOutput.length > 1900) {
              const buffer = Buffer.from(jsonOutput, 'utf8');
              const file = new AttachmentBuilder(buffer, { name: 'teamChannels.json' });
              await logChannel.send({
                content: "📋 **Team Channels IDs** (see attached file)",
                files: [file]
              });
            } else {
              await logChannel.send(`📋 **Team Channels IDs**\n\`\`\`json\n${jsonOutput}\n\`\`\``);
            }
          }

          responseMessage = `✅ Fetched ${teamNames.length} team channel IDs and posted in the log channel.`;
        }
      }

      // --- RESET group ---
      else if (group === 'reset') {
        const action = sub === 'avoid-list' ? 'resetAvoidList' : 'resetMemberList';
        const triggerUrl = process.env.Google_Apps_Script_URL;
        const postData = { command: action };

        const res = await axios.post(triggerUrl, postData);
        responseMessage = `✅ Reset ${sub}.\nResponse: \`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\``;
      }

      // --- MISC group ---
      else if (group === 'misc' && sub === 'run') {
        const action = interaction.options.getString('action');
        let payload = interaction.options.getString('payload') || "";

        try {
          if (payload.startsWith('{') || payload.startsWith('[')) {
            payload = JSON.parse(payload);
          }
        } catch {
          // keep as string if JSON parse fails
        }

        const triggerUrl = process.env.Google_Apps_Script_URL;
        const postData = { command: action, payload };

        const res = await axios.post(triggerUrl, postData);
        responseMessage = `✅ Ran raw action: \`${action}\`\nResponse: \`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\``;
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
