const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.json');
const { removeOptInReactions } = require('../utils/optInReactions');
const { closeHoedownInfo, connectDiscordMemberListDatabase } = require('../database/hoedownInfo');
const { importMemberListRows, parseMemberListCsv } = require('../database/memberListImport');

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 20000;

async function downloadCsv(attachment) {
  if (!attachment.name.toLowerCase().endsWith('.csv')) {
    throw new TypeError('Upload the Discord Member List tab as a .csv file.');
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

async function importMemberListCsv(interaction, attachment) {
  const buffer = await downloadCsv(attachment);
  const rows = parseMemberListCsv(buffer);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`member-import-confirm-${interaction.id}`)
      .setLabel('Import member list')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`member-import-cancel-${interaction.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.editReply({
    content: `Validated ${rows.length} member row(s) for the members collection in the Discord Member List database. Existing profiles will be updated by Discord ID; no other records will be deleted. Proceed?`,
    components: [row]
  });

  const confirmation = await waitForImportConfirmation(await interaction.fetchReply(), interaction.user.id);
  if (!confirmation) {
    await interaction.editReply({ content: 'Import confirmation expired. No data was written.', components: [] });
    return;
  }
  if (confirmation.customId === `member-import-cancel-${interaction.id}`) {
    await confirmation.update({ content: 'Import canceled. No data was written.', components: [] });
    return;
  }

  await confirmation.update({ content: 'Importing member profiles…', components: [] });
  try {
    const database = await connectDiscordMemberListDatabase();
    let result;
    try {
      result = await importMemberListRows(database, rows);
    } finally {
      await closeHoedownInfo();
    }
    await interaction.editReply({
      content: `✅ Import complete: ${result.profileCount} profile(s) in ${result.collectionName}; ${result.insertedCount} inserted and ${result.matchedCount} matched by Discord ID.`,
      components: []
    });
  } catch (error) {
    console.error('❌ Discord Member List import failed:', error);
    await interaction.editReply(`❌ Import failed: ${error.message}`);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only utilities for opt-in reactions and member data.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The person to remove from all opt-in time slots')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('file')
        .setDescription('CSV export of the Discord Member List tab')
        .setRequired(false)),

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
    if (Boolean(target) === Boolean(attachment)) {
      return interaction.editReply('Choose exactly one option: a player to remove reactions, or a .csv member-list file.');
    }
    if (attachment) {
      try {
        await importMemberListCsv(interaction, attachment);
      } catch (err) {
        console.error('❌ Error importing Discord Member List workbook:', err);
        await interaction.editReply(`❌ Failed to prepare member-list import: ${err.message}`);
      }
      return;
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