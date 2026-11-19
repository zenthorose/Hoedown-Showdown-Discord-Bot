const { parse } = require('csv-parse/sync');

const MAX_ROWS = 10000;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const HEADER_FIELDS = {
  eventid: 'eventId',
  eventname: 'eventName',
  round: 'round',
  team: 'team',
  discordid: 'discordId',
  name: 'name',
  playername: 'name',
  username: 'name'
};

function parsePastHoedownTeamsCsv(buffer) {
  const records = parse(buffer, {
    bom: true,
    skip_empty_lines: true,
    trim: true
  });
  if (records.length < 2) {
    throw new Error('The CSV must include a header row and at least one team-member row.');
  }
  if (records.length > MAX_ROWS + 1 || records[0].length > 16) {
    throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows or 16 columns.`);
  }

  const columns = new Map();
  records[0].forEach((value, index) => {
    const header = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    const field = HEADER_FIELDS[header];
    if (!field) return;
    if (columns.has(field)) throw new Error(`The CSV has duplicate "${field}" columns.`);
    columns.set(field, index);
  });
  const requiredFields = ['eventId', 'eventName', 'round', 'team', 'discordId', 'name'];
  const missingFields = requiredFields.filter((field) => !columns.has(field));
  if (missingFields.length) {
    throw new Error(`The CSV must include columns for: ${missingFields.join(', ')}.`);
  }

  const teams = new Map();
  const eventNames = new Map();
  for (const [index, record] of records.slice(1).entries()) {
    const rowNumber = index + 2;
    if (record.length > records[0].length) {
      throw new Error(`Row ${rowNumber}: contains more columns than the header.`);
    }

    const values = {};
    for (const [field, column] of columns) {
      values[field] = String(record[column] ?? '').trim();
    }
    if (Object.values(values).every((value) => !value)) continue;

    const { eventId, eventName, team, discordId, name } = values;
    const round = Number(values.round);
    if (!eventId || !/^[a-z0-9_-]+$/i.test(eventId)) {
      throw new TypeError(`Row ${rowNumber}: Event ID must use only letters, numbers, underscores, or hyphens.`);
    }
    if (!eventName) throw new TypeError(`Row ${rowNumber}: Event Name is required.`);
    if (!Number.isInteger(round) || round < 1) {
      throw new TypeError(`Row ${rowNumber}: Round must be a positive whole number.`);
    }
    if (!team) throw new TypeError(`Row ${rowNumber}: Team is required.`);
    if (!DISCORD_ID_PATTERN.test(discordId)) {
      throw new TypeError(`Row ${rowNumber}: Discord ID must be a 17-20 digit value.`);
    }
    if (!name) throw new TypeError(`Row ${rowNumber}: Name is required.`);

    const existingEventName = eventNames.get(eventId);
    if (existingEventName && existingEventName !== eventName) {
      throw new Error(`Row ${rowNumber}: Event ID ${eventId} has inconsistent event names.`);
    }
    eventNames.set(eventId, eventName);

    const teamKey = `${eventId}\0${round}\0${team}`;
    let document = teams.get(teamKey);
    if (!document) {
      document = {
        _id: `${encodeURIComponent(eventId)}:${round}:${encodeURIComponent(team)}`,
        eventId,
        eventName,
        round,
        team,
        members: []
      };
      teams.set(teamKey, document);
    }

    const existingMember = document.members.find((member) => member.discordId === discordId);
    if (existingMember && existingMember.name !== name) {
      throw new Error(`Row ${rowNumber}: Discord ID ${discordId} has inconsistent names in this team.`);
    }
    if (!existingMember) document.members.push({ discordId, name });
  }

  if (teams.size === 0) throw new Error('The CSV contains no team members.');
  return [...teams.values()];
}

async function importPastHoedownTeamsRows(database, rows) {
  const result = await database.collection('PastHoedownTeams').bulkWrite(
    rows.map((team) => {
      const { _id, ...fields } = team;
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
    collectionName: 'PastHoedownTeams',
    teamCount: rows.length,
    memberCount: rows.reduce((count, team) => count + team.members.length, 0),
    insertedCount: result.upsertedCount,
    matchedCount: result.matchedCount
  };
}

async function findPastHoedownTeams(database, eventId, discordId) {
  return database.collection('PastHoedownTeams')
    .find({ eventId, 'members.discordId': String(discordId) })
    .sort({ round: 1, team: 1 })
    .toArray();
}

module.exports = {
  findPastHoedownTeams,
  importPastHoedownTeamsRows,
  parsePastHoedownTeamsCsv
};
