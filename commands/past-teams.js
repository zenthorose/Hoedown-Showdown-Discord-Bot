const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const axios = require('axios');
const config = require('../config.json');
const { closeHoedownInfo, connectHoedownInfoDatabase } = require('../database/hoedownInfo');
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
    const triggerUrl = process.env.Google_Apps_Script_URL;
    const source = process.env.PAST_TEAMS_SOURCE || 'apps-script';
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

    if (!['apps-script', 'mongodb'].includes(source)) {
      await logUsage(`❌ Invalid PAST_TEAMS_SOURCE: ${source}`);
      return await interaction.reply({
        content: '❌ Error: PAST_TEAMS_SOURCE must be set to "apps-script" or "mongodb".',
        flags: MessageFlags.Ephemeral
      });
    }

    if (source === 'apps-script' && !triggerUrl) {
      await logUsage("❌ GAS URL missing");
      return await interaction.reply({ content: '❌ Error: Google Apps Script URL is not defined.', flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({ content: `🔄 Searching your past teams for **${eventName}**...`, flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      let data;
      if (source === 'mongodb') {
        let database;
        try {
          database = await connectHoedownInfoDatabase();
          const teams = await findPastHoedownTeams(database, eventId, interaction.user.id);
          data = { success: true, eventName, results: teams };
        } finally {
          await closeHoedownInfo();
        }
      } else {
        const response = await axios.post(triggerUrl, {
          command: 'past-teams',
          eventSheetName: eventName,
          userId: interaction.user.id
        });
        data = response.data;
      }

      if (data.error) {
        await logUsage(`❌ Error: ${data.error}`);
        return await safeEdit(interaction, `❌ ${data.error}`);
      }

      if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
        await logUsage('✅ No past teams found');
        return await safeEdit(interaction, `No past teams found for **${eventName}**.`);
      }

      const displayEvent = data.eventName || eventName;
      const messages = formatPastTeamsMessages(displayEvent, data.results);
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
