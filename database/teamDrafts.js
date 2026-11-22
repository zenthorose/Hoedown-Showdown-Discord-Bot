const { randomUUID } = require('node:crypto');

const CURRENT_SNAPSHOT_ID = 'current';
const ROUND_COUNT = 16;
const TEAM_SIZE = 3;
const VALID_REGIONS = new Set(['East', 'West', 'Both']);

function playerId(player) {
  return String(player.discordId || player.id || player.name || '').trim();
}

function pairKey(playerA, playerB) {
  return [playerId(playerA), playerId(playerB)].sort().join('|');
}

function shuffle(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function planTeamFormats({ East: eastInput, West: westInput, Both: bothInput }) {
  let east = eastInput.length;
  let west = westInput.length;
  let both = bothInput.length;
  let useEast = east >= west;
  const formats = [];

  while (east + west + both > 0) {
    if (formats.length >= 200) throw new Error('Team planning exceeded its safety limit.');

    let format;
    if (((useEast && east >= 1) || (!useEast && west >= 1)) && both >= 2) {
      format = useEast ? ['East', 'Both', 'Both'] : ['West', 'Both', 'Both'];
      if (useEast) east -= 1;
      else west -= 1;
      both -= 2;
    } else if (((useEast && east >= 2) || (!useEast && west >= 2)) && both === 1) {
      format = useEast ? ['East', 'East', 'Both'] : ['West', 'West', 'Both'];
      if (useEast) east -= 2;
      else west -= 2;
      both -= 1;
    } else if (((useEast && east >= 3) || (!useEast && west >= 3)) && both === 0) {
      format = useEast ? ['East', 'East', 'East'] : ['West', 'West', 'West'];
      if (useEast) east -= 3;
      else west -= 3;
    } else if (((useEast && east === 2) || (!useEast && west === 2)) && both === 0) {
      format = useEast ? ['East', 'East', 'Filler'] : ['West', 'West', 'Filler'];
      if (useEast) east -= 2;
      else west -= 2;
    } else if (((useEast && east === 1) || (!useEast && west === 1)) && both === 1) {
      format = useEast ? ['East', 'Both', 'Filler'] : ['West', 'Both', 'Filler'];
      if (useEast) east -= 1;
      else west -= 1;
      both -= 1;
    } else if (((useEast && east === 1) || (!useEast && west === 1)) && both === 0) {
      format = useEast ? ['East', 'Filler', 'Filler'] : ['West', 'Filler', 'Filler'];
      if (useEast) east -= 1;
      else west -= 1;
    } else if (east === 0 && west === 0 && both >= 3) {
      format = ['Both', 'Both', 'Both'];
      both -= 3;
    } else if (east === 0 && west === 0 && both === 2) {
      format = ['Both', 'Both', 'Filler'];
      both -= 2;
    } else if (east === 0 && west === 0 && both === 1) {
      format = ['Both', 'Filler', 'Filler'];
      both -= 1;
    } else {
      useEast = !useEast;
      continue;
    }

    formats.push(format);
    useEast = !useEast;
  }

  return formats;
}

function labelForTeam(index) {
  const labelIndex = ((Math.max(0, Math.floor(index)) % 78) + 78) % 78;
  const character = String.fromCharCode(65 + (labelIndex % 26));
  if (labelIndex < 26) return character;
  if (labelIndex < 52) return character + character;
  return character + character + character;
}

function labelIndex(label) {
  if (typeof label !== 'string' || !label) return 0;
  const clean = label.toUpperCase();
  const code = clean.charCodeAt(0) - 65;
  if (code < 0 || code > 25) return 0;
  const length = Math.min(clean.length, 3);
  return (length === 1 ? 0 : length === 2 ? 26 : 52) + code;
}

function inspectTeams(teams, previousPairings, avoids) {
  const previousConflicts = [];
  const avoidConflicts = [];
  const regionErrors = [];

  teams.forEach((team, teamIndex) => {
    const activePlayers = team.players.filter((player) => player.region !== 'Filler');
    const regions = new Set(activePlayers.map((player) => player.region));
    if (regions.has('East') && regions.has('West') && !regions.has('Both')) {
      regionErrors.push(team.name);
    }

    for (let left = 0; left < activePlayers.length; left += 1) {
      for (let right = left + 1; right < activePlayers.length; right += 1) {
        const playerA = activePlayers[left];
        const playerB = activePlayers[right];
        const conflict = {
          team: team.name,
          playerA: playerA.name,
          playerB: playerB.name,
          discordIdA: playerId(playerA),
          discordIdB: playerId(playerB)
        };
        const key = pairKey(playerA, playerB);
        if (previousPairings.has(key)) previousConflicts.push(conflict);
        if (avoids.has(key)) avoidConflicts.push(conflict);
      }
    }
  });

  return { previousConflicts, avoidConflicts, regionErrors };
}

function conflictCounts(teams, previousPairings, avoids) {
  let previous = 0;
  let avoid = 0;
  for (const team of teams) {
    const players = team.players.filter((player) => player.region !== 'Filler');
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) {
        const key = pairKey(players[left], players[right]);
        if (previousPairings.has(key)) previous += 1;
        if (avoids.has(key)) avoid += 1;
      }
    }
  }
  return { previous, avoid };
}

