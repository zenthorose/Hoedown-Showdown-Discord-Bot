const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');
const { removeOptInReactions } = require('../utils/optInReactions');
const { closeHoedownInfo, connectHoedownInfoDatabase } = require('../database/hoedownInfo');
const { importMemberListRows, parseMemberListCsv } = require('../database/memberListImport');
const { importPairingRows, parseAvoidsCsv, parsePreviousPairingsCsv } = require('../database/pairingImport');

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

async function importHoedownCsv(interaction, attachment) {
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
        return `Validated ${relationshipCount} previous pairing(s) across ${rows.length} left-ID document(s) for the PreviousPairings collection in HoedownInfo. The uploaded pairing list will replace the list for those left IDs; other IDs will remain unchanged. Proceed?`;
      },
      complete(result) {
        return `✅ Import complete: ${result.relationshipCount} previous pairing(s) across ${result.documentCount} left-ID document(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched.`;
      }
    }
  };
  const importConfig = imports[interaction.options.getString('dataset')];
  const buffer = await downloadCsv(attachment);
  const rows = importConfig.parse(buffer);
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
    .setDescription('Developer-only utilities for opt-in reactions and Hoedown data.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The person to remove from all opt-in time slots')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('file')
        .setDescription('CSV file for the selected Hoedown data import')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('dataset')
        .setDescription('Hoedown data collection to update')
        .setRequired(false)
        .addChoices(
          { name: 'Members', value: 'members' },
          { name: 'Avoids', value: 'avoids' },
          { name: 'Previous Pairings', value: 'previous-pairings' }
        )),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const target = interaction.options.getUser('player');
    const attachment = interaction.options.getAttachment('file');
    const dataset = interaction.options.getString('dataset');
    if (target && (attachment || dataset)) {
      return interaction.editReply('Choose either a player to remove reactions, or a Hoedown data import.');
    }
    if (attachment || dataset) {
      if (!attachment || !dataset) {
        return interaction.editReply('Choose both a data set and its .csv file to import.');
      }
      try {
        await importHoedownCsv(interaction, attachment);
      } catch (err) {
        const label = dataset === 'previous-pairings' ? 'Previous Pairings' :
          dataset === 'avoids' ? 'Avoids' : 'Members';
        console.error(`❌ Error importing ${label}:`, err);
        await interaction.editReply(`❌ Failed to prepare ${label} import: ${err.message}`);
      }
      return;
    }
    if (!target) {
      return interaction.editReply('Choose a player to remove reactions, or select a data set and attach its .csv file.');
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply('❌ This command must be run in a server.');
    }

    try {
      await interaction.editReply(`🔎 Scanning opt-in time slots for ${target.tag}…`);
      const { removedCount, failedCount, slotCount } =
        await removeOptInReactions(interaction.client, guild, target);

      const status = failedCount === 0 ? '✅' : removedCount > 0 ? '⚠️' : '❌';
      const result = `${status} Removed ${removedCount} reaction(s) for ${target.tag} across ${slotCount} opt-in time-slot message(s).` +
        (failedCount > 0 ? `\n${failedCount} reaction(s) could not be checked or removed; see bot logs for details.` : '');
      await interaction.editReply(result);

    } catch (err) {
      console.error('❌ Error removing opt-in reactions:', err);
      await interaction.editReply(`❌ Failed to remove reactions: ${err.message}`);
    }
  },
};