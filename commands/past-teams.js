const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const config = require('../config.json');
const { connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { PAST_HOEDOWN_EVENTS, findPastHoedownTeams } = require('../database/pastHoedownTeams');
const MESSAGE_LIMIT = 1900;

function formatPastTeamsMessages(eventName, results) {
  const messages = [];
  const header = `Here are your past teams for **${eventName}**:\n`;
  let current = header;

  for (const result of results) {
    const members = Array.isArray(result.members)
      ? result.members.map((member) => typeof member === 'string'
        ? member
        : member.name || member.discordId || 'Unknown member')
      : [];
    const teamLine = `**Round #${result.round} — Team ${result.team}**\n${members.join('\n')}`;
    const separator = current === header ? '' : '\n\n';
    if (current.length + separator.length + teamLine.length > MESSAGE_LIMIT && current !== header) {
      messages.push(current);
      current = `Past teams for **${eventName}** (continued):\n`;
    }

    const nextSeparator = current.endsWith(':\n') ? '' : '\n\n';
    current += `${nextSeparator}${teamLine}`;
  }

  if (current !== header) messages.push(current);
  return messages;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('past-teams')
    .setDescription('Lookup your past teams for a selected event')
    .addStringOption(option =>
      option.setName('event').setDescription('Choose an event').setRequired(true)
        .addChoices(...PAST_HOEDOWN_EVENTS.map(({ id, name }) => ({ name, value: id })))
    ),
  formatPastTeamsMessages,

  async execute(interaction) {
    const eventId = interaction.options.getString('event');
    const event = PAST_HOEDOWN_EVENTS.find((candidate) => candidate.id === eventId);
    const eventName = event?.name || eventId;

    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(`📝 **/past-teams** used by **${userTag}** (event: **${eventName}**) in **#${channelName}** ${extra}`);
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    await interaction.reply({ content: `🔄 Searching your past teams for **${eventName}**...`, flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      const database = await connectHoedownInfoDatabase();
      const teams = await findPastHoedownTeams(database, eventId, interaction.user.id);

      if (!Array.isArray(teams) || teams.length === 0) {
        await logUsage('✅ No past teams found');
        return await safeEdit(interaction, `No past teams found for **${eventName}**.`);
      }

      const messages = formatPastTeamsMessages(eventName, teams);
      await safeEdit(interaction, messages[0]);
      for (const message of messages.slice(1)) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      }
      await logUsage('✅ past-teams successful');

    } catch (error) {
      console.error('❌ Error in /past-teams:', error);
      await safeEdit(interaction, '⚠️ Error fetching past teams. Please try again later.');
      await logUsage(`❌ Error: ${error.message}`);
    }

    async function safeEdit(interaction, content) {
      try {
        await interaction.editReply({ content });
      } catch {
        try {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } catch {}
      }
    }
  }
};