function regionSwapAllowed(playerA, playerB) {
  return !(
    (playerA.region === 'East' && playerB.region === 'West') ||
    (playerA.region === 'West' && playerB.region === 'East')
  );
}

function regionTeamValid(team) {
  const regions = new Set(
    team.players.filter((player) => player.region !== 'Filler').map((player) => player.region)
  );
  return !(regions.has('East') && regions.has('West'));
}

function fixTeamConflicts(teams, previousPairings, avoids) {
  let counts = conflictCounts(teams, previousPairings, avoids);
  let swapsApplied = 0;
  let passes = 0;

  while (passes < 1000) {
    passes += 1;
    let fixedConflict = false;

    outer:
    for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
      const team = teams[teamIndex];
      const activePlayers = team.players
        .map((player, playerIndex) => ({ player, playerIndex }))
        .filter(({ player }) => player.region !== 'Filler');

      for (let left = 0; left < activePlayers.length; left += 1) {
        for (let right = left + 1; right < activePlayers.length; right += 1) {
          const playerA = activePlayers[left];
          const playerB = activePlayers[right];
          const key = pairKey(playerA.player, playerB.player);
          if (!previousPairings.has(key) && !avoids.has(key)) continue;

          for (const target of [playerA, playerB]) {
            for (let otherTeamIndex = 0; otherTeamIndex < teams.length; otherTeamIndex += 1) {
              if (otherTeamIndex === teamIndex) continue;
              const otherTeam = teams[otherTeamIndex];

              for (let otherPlayerIndex = 0; otherPlayerIndex < otherTeam.players.length; otherPlayerIndex += 1) {
                const otherPlayer = otherTeam.players[otherPlayerIndex];
                if (otherPlayer.region === 'Filler' || !regionSwapAllowed(target.player, otherPlayer)) continue;

                const proposed = teams.map((entry) => ({
                  ...entry,
                  players: [...entry.players]
                }));
                proposed[teamIndex].players[target.playerIndex] = otherPlayer;
                proposed[otherTeamIndex].players[otherPlayerIndex] = target.player;
                if (!regionTeamValid(proposed[teamIndex]) || !regionTeamValid(proposed[otherTeamIndex])) continue;

                const nextCounts = conflictCounts(proposed, previousPairings, avoids);
                const avoidImproved = nextCounts.avoid < counts.avoid;
                const avoidUnchanged = nextCounts.avoid === counts.avoid;
                const previousImproved = nextCounts.previous < counts.previous;
                if (!avoidImproved && !(avoidUnchanged && previousImproved)) continue;

                teams[teamIndex].players[target.playerIndex] = otherPlayer;
                teams[otherTeamIndex].players[otherPlayerIndex] = target.player;
                counts = nextCounts;
                swapsApplied += 1;
                fixedConflict = true;
                break outer;
              }
            }
          }
        }
      }
    }

    if (!fixedConflict) break;
  }

  return { swapsApplied, passes };
}

