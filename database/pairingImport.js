const { parse } = require('csv-parse/sync');

const MAX_ROWS = 10000;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

function isHeaderRow(record) {
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const [left, right] = record.map(normalize);
  return ['leftid', 'leftdiscordid', 'firstid', 'firstdiscordid', 'discordid1'].includes(left) &&
    ['rightid', 'rightdiscordid', 'secondid', 'seconddiscordid', 'discordid2'].includes(right);
}

function parsePairingCsv(buffer, relationshipField) {
  const records = parse(buffer, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });
  if (records.length === 0) throw new Error('The CSV must include at least one pairing row.');
  if (records.length > MAX_ROWS + 1 || records[0].length > 4) {
    throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows or 4 columns.`);
  }

  const rows = isHeaderRow(records[0]) ? records.slice(1) : records;
  if (rows.length === 0) throw new Error('The CSV must include at least one pairing row.');
  if (rows.length > MAX_ROWS) {
    throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows or 4 columns.`);
  }

  const groups = new Map();
  for (const [index, record] of rows.entries()) {
    const rowNumber = index + (rows.length === records.length ? 1 : 2);
    if (record.length !== 4) {
      throw new Error(`Row ${rowNumber}: expected left ID, right ID, left name, and right name.`);
    }

    const [leftId, rightId, leftName, rightName] = record.map((value) => String(value ?? '').trim());
    if (!DISCORD_ID_PATTERN.test(leftId)) {
      throw new TypeError(`Row ${rowNumber}: left Discord ID must be a 17-20 digit value.`);
    }
    if (!DISCORD_ID_PATTERN.test(rightId)) {
      throw new TypeError(`Row ${rowNumber}: right Discord ID must be a 17-20 digit value.`);
    }
    if (!leftName || !rightName) {
      throw new TypeError(`Row ${rowNumber}: both left and right names are required.`);
    }

    let group = groups.get(leftId);
    if (!group) {
      group = { _id: leftId, name: leftName, relationships: new Map() };
      groups.set(leftId, group);
    } else if (group.name !== leftName) {
      throw new Error(`Row ${rowNumber}: left ID ${leftId} has inconsistent names.`);
    }

    const existingName = group.relationships.get(rightId);
    if (existingName && existingName !== rightName) {
      throw new Error(`Row ${rowNumber}: right ID ${rightId} has inconsistent names.`);
    }
    group.relationships.set(rightId, rightName);
  }

  return [...groups.values()].map(({ _id, name, relationships }) => ({
    _id,
    name,
    [relationshipField]: [...relationships].map(([discordId, rightName]) => ({
      discordId,
      name: rightName
    }))
  }));
}

function parseAvoidsCsv(buffer) {
  return parsePairingCsv(buffer, 'avoids');
}

function parsePreviousPairingsCsv(buffer) {
  return parsePairingCsv(buffer, 'previousPairings');
}

async function importPairingRows(database, rows, collectionName) {
  const result = await database.collection(collectionName).bulkWrite(
    rows.map((document) => {
      const { _id, ...fields } = document;
      return {
        updateOne: {
          filter: { _id },
          update: { $set: fields },
          upsert: true
        }
      };
    }),
    { ordered: true }
  );
  return {
    collectionName,
    documentCount: rows.length,
    relationshipCount: rows.reduce(
      (count, row) => count + (row.avoids?.length || 0) + (row.previousPairings?.length || 0),
      0
    ),
    insertedCount: result.upsertedCount,
    matchedCount: result.matchedCount
  };
}

module.exports = {
  importPairingRows,
  parseAvoidsCsv,
  parsePreviousPairingsCsv
};
