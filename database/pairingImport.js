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
  if (records.length > MAX_ROWS + 1) throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows.`);
  if (records[0].length > 4) {
    const datasetName = relationshipField === 'avoids' ? 'Avoids' : 'Previous Pairings';
    throw new Error(
      `${datasetName} imports require a four-column pairs CSV: left ID, right ID, left name, right name. For event-sheet exports, use the past-hoedown-teams subcommand.`
    );
  }

  const rows = isHeaderRow(records[0]) ? records.slice(1) : records;
  if (rows.length === 0) throw new Error('The CSV must include at least one pairing row.');
  if (rows.length > MAX_ROWS) {
    throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows or 4 columns.`);
  }

  const groups = new Map();
  const addRelationship = (leftId, rightId, leftName, rightName, rowNumber) => {
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
  };

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

    addRelationship(leftId, rightId, leftName, rightName, rowNumber);
    if (relationshipField === 'previousPairings') {
      addRelationship(rightId, leftId, rightName, leftName, rowNumber);
    }
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

async function addAvoidRelationships(database, users) {
  if (!Array.isArray(users) || users.length < 2) {
    throw new TypeError('At least two players are required to add an avoid relationship.');
  }
  const [source, ...targets] = users;
  if (!/^\d{17,20}$/.test(String(source.id)) || !source.username) {
    throw new TypeError('The player requesting avoids must have a valid Discord ID and username.');
  }

  const uniqueTargets = new Map();
  for (const target of targets) {
    if (!/^\d{17,20}$/.test(String(target.id)) || !target.username) {
      throw new TypeError('Each avoided player must have a valid Discord ID and username.');
    }
    if (String(target.id) !== String(source.id)) uniqueTargets.set(String(target.id), target);
  }
  if (uniqueTargets.size === 0) {
    throw new TypeError('Select at least one player other than the player requesting avoids.');
  }

  const operations = [...uniqueTargets.values()].map((target) => {
    const targetId = String(target.id);
    const targetName = String(target.username);
    const targetEntry = { discordId: targetId, name: targetName };
    return {
      updateOne: {
        filter: { _id: String(source.id) },
        update: [{
          $set: {
            name: { $literal: String(source.username) },
            avoids: {
              $let: {
                vars: { currentAvoids: { $ifNull: ['$avoids', []] } },
                in: {
                  $cond: [
                    {
                      $in: [
                        { $literal: targetId },
                        {
                          $map: {
                            input: '$$currentAvoids',
                            as: 'avoid',
                            in: '$$avoid.discordId'
                          }
                        }
                      ]
                    },
                    {
                      $map: {
                        input: '$$currentAvoids',
                        as: 'avoid',
                        in: {
                          $cond: [
                            { $eq: ['$$avoid.discordId', { $literal: targetId }] },
                            { $mergeObjects: ['$$avoid', { $literal: targetEntry }] },
                            '$$avoid'
                          ]
                        }
                      }
                    },
                    { $concatArrays: ['$$currentAvoids', [{ $literal: targetEntry }]] }
                  ]
                }
              }
            }
          }
        }],
        upsert: true
      }
    };
  });

  const result = await database.collection('Avoids').bulkWrite(operations, { ordered: true });
  return {
    collectionName: 'Avoids',
    relationshipCount: uniqueTargets.size,
    insertedCount: result.upsertedCount,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount
  };
}

async function removeAvoidRelationship(database, source, target) {
  const sourceId = String(source?.id || '');
  const targetId = String(target?.id || '');
  if (!/^\d{17,20}$/.test(sourceId) || !/^\d{17,20}$/.test(targetId)) {
    throw new TypeError('Both players must have valid Discord IDs.');
  }
  if (sourceId === targetId) {
    throw new TypeError('A player cannot remove an avoid relationship with themselves.');
  }

  const result = await database.collection('Avoids').updateOne(
    { _id: sourceId, 'avoids.discordId': targetId },
    { $pull: { avoids: { discordId: targetId } } }
  );
  return {
    collectionName: 'Avoids',
    foundDocument: result.matchedCount > 0,
    removed: result.matchedCount > 0 && result.modifiedCount > 0
  };
}

module.exports = {
  addAvoidRelationships,
  importPairingRows,
  parseAvoidsCsv,
  parsePreviousPairingsCsv,
  removeAvoidRelationship
};
