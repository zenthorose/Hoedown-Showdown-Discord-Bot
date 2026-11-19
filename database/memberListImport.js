const { parse } = require('csv-parse/sync');

const HEADER_FIELDS = {
  nickname: 'nickname',
  username: 'username',
  discordid: 'discordId',
  region: 'region',
  steamid: 'steamId',
  streamlink: 'streamLink',
  gender: 'gender'
};

function parseMemberListCsv(buffer) {
  const records = parse(buffer, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });
  if (records.length < 2) throw new Error('The CSV must include a header row and at least one member row.');
  if (records.length > 10001 || records[0].length > 32) {
    throw new Error('The CSV exceeds the import limit of 10,000 rows or 32 columns.');
  }

  const headerRow = records[0];
  const headerColumns = new Map();
  headerRow.forEach((value, index) => {
    const header = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    const field = HEADER_FIELDS[header];
    if (!field) return;
    if (headerColumns.has(field)) throw new Error(`The CSV has duplicate "${field}" columns.`);
    headerColumns.set(field, index);
  });
  if (!headerColumns.has('username') || !headerColumns.has('discordId')) {
    throw new Error('The CSV must have Username and Discord ID columns.');
  }

  const rows = [];
  const seenDiscordIds = new Set();
  for (const [index, record] of records.slice(1).entries()) {
    const rowNumber = index + 2;
    if (record.length > headerRow.length) {
      throw new Error(`Row ${rowNumber}: contains more columns than the header.`);
    }
    const values = {};
    for (const [field, columnIndex] of headerColumns) {
      values[field] = String(record[columnIndex] == null ? '' : record[columnIndex]).trim();
    }
    if (Object.values(values).every((value) => !value)) continue;

    const username = values.username || '';
    if (!username) throw new TypeError(`Row ${rowNumber}: Username is required.`);
    const discordId = values.discordId || '';
    if (!/^\d{17,20}$/.test(discordId)) {
      throw new TypeError(`Row ${rowNumber}: Discord ID must be a 17-20 digit value.`);
    }
    if (seenDiscordIds.has(discordId)) {
      throw new Error(`Row ${rowNumber}: Discord ID ${discordId} appears more than once.`);
    }
    seenDiscordIds.add(discordId);

    rows.push({
      collectionName: discordId,
      profile: {
        _id: discordId,
        discordId,
        username,
        ...(headerColumns.has('nickname') ? { nickname: values.nickname || '' } : {}),
        ...(headerColumns.has('region') ? { region: values.region || '' } : {}),
        ...(headerColumns.has('steamId') ? { steamId: values.steamId || '' } : {}),
        ...(headerColumns.has('streamLink') ? { streamLink: values.streamLink || '' } : {}),
        ...(headerColumns.has('gender') ? { gender: values.gender || '' } : {})
      }
    });
  }

  if (rows.length === 0) throw new Error('The CSV contains no member rows.');
  return rows;
}

async function importMemberListRows(database, rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.collectionName) || [];
    group.push(row.profile);
    groups.set(row.collectionName, group);
  }

  let insertedCount = 0;
  let matchedCount = 0;
  for (const [collectionName, profiles] of groups) {
    const result = await database.collection(collectionName).bulkWrite(
      profiles.map((profile) => ({
        updateOne: {
          filter: { _id: profile._id },
          update: {
            $set: Object.fromEntries(Object.entries(profile).filter(([key]) => key !== '_id'))
          },
          upsert: true
        }
      })),
      { ordered: true }
    );
    insertedCount += result.upsertedCount;
    matchedCount += result.matchedCount;
  }
  return { insertedCount, matchedCount, collectionCount: groups.size, profileCount: rows.length };
}

module.exports = { importMemberListRows, parseMemberListCsv };