function generateTeamGroups(players, { previousPairings = new Set(), avoids = new Set(), startIndex = 0, random = Math.random } = {}) {
  const buckets = {
    East: shuffle(players.filter((player) => player.region === 'East').slice(), random),
    West: shuffle(players.filter((player) => player.region === 'West').slice(), random),
    Both: shuffle(players.filter((player) => player.region === 'Both').slice(), random)
  };
  const formats = planTeamFormats(buckets);
  let fillerCount = 0;

  const teamArrays = formats.map((format) => format.map((region) => {
    if (region === 'Filler') {
      fillerCount += 1;
      return { id: `FILLER_${fillerCount}`, name: `Filler #${fillerCount}`, region: 'Filler' };
    }
    const player = buckets[region].shift();
    if (player) return player;
    fillerCount += 1;
    return { id: `FILLER_${fillerCount}`, name: `Filler #${fillerCount}`, region: 'Filler' };
  }));
  const teams = teamArrays.map((teamPlayers, index) => ({
    name: labelForTeam(startIndex + index),
    players: teamPlayers
  }));
  const initialAudit = inspectTeams(teams, previousPairings, avoids);
  const repair = fixTeamConflicts(teams, previousPairings, avoids);
  const finalAudit = inspectTeams(teams, previousPairings, avoids);

  return {
    teams,
    initialAudit,
    finalAudit,
    swapsApplied: repair.swapsApplied,
    unresolvedPrevious: finalAudit.previousConflicts.length,
    unresolvedAvoids: finalAudit.avoidConflicts.length,
    nextTeamIndex: (startIndex + teams.length) % 78
  };
}

async function loadPairingKeys(collection, field) {
  const documents = await collection.find({}).toArray();
  const keys = new Set();
  for (const document of documents) {
    const leftId = String(document._id || '').trim();
    for (const relationship of Array.isArray(document[field]) ? document[field] : []) {
      const rightId = String(relationship.discordId || relationship.id || '').trim();
      if (leftId && rightId) keys.add([leftId, rightId].sort().join('|'));
    }
  }
  return keys;
}

async function findNextRound(roundsDatabase) {
  let highestPopulatedRound = 0;
  for (let round = 1; round <= ROUND_COUNT; round += 1) {
    const existing = await roundsDatabase.collection(`Round ${round}`).findOne({});
    if (existing) highestPopulatedRound = round;
  }
  if (highestPopulatedRound === ROUND_COUNT) {
    throw new Error('All 16 round collections already contain approved data.');
  }
  return highestPopulatedRound + 1;
}

async function getNextTeamLabelIndex(roundsDatabase, round) {
  if (round <= 1) return 0;
  const previousRound = await roundsDatabase.collection(`Round ${round - 1}`).findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (Number.isSafeInteger(previousRound?.nextTeamIndex)) return previousRound.nextTeamIndex;
  const previousTeams = Array.isArray(previousRound?.teams) ? previousRound.teams : [];
  const lastTeam = previousTeams[previousTeams.length - 1];
  return lastTeam ? (labelIndex(lastTeam.name) + 1) % 78 : 0;
}

function getPlayerSnapshot(reactedPlayers, memberDocuments) {
  const profiles = new Map(memberDocuments.map((member) => [String(member._id), member]));
  const allPlayers = [];
  const eligiblePlayers = [];

  for (const reactedPlayer of reactedPlayers) {
    const discordId = String(reactedPlayer.id || '').trim();
    const profile = profiles.get(discordId);
    const region = typeof profile?.region === 'string' ? profile.region.trim() : '';
    const name = String(profile?.nickname || profile?.username || reactedPlayer.name || 'Unknown').trim();
    const player = {
      discordId,
      username: String(profile?.username || reactedPlayer.name || '').trim(),
      name,
      region: VALID_REGIONS.has(region) ? region : null,
      steamId: profile?.steamId || null,
      streamLink: profile?.streamLink || null,
      eligible: Boolean(profile && VALID_REGIONS.has(region)),
      ...(profile ? {} : { exclusionReason: 'not-registered' }),
      ...(profile && !VALID_REGIONS.has(region) ? { exclusionReason: 'invalid-region' } : {})
    };
    allPlayers.push(player);
    if (player.eligible) {
      eligiblePlayers.push({
        id: discordId,
        discordId,
        username: player.username,
        name,
        region,
        steamId: player.steamId,
        streamLink: player.streamLink
      });
    }
  }

  return { allPlayers, eligiblePlayers };
}

