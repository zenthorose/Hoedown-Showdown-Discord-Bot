const { parse } = require('csv-parse/sync');

const MAX_ROWS = 10000;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const PAST_HOEDOWN_EVENTS = [
  { id: '2025-10-25', name: '10/25/2025 Hoedown' },
  { id: '2026-05-23', name: '5/23/2026 Hoedown' }
];
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

function buildMemberNameIndex(memberProfiles) {
  const index = new Map();
  for (const profile of memberProfiles) {
    const discordId = String(profile.discordId || profile._id || '').trim();
    if (!DISCORD_ID_PATTERN.test(discordId)) continue;
    for (const alias of [profile.username, profile.nickname]) {
      const name = normalizeTeamMemberName(alias);
      if (!name) continue;
      if (!index.has(name)) index.set(name, new Map());
      index.get(name).set(discordId, profile);
    }
  }
  return index;
}

function normalizeTeamMemberName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+\((?:east|west|both)\)$/i, '')
    .trim()
    .toLowerCase();
}

function resolveTeamMember(value, memberNameIndex, rowNumber, round, team) {
  const sourceName = String(value).trim();
  if (/^Filler(?:\s*#?\d+)?\s*\(Filler\)$/i.test(sourceName)) return { name: sourceName };

  const regionMatch = sourceName.match(/\s+\((east|west|both)\)$/i);
  const region = regionMatch ? regionMatch[1].toLowerCase() : null;
  const name = sourceName.replace(/\s+\((?:east|west|both)\)$/i, '').trim();
  const candidates = [...(memberNameIndex.get(normalizeTeamMemberName(name))?.values() || [])];
  if (candidates.length === 0) {
    throw new Error(`Row ${rowNumber}, Round #${round}, Team ${team}: "${name}" was not found in Members. Import/update Members or fix the name first.`);
  }
  const regionMatches = region && candidates.length > 1
    ? candidates.filter((profile) => String(profile.region || '').trim().toLowerCase() === region)
    : [];
  const matches = regionMatches.length === 1 ? regionMatches : candidates;
  if (matches.length !== 1) {
    throw new Error(`Row ${rowNumber}, Round #${round}, Team ${team}: "${name}" matches multiple Members; resolve it before importing.`);
  }

  const profile = matches[0];
  return {
    discordId: String(profile.discordId || profile._id),
    name
  };
}

function parsePastHoedownEventCsv(buffer, eventId, eventName, memberProfiles) {
  const records = parse(buffer, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });
  if (records.length < 2) throw new Error('The event CSV must include a header and team data.');
  if (records.length > MAX_ROWS + 1 || records[0].length > 32) {
    throw new Error(`The CSV exceeds the import limit of ${MAX_ROWS} rows or 32 columns.`);
  }

  const roundColumns = [];
  const seenRounds = new Set();
  records[0].forEach((value, column) => {
    const match = String(value).trim().match(/^Round\s*#?\s*(\d+)$/i);
    if (!match) return;
    const round = Number(match[1]);
    if (seenRounds.has(round)) throw new Error(`The CSV has duplicate Round #${round} columns.`);
    seenRounds.add(round);
    roundColumns.push({ round, column });
  });
  if (roundColumns.length === 0) {
    throw new Error('No Round # columns were found. Use the event-sheet CSV with its Round # headers.');
  }

  const memberNameIndex = buildMemberNameIndex(memberProfiles);
  const teams = new Map();
  for (const { round, column } of roundColumns) {
    let team = null;
    let members = [];
    const saveTeam = () => {
      if (!team || members.length === 0) return;
      const key = `${eventId}\0${round}\0${team}`;
      let document = teams.get(key);
      if (!document) {
        document = {
          _id: `${encodeURIComponent(eventId)}:${round}:${encodeURIComponent(team)}`,
          eventId,
          eventName,
          round,
          team,
          members: []
        };
        teams.set(key, document);
      }

      for (const member of members) {
        const duplicate = document.members.find((existing) =>
          member.discordId
            ? existing.discordId === member.discordId
            : !existing.discordId && existing.name === member.name
        );
        if (duplicate) {
          throw new Error(`Round #${round}, Team ${team}: "${member.name}" appears more than once.`);
        }
        document.members.push(member);
      }
    };

    for (let rowIndex = 1; rowIndex < records.length; rowIndex += 1) {
      const value = String(records[rowIndex][column] ?? '').trim();
      const teamHeader = value.match(/^Team\s+([A-Z0-9]+)$/i);
      if (teamHeader) {
        saveTeam();
        team = teamHeader[1].toUpperCase();
        members = [];
      } else if (!value) {
        saveTeam();
        team = null;
        members = [];
      } else if (team) {
        members.push(resolveTeamMember(value, memberNameIndex, rowIndex + 1, round, team));
      }
    }
    saveTeam();
  }

  if (teams.size === 0) throw new Error('No team rosters were found under the Round # columns.');
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
  PAST_HOEDOWN_EVENTS,
  findPastHoedownTeams,
  importPastHoedownTeamsRows,
  parsePastHoedownEventCsv,
  parsePastHoedownTeamsCsv
};
