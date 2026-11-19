const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');
const { closeHoedownInfo, connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { importMemberListRows, parseMemberListCsv } = require('../database/memberListImport');
const { importPairingRows, parseAvoidsCsv, parsePreviousPairingsCsv } = require('../database/pairingImport');
const {
  PAST_HOEDOWN_EVENTS,
  importPastHoedownTeamsRows,
  parsePastHoedownEventCsv
} = require('../database/pastHoedownTeams');

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 20000;

async function downloadCsv(attachment) {
  if (!attachment.name.toLowerCase().endsWith('.csv')) {
    throw new TypeError('Upload a .csv file.');
  }
  if (attachment.size > MAX_CSV_BYTES) {
    throw new TypeError('The CSV must be 10 MB or smaller.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Could not download the workbook (HTTP ${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_CSV_BYTES) throw new TypeError('The CSV must be 10 MB or smaller.');
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForImportConfirmation(reply, userId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const collector = reply.createMessageComponentCollector({
      filter: (component) => component.user.id === userId,
      time: 60000,
      max: 1
    });
    collector.once('collect', finish);
    collector.once('end', (collected) => {
      if (collected.size === 0) finish(null);
    });
  });
}

async function importHoedownCsv(interaction, dataset, attachment) {
  const imports = {
    members: {
      label: 'Members',
      parse: parseMemberListCsv,
      async write(database, rows) {
        return importMemberListRows(database, rows);
      },
      preview(rows) {
        return `Validated ${rows.length} member row(s) for the Members collection in HoedownInfo. Existing profiles will be updated by Discord ID; other records will not be deleted. Proceed?`;
      },
      complete(result) {
        return `✅ Import complete: ${result.profileCount} profile(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched by Discord ID.`;
      }
    },
    avoids: {
      label: 'Avoids',
      parse: parseAvoidsCsv,
      async write(database, rows) {
        return importPairingRows(database, rows, 'Avoids');
      },
      preview(rows) {
        const relationshipCount = rows.reduce((count, row) => count + row.avoids.length, 0);
        return `Validated ${relationshipCount} avoid relationship(s) across ${rows.length} left-ID document(s) for the Avoids collection in HoedownInfo. The uploaded avoid list will replace the list for those left IDs; other IDs will remain unchanged. Proceed?`;
      },
      complete(result) {
        return `✅ Import complete: ${result.relationshipCount} avoid relationship(s) across ${result.documentCount} left-ID document(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched.`;
      }
    },
    'previous-pairings': {
      label: 'Previous Pairings',
      parse: parsePreviousPairingsCsv,
      async write(database, rows) {
        return importPairingRows(database, rows, 'PreviousPairings');
      },
      preview(rows) {
        const relationshipCount = rows.reduce((count, row) => count + row.previousPairings.length, 0);
        return `Validated ${relationshipCount} previous-pairing entries across ${rows.length} participant document(s) for the PreviousPairings collection in HoedownInfo. Each pairing will be saved for both participants; other IDs will remain unchanged. Proceed?`;
      },
      complete(result) {
        return `✅ Import complete: ${result.relationshipCount} previous pairing(s) across ${result.documentCount} left-ID document(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched.`;
      }
    },
    'past-hoedown-teams': {
      label: 'Past Hoedown Teams',
      async prepare(buffer, eventId) {
        const event = PAST_HOEDOWN_EVENTS.find((candidate) => candidate.id === eventId);
        if (!event) throw new Error('Choose a supported Hoedown event.');

        const database = await connectHoedownInfoDatabase();
        try {
          const members = await database.collection('Members')
            .find({}, {
              projection: {
                _id: 1,
                discordId: 1,
                username: 1,
                nickname: 1
              }
            })
            .toArray();
          return parsePastHoedownEventCsv(buffer, event.id, event.name, members);
        } finally {
          await closeHoedownInfo();
        }
      },
      async write(database, rows) {
        return importPastHoedownTeamsRows(database, rows);
      },
      preview(rows) {
        const memberCount = rows.reduce((count, team) => count + team.members.length, 0);
        return `Validated ${memberCount} team-member row(s) grouped into ${rows.length} event/round/team document(s) in PastHoedownTeams. Matching team snapshots will be updated; other teams will remain unchanged. Proceed?`;
      },
      complete(result) {
        return `✅ Import complete: ${result.memberCount} member(s) across ${result.teamCount} team snapshot(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched.`;
      }
    }
  };
  const importConfig = imports[dataset];
  const buffer = await downloadCsv(attachment);
  const rows = importConfig.prepare
    ? await importConfig.prepare(buffer, interaction.options.getString('event'))
    : importConfig.parse(buffer);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hoedown-import-confirm-${interaction.id}`)
      .setLabel(`Import ${importConfig.label}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`hoedown-import-cancel-${interaction.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.editReply({ content: importConfig.preview(rows), components: [row] });

  const confirmation = await waitForImportConfirmation(await interaction.fetchReply(), interaction.user.id);
  if (!confirmation) {
    await interaction.editReply({ content: 'Import confirmation expired. No data was written.', components: [] });
    return;
  }
  if (confirmation.customId === `hoedown-import-cancel-${interaction.id}`) {
    await confirmation.update({ content: 'Import canceled. No data was written.', components: [] });
    return;
  }

  await confirmation.update({ content: `Importing ${importConfig.label}…`, components: [] });
  try {
    const database = await connectHoedownInfoDatabase();
    let result;
    try {
      result = await importConfig.write(database, rows);
    } finally {
      await closeHoedownInfo();
    }
    await interaction.editReply({ content: importConfig.complete(result), components: [] });
  } catch (error) {
    console.error(`❌ ${importConfig.label} import failed:`, error);
    await interaction.editReply(`❌ Import failed: ${error.message}`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only Hoedown data import utilities.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('members')
        .setDescription('Import member profiles')
        .addAttachmentOption(option =>
          option.setName('file')
            .setDescription('CSV export of the Discord Member List')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('avoids')
        .setDescription('Import Avoids relationships')
        .addAttachmentOption(option =>
          option.setName('file')
            .setDescription('CSV with left ID, right ID, left name, right name')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('previous-pairings')
        .setDescription('Import Previous Pairings')
        .addAttachmentOption(option =>
          option.setName('file')
            .setDescription('CSV with left ID, right ID, left name, right name')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('past-hoedown-teams')
        .setDescription('Import past event team snapshots')
        .addStringOption(option =>
          option.setName('event')
            .setDescription('Choose the event in this team export')
            .setRequired(true)
            .addChoices(...PAST_HOEDOWN_EVENTS.map(({ id, name }) => ({ name, value: id }))))
        .addAttachmentOption(option =>
          option.setName('file')
            .setDescription('CSV export of the selected Hoedown event sheet')
            .setRequired(true))),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    try {
      const dataset = interaction.options.getSubcommand();
      const attachment = interaction.options.getAttachment('file');
      await importHoedownCsv(interaction, dataset, attachment);
    } catch (err) {
      const dataset = interaction.options.getSubcommand();
      const label = dataset === 'previous-pairings' ? 'Previous Pairings' :
        dataset === 'avoids' ? 'Avoids' :
          dataset === 'past-hoedown-teams' ? 'Past Hoedown Teams' : 'Members';
      console.error(`❌ Error importing ${label}:`, err);
      await interaction.editReply(`❌ Failed to prepare ${label} import: ${err.message}`);
    }
  },
};