async function createCurrentTeamDraft({
  reactedPlayers,
  sourceMessageId,
  membersCollection,
  avoidsCollection,
  previousPairingsCollection,
  playersThatReactedCollection,
  teamCheckCollection,
  roundsDatabase,
  random = Math.random,
  now = () => new Date()
}) {
  if (!Array.isArray(reactedPlayers)) throw new TypeError('Reacted players must be an array.');
  const uniquePlayers = new Map();
  for (const player of reactedPlayers) {
    const id = String(player?.id || '').trim();
    if (/^\d{17,20}$/.test(id) && !uniquePlayers.has(id)) {
      uniquePlayers.set(id, { id, name: String(player.name || '').trim() });
    }
  }
  if (uniquePlayers.size === 0) throw new Error('No eligible Discord users reacted to the selected message.');

  const currentDraft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (currentDraft?.status === 'approving') {
    throw new Error('The current draft is being approved. Try again after approval finishes.');
  }
  const round = currentDraft?.status === 'pending'
    ? currentDraft.round
    : await findNextRound(roundsDatabase);
  if (!Number.isInteger(round) || round < 1 || round > ROUND_COUNT) {
    throw new Error('The current Team Check draft has an invalid round number.');
  }

  const memberDocuments = await membersCollection.find({
    _id: { $in: [...uniquePlayers.keys()] }
  }).toArray();
  const { allPlayers, eligiblePlayers } = getPlayerSnapshot([...uniquePlayers.values()], memberDocuments);
  if (eligiblePlayers.length === 0) {
    throw new Error('None of the reacted users have a registered profile with a valid region.');
  }

  const [avoids, previousPairings] = await Promise.all([
    loadPairingKeys(avoidsCollection, 'avoids'),
    loadPairingKeys(previousPairingsCollection, 'previousPairings')
  ]);
  const teamLabelStartIndex = currentDraft?.status === 'pending' &&
    Number.isSafeInteger(currentDraft.teamLabelStartIndex)
    ? currentDraft.teamLabelStartIndex
    : await getNextTeamLabelIndex(roundsDatabase, round);
  const generated = generateTeamGroups(eligiblePlayers, {
    previousPairings,
    avoids,
    startIndex: teamLabelStartIndex,
    random
  });
  const timestamp = now();
  const generationId = randomUUID();
  const draft = {
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    round,
    status: 'generating',
    sourceMessageId: String(sourceMessageId || ''),
    generatedAt: timestamp,
    updatedAt: timestamp,
    teamLabelStartIndex,
    nextTeamIndex: generated.nextTeamIndex,
    reactedPlayerCount: allPlayers.length,
    eligiblePlayerCount: eligiblePlayers.length,
    excludedPlayers: allPlayers.filter((player) => !player.eligible),
    teams: generated.teams,
    checks: {
      initial: generated.initialAudit,
      final: generated.finalAudit,
      swapsApplied: generated.swapsApplied,
      unresolvedPrevious: generated.unresolvedPrevious,
      unresolvedAvoids: generated.unresolvedAvoids
    },
    previewStatus: 'not-posted',
    previewMessageIds: []
  };

  await teamCheckCollection.replaceOne({ _id: CURRENT_SNAPSHOT_ID }, draft, { upsert: true });
  await playersThatReactedCollection.replaceOne({
    _id: CURRENT_SNAPSHOT_ID
  }, {
    _id: CURRENT_SNAPSHOT_ID,
    round,
    sourceMessageId: draft.sourceMessageId,
    updatedAt: timestamp,
    players: allPlayers
  }, { upsert: true });
  const updated = await teamCheckCollection.updateOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId
  }, {
    $set: { status: 'pending', updatedAt: now() }
  });
  if (!updated.matchedCount) throw new Error('The Team Check draft changed while it was being saved.');

  return { ...draft, status: 'pending' };
}

function formatTeamCheckPreview(draft) {
  let message = `**Round #${draft.round} – Team Check Preview**\n\n`;
  for (const team of draft.teams) {
    message += `__**Team ${team.name}:**__\n`;
    for (const player of team.players) {
      message += `${String(player.name).replace(/([\\_*~`|>])/g, '\\$1')} (${player.region})\n`;
    }
    message += '\n';
  }

  const { avoidConflicts, previousConflicts } = draft.checks.final;
  if (avoidConflicts.length === 0 && previousConflicts.length === 0) {
    message += '✅ No Previous Pairings or Avoid Pairings Detected';
  } else {
    if (avoidConflicts.length > 0) {
      message += `\n__**Avoid Pairings Found (${avoidConflicts.length})**__\n`;
      for (const conflict of avoidConflicts) {
        message += `🔴 ${conflict.playerA} × ${conflict.playerB}\n`;
      }
    }
    if (previousConflicts.length > 0) {
      message += `\n__**Previous Pairings Found (${previousConflicts.length})**__\n`;
      for (const conflict of previousConflicts) {
        message += `⚠️ ${conflict.playerA} × ${conflict.playerB}\n`;
      }
    }
  }
  return message.trim();
}

function splitDiscordMessage(message, maxLength = 1900) {
  const chunks = [];
  let current = '';
  for (const line of message.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
    while (current.length > maxLength) {
      chunks.push(current.slice(0, maxLength));
      current = current.slice(maxLength);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function beginCurrentDraftApproval({ teamCheckCollection, roundsDatabase, round, now = () => new Date() }) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.round !== round || !['pending', 'approving', 'approved'].includes(draft.status)) {
    throw new Error(`No pending Team Check draft exists for Round #${round}.`);
  }

  const roundCollection = roundsDatabase.collection(`Round ${round}`);
  const existingRound = await roundCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (existingRound && existingRound.generationId !== draft.generationId) {
    throw new Error(`Round #${round} already contains different approved data.`);
  }
  if (draft.status === 'approved' && (!existingRound || existingRound.status !== 'approving')) {
    throw new Error(`Round #${round} has already been approved.`);
  }

  if (!existingRound) {
    if (draft.status === 'pending') {
      const updated = await teamCheckCollection.updateOne({
        _id: CURRENT_SNAPSHOT_ID,
        generationId: draft.generationId,
        status: 'pending'
      }, {
        $set: { status: 'approving', updatedAt: now() }
      });
      if (!updated.matchedCount) throw new Error('The Team Check draft changed before approval started.');
    }

    try {
      await roundCollection.insertOne({
        _id: CURRENT_SNAPSHOT_ID,
        generationId: draft.generationId,
        round,
        status: 'approving',
        teams: draft.teams,
        approvedAt: null,
        nextTeamIndex: draft.nextTeamIndex,
        discordPosts: { roundMessageIds: [], teamMessageIds: {} }
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const concurrentRound = await roundCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
      if (concurrentRound?.generationId !== draft.generationId) throw error;
    }
  } else if (existingRound.status === 'approved') {
    throw new Error(`Round #${round} has already been approved.`);
  }

  return {
    draft: { ...draft, status: 'approving' },
    roundCollection,
    roundRecord: existingRound || await roundCollection.findOne({ _id: CURRENT_SNAPSHOT_ID })
  };
}

async function recordPreviousPairings(collection, teams) {
  for (const team of teams) {
    const players = team.players.filter((player) => player.region !== 'Filler' && player.discordId);
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) {
        const playerA = players[left];
        const playerB = players[right];
        for (const [source, target] of [[playerA, playerB], [playerB, playerA]]) {
          const sourceId = String(source.discordId);
          const targetId = String(target.discordId);
          await collection.updateOne({ _id: sourceId }, {
            $set: { name: source.name }
          }, { upsert: true });
          const updated = await collection.updateOne({
            _id: sourceId,
            'previousPairings.discordId': targetId
          }, {
            $set: { 'previousPairings.$.name': target.name }
          });
          if (!updated.matchedCount) {
            await collection.updateOne({ _id: sourceId }, {
              $addToSet: {
                previousPairings: { discordId: targetId, name: target.name }
              }
            });
          }
        }
      }
    }
  }
}

async function completeCurrentDraftApproval({ teamCheckCollection, roundCollection, generationId, now = () => new Date() }) {
  const currentRound = await roundCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!currentRound || currentRound.generationId !== generationId) {
    throw new Error('Could not find the matching round record to finalize.');
  }
  if (currentRound.status === 'approved') return currentRound.approvedAt;

  const approvedAt = now();
  const draftResult = await teamCheckCollection.updateOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    status: 'approving'
  }, {
    $set: { status: 'approved', approvedAt, updatedAt: approvedAt }
  });
  if (!draftResult.matchedCount) {
    const currentDraft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
    if (currentDraft?.generationId !== generationId || currentDraft.status !== 'approved') {
      throw new Error('Could not finalize the Team Check draft status.');
    }
  }

  const roundResult = await roundCollection.updateOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    status: 'approving'
  }, {
    $set: { status: 'approved', approvedAt }
  });
  if (!roundResult.matchedCount) {
    const updatedRound = await roundCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
    if (updatedRound?.generationId !== generationId || updatedRound.status !== 'approved') {
      throw new Error('Could not finalize the approved round record.');
    }
  }
  return approvedAt;
}

module.exports = {
  CURRENT_SNAPSHOT_ID,
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  createCurrentTeamDraft,
  findNextRound,
  formatTeamCheckPreview,
  generateTeamGroups,
  labelForTeam,
  loadPairingKeys,
  recordPreviousPairings,
  splitDiscordMessage
};
