const { randomUUID } = require('node:crypto');
const { ROUND_COUNT, roundCollectionName } = require('./roundCollections');

const CURRENT_SNAPSHOT_ID = 'current';
const TEAM_SIZE = 3;
const GENERATION_LOCK_STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_TEAM_ASSIGNMENT_SEARCH_STEPS = 250000;
const MAX_TEAM_ASSIGNMENT_SEARCH_RESTARTS = 5;
const MAX_TEAM_ASSIGNMENT_SEARCH_STEPS_PER_RESTART =
  Math.ceil(MAX_TEAM_ASSIGNMENT_SEARCH_STEPS / MAX_TEAM_ASSIGNMENT_SEARCH_RESTARTS);
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

function getUsedFillerNumbers(teams) {
  const usedNumbers = new Set();
  for (const team of teams) {
    for (const player of team.players) {
      for (const value of [player.id, player.name]) {
        const match = String(value || '').match(/^(?:FILLER_|Filler #)(\d+)$/i);
        if (match) usedNumbers.add(Number(match[1]));
      }
    }
  }
  return usedNumbers;
}

function nextFillerPlayer(usedNumbers) {
  let number = 1;
  while (usedNumbers.has(number)) number += 1;
  usedNumbers.add(number);
  return {
    id: `FILLER_${number}`,
    name: `Filler #${number}`,
    region: 'Filler'
  };
}

function inspectTeams(teams, previousPairings, avoids) {
  const previousConflicts = [];
  const avoidConflicts = [];
  const regionErrors = [];

  teams.forEach((team, teamIndex) => {
    const activePlayers = team.players.filter((player) => player.region !== 'Filler');
    const regions = new Set(activePlayers.map((player) => player.region));
    if (regions.has('East') && regions.has('West')) {
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

function currentDraftFilter(draft) {
  const filter = { _id: CURRENT_SNAPSHOT_ID };
  for (const field of ['generationId', 'status']) {
    filter[field] = Object.prototype.hasOwnProperty.call(draft, field)
      ? draft[field]
      : { $exists: false };
  }
  return filter;
}

function teamsFromGroups(groups, players, startIndex) {
  let fillerCount = 0;
  return groups.map((group, index) => {
    const teamPlayers = group.map((playerIndex) => players[playerIndex]);
    while (teamPlayers.length < TEAM_SIZE) {
      fillerCount += 1;
      teamPlayers.push({
        id: `FILLER_${fillerCount}`,
        name: `Filler #${fillerCount}`,
        region: 'Filler'
      });
    }
    return { name: labelForTeam(startIndex + index), players: teamPlayers };
  });
}

function findBestTeamAssignment(players, teamCount, previousPairings, avoids, initialTeams, startIndex, random) {
  let bestTeams = initialTeams;
  let bestCounts = conflictCounts(bestTeams, previousPairings, avoids);
  let totalSteps = 0;
  let searchLimitReached = false;
  let searchRestarts = 0;
  let optimalFound = bestCounts.avoid === 0 && bestCounts.previous === 0;

  const pairConflictCount = (group, pairings) => {
    let count = 0;
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        if (pairings.has(pairKey(players[group[left]], players[group[right]]))) count += 1;
      }
    }
    return count;
  };
  const groupHasMixedRegions = (group) => {
    const regions = new Set(group.map((index) => players[index].region));
    return regions.has('East') && regions.has('West');
  };

  // Restarting with new tie-breaks explores different promising branches within one total budget.
  for (let restart = 0;
    restart < MAX_TEAM_ASSIGNMENT_SEARCH_RESTARTS &&
    totalSteps < MAX_TEAM_ASSIGNMENT_SEARCH_STEPS &&
    !optimalFound;
    restart += 1) {
    searchRestarts += 1;
    const tieBreakers = players.map(() => random());
    let restartSteps = 0;
    let restartLimitReached = false;
    const countStep = () => {
      if (restartSteps >= MAX_TEAM_ASSIGNMENT_SEARCH_STEPS_PER_RESTART ||
          totalSteps >= MAX_TEAM_ASSIGNMENT_SEARCH_STEPS) {
        restartLimitReached = true;
        return false;
      }
      restartSteps += 1;
      totalSteps += 1;
      return true;
    };

    function search(remaining, groups, avoidCount, previousCount) {
      if (optimalFound || restartLimitReached || !countStep()) return;

      if (remaining.length === 0) {
        if (groups.length !== teamCount) return;
        if (avoidCount < bestCounts.avoid ||
            (avoidCount === bestCounts.avoid && previousCount < bestCounts.previous)) {
          bestTeams = teamsFromGroups(groups, players, startIndex);
          bestCounts = { avoid: avoidCount, previous: previousCount };
        }
        if (bestCounts.avoid === 0 && bestCounts.previous === 0) optimalFound = true;
        return;
      }

      const teamsLeft = teamCount - groups.length;
      if (remaining.length < teamsLeft || remaining.length > teamsLeft * TEAM_SIZE ||
          avoidCount > bestCounts.avoid ||
          (avoidCount === bestCounts.avoid && previousCount >= bestCounts.previous)) {
        return;
      }

      let pivotPosition = 0;
      let pivotConstraint = -1;
      for (let position = 0; position < remaining.length; position += 1) {
        const candidate = remaining[position];
        let avoidDegree = 0;
        let regionDegree = 0;
        for (const other of remaining) {
          if (candidate === other) continue;
          if (avoids.has(pairKey(players[candidate], players[other]))) avoidDegree += 1;
          if (!regionSwapAllowed(players[candidate], players[other])) regionDegree += 1;
        }
        const constraint = avoidDegree * (remaining.length + 1) + regionDegree;
        if (constraint > pivotConstraint ||
            (constraint === pivotConstraint && tieBreakers[candidate] < tieBreakers[remaining[pivotPosition]])) {
          pivotPosition = position;
          pivotConstraint = constraint;
        }
      }

      const pivot = remaining[pivotPosition];
      const partners = remaining
        .filter((index) => index !== pivot && regionSwapAllowed(players[pivot], players[index]))
        .sort((left, right) => {
          const avoidDifference =
            Number(avoids.has(pairKey(players[pivot], players[left]))) -
            Number(avoids.has(pairKey(players[pivot], players[right])));
          if (avoidDifference) return avoidDifference;
          const previousDifference =
            Number(previousPairings.has(pairKey(players[pivot], players[left]))) -
            Number(previousPairings.has(pairKey(players[pivot], players[right])));
          return previousDifference || tieBreakers[left] - tieBreakers[right];
        });

      const teamsLeftAfter = teamsLeft - 1;
      const minimumGroupSize = Math.max(1, remaining.length - teamsLeftAfter * TEAM_SIZE);
      const maximumGroupSize = Math.min(TEAM_SIZE, remaining.length - teamsLeftAfter);

      for (let groupSize = maximumGroupSize; groupSize >= minimumGroupSize; groupSize -= 1) {
        if (groupSize === 3) {
          for (let first = 0; first < partners.length - 1; first += 1) {
            for (let second = first + 1; second < partners.length; second += 1) {
              if (!countStep()) return;
              const group = [pivot, partners[first], partners[second]];
              if (!groupHasMixedRegions(group)) visitGroup(group);
              if (optimalFound || restartLimitReached) return;
            }
          }
        } else if (groupSize === 2) {
          for (const partner of partners) {
            if (!countStep()) return;
            visitGroup([pivot, partner]);
            if (optimalFound || restartLimitReached) return;
          }
        } else {
          if (!countStep()) return;
          visitGroup([pivot]);
          if (optimalFound || restartLimitReached) return;
        }
      }

      function visitGroup(group) {
        const groupAvoids = pairConflictCount(group, avoids);
        const groupPrevious = pairConflictCount(group, previousPairings);
        const nextAvoids = avoidCount + groupAvoids;
        const nextPrevious = previousCount + groupPrevious;
        if (nextAvoids > bestCounts.avoid ||
            (nextAvoids === bestCounts.avoid && nextPrevious >= bestCounts.previous)) {
          return;
        }

        const selected = new Set(group);
        groups.push(group);
        search(remaining.filter((index) => !selected.has(index)), groups, nextAvoids, nextPrevious);
        groups.pop();
      }
    }

    search(players.map((_, index) => index), [], 0, 0);
    if (restartLimitReached) {
      searchLimitReached = true;
    } else {
      break;
    }
  }

  return {
    teams: bestTeams,
    avoidCount: bestCounts.avoid,
    searchLimitReached,
    searchRestarts
  };
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
          if (!previousPairings.has(key)) continue;

          for (const target of [playerA, playerB]) {
            for (let otherTeamIndex = 0; otherTeamIndex < teams.length; otherTeamIndex += 1) {
              if (otherTeamIndex === teamIndex) continue;
              const otherTeam = teams[otherTeamIndex];

              for (let otherPlayerIndex = 0; otherPlayerIndex < otherTeam.players.length; otherPlayerIndex += 1) {
                const otherPlayer = otherTeam.players[otherPlayerIndex];
                if (!regionSwapAllowed(target.player, otherPlayer)) continue;

                const proposed = teams.map((entry) => ({
                  ...entry,
                  players: [...entry.players]
                }));
                proposed[teamIndex].players[target.playerIndex] = otherPlayer;
                proposed[otherTeamIndex].players[otherPlayerIndex] = target.player;
                if (!regionTeamValid(proposed[teamIndex]) || !regionTeamValid(proposed[otherTeamIndex])) continue;

                const nextCounts = conflictCounts(proposed, previousPairings, avoids);
                if (nextCounts.avoid !== 0 || nextCounts.previous >= counts.previous) continue;

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
  const initialTeams = teamArrays.map((teamPlayers, index) => ({
    name: labelForTeam(startIndex + index),
    players: teamPlayers
  }));
  const assignment = findBestTeamAssignment(
    players,
    initialTeams.length,
    previousPairings,
    avoids,
    initialTeams,
    startIndex,
    random
  );
  const teams = assignment.teams;
  const initialAudit = inspectTeams(teams, previousPairings, avoids);
  const repair = fixTeamConflicts(teams, previousPairings, avoids);
  const finalAudit = inspectTeams(teams, previousPairings, avoids);

  return {
    teams,
    initialAudit,
    finalAudit,
    swapsApplied: repair.swapsApplied,
    pairingSearchLimitReached: assignment.searchLimitReached && finalAudit.previousConflicts.length > 0,
    pairingSearchRestarts: assignment.searchRestarts,
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
    const existing = await roundsDatabase.collection(roundCollectionName(round)).findOne({});
    if (existing) highestPopulatedRound = round;
  }
  if (highestPopulatedRound === ROUND_COUNT) {
    throw new Error('All 16 round collections already contain approved data.');
  }
  return highestPopulatedRound + 1;
}

async function getNextTeamLabelIndex(roundsDatabase, round) {
  if (round <= 1) return 0;
  const previousRound = await roundsDatabase.collection(roundCollectionName(round - 1))
    .findOne({ _id: CURRENT_SNAPSHOT_ID });
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

async function saveReactedPlayersSnapshot({
  playersThatReactedCollection,
  reactedPlayers,
  sourceMessageId,
  now = () => new Date()
}) {
  if (!Array.isArray(reactedPlayers)) throw new TypeError('Reacted players must be an array.');
  const playersById = new Map();
  for (const player of reactedPlayers) {
    const id = String(player?.id || '').trim();
    if (/^\d{17,20}$/.test(id) && !playersById.has(id)) {
      const username = String(player.name || '').trim();
      playersById.set(id, { discordId: id, username, name: username });
    }
  }

  const players = [...playersById.values()];
  return playersThatReactedCollection.replaceOne({
    _id: CURRENT_SNAPSHOT_ID
  }, {
    _id: CURRENT_SNAPSHOT_ID,
    sourceMessageId: String(sourceMessageId || ''),
    updatedAt: now(),
    captureStatus: 'captured',
    reactedPlayerCount: players.length,
    players
  }, { upsert: true });
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
  previewChannelId = '',
  targetRound,
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
  const currentDraftClaimFilter = currentDraft ? currentDraftFilter(currentDraft) : null;
  if (currentDraft?.status === 'approving') {
    throw new Error('The current draft is being approved. Try again after approval finishes.');
  }
  if (currentDraft?.status === 'generating') {
    const updatedAt = currentDraft.updatedAt instanceof Date
      ? currentDraft.updatedAt.getTime()
      : new Date(currentDraft.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) ||
        now().getTime() - updatedAt < GENERATION_LOCK_STALE_AFTER_MS) {
      throw new Error('A team draft generation is already in progress. Please wait for it to finish.');
    }
  }
  const usesPendingDraftRound = currentDraft?.status === 'pending' && targetRound === undefined;
  const round = targetRound !== undefined
    ? targetRound
    : usesPendingDraftRound
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
  const teamLabelStartIndex = usesPendingDraftRound &&
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
      pairingSearchLimitReached: generated.pairingSearchLimitReached,
      pairingSearchRestarts: generated.pairingSearchRestarts,
      unresolvedPrevious: generated.unresolvedPrevious,
      unresolvedAvoids: generated.unresolvedAvoids
    },
    previewStatus: 'not-posted',
    previewMessageIds: [],
    previewChannelId: String(previewChannelId || ''),
    reviewActivity: [],
    activeViewers: {}
  };

  let generationClaimed = false;
  try {
    if (currentDraft) {
      const claim = await teamCheckCollection.replaceOne(currentDraftClaimFilter, draft);
      if (!claim.matchedCount) {
        throw new Error('The Team Check draft changed while teams were being generated. Try again.');
      }
    } else {
      try {
        await teamCheckCollection.insertOne(draft);
      } catch (error) {
        if (error.code === 11000) {
          throw new Error('A Team Check draft was created by another request. Try again.');
        }
        throw error;
      }
    }
    generationClaimed = true;

    await playersThatReactedCollection.replaceOne({
      _id: CURRENT_SNAPSHOT_ID
    }, {
      _id: CURRENT_SNAPSHOT_ID,
      round,
      sourceMessageId: draft.sourceMessageId,
      updatedAt: timestamp,
      captureStatus: 'processed',
      players: allPlayers
    }, { upsert: true });
    const updated = await teamCheckCollection.updateOne({
      _id: CURRENT_SNAPSHOT_ID,
      generationId,
      status: 'generating'
    }, {
      $set: { status: 'pending', updatedAt: now() }
    });
    if (!updated.matchedCount) {
      throw new Error('The Team Check draft changed while its player snapshot was being saved.');
    }
  } catch (error) {
    if (generationClaimed) {
      try {
        const failed = await teamCheckCollection.updateOne({
          _id: CURRENT_SNAPSHOT_ID,
          generationId,
          status: 'generating'
        }, {
          $set: { status: 'failed', updatedAt: now() }
        });
        if (!failed.matchedCount) {
          throw new Error('The current draft no longer matches this failed generation.');
        }
      } catch (statusError) {
        throw new Error(
          `Team draft saving failed: ${error.message}; its failure status could not be recorded: ${statusError.message}`
        );
      }
    }
    throw error;
  }

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

async function updateCurrentDraftReviewer({
  teamCheckCollection,
  generationId,
  reviewer,
  vote,
  now = () => new Date()
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
    if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
      const error = new Error('The pending Team Check draft changed. Reload it and try again.');
      error.statusCode = 409;
      throw error;
    }

    const activity = Array.isArray(draft.reviewActivity) ? draft.reviewActivity : [];
    const timestamp = now();
    const existing = activity.find((entry) => entry.discordId === reviewer.discordId);
    const updatedReviewer = {
      ...(existing || {}),
      ...reviewer,
      lastOpenedAt: timestamp,
      ...(vote === undefined ? {} : { vote, reviewedAt: timestamp })
    };
    const updatedActivity = existing
      ? activity.map((entry) => entry.discordId === reviewer.discordId ? updatedReviewer : entry)
      : [...activity, { ...updatedReviewer, vote: vote === undefined ? null : vote }];
    const result = await teamCheckCollection.updateOne({
      _id: CURRENT_SNAPSHOT_ID,
      generationId,
      status: 'pending',
      updatedAt: draft.updatedAt
    }, {
      $set: { reviewActivity: updatedActivity, updatedAt: timestamp }
    });
    if (result.matchedCount) {
      return { ...draft, reviewActivity: updatedActivity, updatedAt: timestamp };
    }
  }

  const error = new Error('The Team Check draft is being updated. Reload it and try again.');
  error.statusCode = 409;
  throw error;
}

async function recordCurrentDraftViewer(options) {
  return updateCurrentDraftReviewer(options);
}

async function updateCurrentDraftViewerPresence({
  teamCheckCollection,
  generationId,
  viewer,
  viewing,
  now = () => new Date(),
  staleAfterMs = 45_000
}) {
  const discordId = String(viewer?.discordId || '');
  if (!/^\d{17,20}$/.test(discordId) || typeof viewing !== 'boolean') {
    const error = new Error('A valid viewer and presence state are required.');
    error.statusCode = 400;
    throw error;
  }
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }

  const timestamp = now();
  const activeViewers = draft.activeViewers && typeof draft.activeViewers === 'object'
    ? draft.activeViewers
    : {};
  const unset = {};
  for (const [activeDiscordId, presence] of Object.entries(activeViewers)) {
    const lastSeenAt = new Date(presence?.lastSeenAt || 0).getTime();
    if (activeDiscordId !== discordId && (!Number.isFinite(lastSeenAt) ||
        timestamp.getTime() - lastSeenAt > staleAfterMs)) {
      unset[`activeViewers.${activeDiscordId}`] = '';
    }
  }

  const update = {};
  if (viewing) {
    update.$set = {
      [`activeViewers.${discordId}`]: {
        discordId,
        username: String(viewer.username || '').slice(0, 64),
        discordUsername: String(viewer.discordUsername || '').slice(0, 64),
        avatarUrl: String(viewer.avatarUrl || '').slice(0, 512),
        lastSeenAt: timestamp
      }
    };
  } else {
    unset[`activeViewers.${discordId}`] = '';
  }
  if (Object.keys(unset).length) update.$unset = unset;
  if (!Object.keys(update).length) return draft;

  const result = await teamCheckCollection.updateOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    status: 'pending'
  }, update);
  if (!result.matchedCount) {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  const updatedDraft = await teamCheckCollection.findOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    status: 'pending'
  });
  if (!updatedDraft) {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  return updatedDraft;
}

async function recordCurrentDraftReview(options) {
  if (!['approve', 'changes'].includes(options.vote)) {
    throw new TypeError('A valid Team Check review mark is required.');
  }
  return updateCurrentDraftReviewer(options);
}

async function saveCurrentDraftTeamChange({
  teamCheckCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  draft,
  teams,
  now,
  regionError
}) {
  const [avoids, previousPairings] = await Promise.all([
    loadPairingKeys(avoidsCollection, 'avoids'),
    loadPairingKeys(previousPairingsCollection, 'previousPairings')
  ]);
  const finalAudit = inspectTeams(teams, previousPairings, avoids);
  if (finalAudit.regionErrors.length) {
    const error = new Error(regionError);
    error.statusCode = 422;
    throw error;
  }

  const timestamp = now();
  const reviewActivity = (Array.isArray(draft.reviewActivity) ? draft.reviewActivity : [])
    .map((entry) => ({ ...entry, vote: null, reviewedAt: null }));
  const checks = {
    ...draft.checks,
    final: finalAudit,
    unresolvedAvoids: finalAudit.avoidConflicts.length,
    unresolvedPrevious: finalAudit.previousConflicts.length,
    manualAdjustments: (draft.checks?.manualAdjustments || 0) + 1
  };
  const updated = await teamCheckCollection.updateOne({
    _id: CURRENT_SNAPSHOT_ID,
    generationId,
    status: 'pending',
    updatedAt: draft.updatedAt
  }, {
    $set: { teams, checks, reviewActivity, updatedAt: timestamp }
  });
  if (!updated.matchedCount) {
    const error = new Error('The Team Check draft changed while saving. Reload the draft and try again.');
    error.statusCode = 409;
    throw error;
  }

  return { ...draft, teams, checks, reviewActivity, updatedAt: timestamp };
}

async function swapCurrentDraftPlayers({
  teamCheckCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  playerDiscordId,
  sourceTeamName,
  sourceSlotIndex,
  sourceDiscordId,
  targetTeamName,
  targetSlotIndex,
  targetDiscordId,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.some((team) =>
    !Array.isArray(team.players) || team.players.length !== TEAM_SIZE)) {
    const error = new Error('This draft does not have the expected three-player team structure.');
    error.statusCode = 409;
    throw error;
  }

  const teams = draft.teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player }))
  }));
  let source;
  if (sourceTeamName !== undefined || sourceSlotIndex !== undefined ||
      sourceDiscordId !== undefined) {
    const sourceTeamIndex = teams.findIndex((team) => team.name === sourceTeamName);
    if (!Number.isInteger(sourceSlotIndex) || sourceSlotIndex < 0 ||
        sourceSlotIndex >= TEAM_SIZE || sourceTeamIndex < 0) {
      const error = new Error('Choose a valid source team slot.');
      error.statusCode = 400;
      throw error;
    }
    const sourcePlayer = teams[sourceTeamIndex].players[sourceSlotIndex];
    if (String(sourcePlayer.discordId || '') !== (sourceDiscordId || '') ||
        (playerDiscordId && sourcePlayer.discordId !== playerDiscordId)) {
      const error = new Error('The selected source slot changed. Reload the draft and try again.');
      error.statusCode = 409;
      throw error;
    }
    if (!sourcePlayer.discordId && sourcePlayer.region !== 'Filler') {
      const error = new Error('Only a filler slot can be moved without a player.');
      error.statusCode = 400;
      throw error;
    }
    source = { teamIndex: sourceTeamIndex, slotIndex: sourceSlotIndex };
  } else {
    const sourceMatches = [];
    teams.forEach((team, teamIndex) => {
      team.players.forEach((player, slotIndex) => {
        if (String(player.discordId || '') === playerDiscordId) {
          sourceMatches.push({ teamIndex, slotIndex });
        }
      });
    });
    if (sourceMatches.length !== 1) {
      const error = new Error('The selected player is not in exactly one team in this draft.');
      error.statusCode = 409;
      throw error;
    }
    source = sourceMatches[0];
  }

  const targetTeamIndex = teams.findIndex((team) => team.name === targetTeamName);
  if (!Number.isInteger(targetSlotIndex) || targetSlotIndex < 0 ||
      targetSlotIndex >= TEAM_SIZE || targetTeamIndex < 0 ||
      targetTeamIndex === source.teamIndex) {
    const error = new Error('Choose a different team and a valid player slot.');
    error.statusCode = 400;
    throw error;
  }
  const target = teams[targetTeamIndex].players[targetSlotIndex];
  if (targetDiscordId
      ? String(target.discordId || '') !== targetDiscordId
      : target.region !== 'Filler' || target.discordId) {
    const error = new Error('The selected destination slot changed. Reload the draft and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (teams[source.teamIndex].players[source.slotIndex].region === 'Filler' &&
      (!target.discordId || target.region === 'Filler')) {
    const error = new Error('Move a filler slot onto an assigned player to move that player.');
    error.statusCode = 400;
    throw error;
  }

  [teams[source.teamIndex].players[source.slotIndex], teams[targetTeamIndex].players[targetSlotIndex]] =
    [teams[targetTeamIndex].players[targetSlotIndex], teams[source.teamIndex].players[source.slotIndex]];

  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'That swap would mix East and West players on a team.'
  });
}

async function addCurrentDraftFillerTeam({
  teamCheckCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.some((team) =>
    !Array.isArray(team.players) || team.players.length !== TEAM_SIZE)) {
    const error = new Error('This draft does not have the expected three-player team structure.');
    error.statusCode = 409;
    throw error;
  }

  const teams = draft.teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player }))
  }));
  const teamNames = new Set(teams.map((team) => team.name));
  const lastTeam = teams[teams.length - 1];
  const nextLabelIndex = lastTeam ? labelIndex(lastTeam.name) + 1 : 0;
  let teamName = '';
  for (let offset = 0; offset < 78; offset += 1) {
    const candidate = labelForTeam(nextLabelIndex + offset);
    if (!teamNames.has(candidate)) {
      teamName = candidate;
      break;
    }
  }
  if (!teamName) {
    const error = new Error('No unused team label is available for this draft.');
    error.statusCode = 409;
    throw error;
  }

  const usedFillerNumbers = getUsedFillerNumbers(teams);
  teams.push({
    name: teamName,
    players: Array.from({ length: TEAM_SIZE }, () => nextFillerPlayer(usedFillerNumbers))
  });

  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'Adding a filler team cannot create a region conflict.'
  });
}

async function deleteCurrentDraftFillerTeam({
  teamCheckCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  teamName,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.length <= 1) {
    const error = new Error('The last team cannot be deleted from a draft.');
    error.statusCode = 409;
    throw error;
  }
  const teamIndex = draft.teams.findIndex((team) => team.name === teamName);
  if (teamIndex < 0) {
    const error = new Error('The selected team no longer exists in this draft.');
    error.statusCode = 404;
    throw error;
  }
  const team = draft.teams[teamIndex];
  if (!Array.isArray(team.players) || team.players.length !== TEAM_SIZE ||
      team.players.some((player) => player.region !== 'Filler' || player.discordId)) {
    const error = new Error('Only a team with three empty filler slots can be deleted.');
    error.statusCode = 422;
    throw error;
  }

  const teams = draft.teams
    .filter((_, index) => index !== teamIndex)
    .map((entry) => ({
      ...entry,
      players: entry.players.map((player) => ({ ...player }))
    }));
  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'Deleting a filler team cannot create a region conflict.'
  });
}

async function replaceCurrentDraftPlayer({
  teamCheckCollection,
  membersCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  playerDiscordId,
  replacementDiscordId,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.some((team) =>
    !Array.isArray(team.players) || team.players.length !== TEAM_SIZE)) {
    const error = new Error('This draft does not have the expected three-player team structure.');
    error.statusCode = 409;
    throw error;
  }
  if (!/^\d{17,20}$/.test(playerDiscordId || '') ||
      !/^\d{17,20}$/.test(replacementDiscordId || '')) {
    const error = new Error('Choose a valid player and replacement member.');
    error.statusCode = 400;
    throw error;
  }

  const teams = draft.teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player }))
  }));
  const sourceMatches = [];
  const assignedDiscordIds = new Set();
  teams.forEach((team, teamIndex) => {
    team.players.forEach((player, slotIndex) => {
      const discordId = String(player.discordId || '');
      if (discordId) assignedDiscordIds.add(discordId);
      if (discordId === playerDiscordId) sourceMatches.push({ teamIndex, slotIndex });
    });
  });
  if (sourceMatches.length !== 1) {
    const error = new Error('The selected player is not in exactly one team in this draft.');
    error.statusCode = 409;
    throw error;
  }
  if (assignedDiscordIds.has(replacementDiscordId)) {
    const error = new Error('The replacement member is already assigned to this draft.');
    error.statusCode = 409;
    throw error;
  }

  const profile = await membersCollection?.findOne({ _id: replacementDiscordId }) ||
    await membersCollection?.findOne({ discordId: replacementDiscordId });
  if (!profile || String(profile.discordId || profile._id || '') !== replacementDiscordId) {
    const error = new Error('The replacement member is no longer in the Members list.');
    error.statusCode = 404;
    throw error;
  }
  const region = typeof profile.region === 'string' ? profile.region.trim() : '';
  if (!VALID_REGIONS.has(region)) {
    const error = new Error('The replacement member needs a valid East, West, or Both region.');
    error.statusCode = 422;
    throw error;
  }

  const source = sourceMatches[0];
  const team = teams[source.teamIndex];
  const teammates = team.players.filter((_, slotIndex) => slotIndex !== source.slotIndex);
  if (teammates.some((teammate) => !regionSwapAllowed(
    { region },
    teammate
  ))) {
    const error = new Error('That replacement would mix East and West players on a team.');
    error.statusCode = 422;
    throw error;
  }
  const username = String(profile.username || '').trim();
  team.players[source.slotIndex] = {
    id: replacementDiscordId,
    discordId: replacementDiscordId,
    username,
    name: String(profile.nickname || username || replacementDiscordId).trim(),
    region,
    steamId: profile.steamId || null,
    streamLink: profile.streamLink || null
  };

  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'That replacement would mix East and West players on a team.'
  });
}

async function replaceCurrentDraftPlayerWithFiller({
  teamCheckCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  playerDiscordId,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.some((team) =>
    !Array.isArray(team.players) || team.players.length !== TEAM_SIZE)) {
    const error = new Error('This draft does not have the expected three-player team structure.');
    error.statusCode = 409;
    throw error;
  }
  if (!/^\d{17,20}$/.test(playerDiscordId || '')) {
    const error = new Error('Choose a valid player to replace with a filler.');
    error.statusCode = 400;
    throw error;
  }

  const teams = draft.teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player }))
  }));
  const sourceMatches = [];
  teams.forEach((team, teamIndex) => {
    team.players.forEach((player, slotIndex) => {
      if (String(player.discordId || '') === playerDiscordId) {
        sourceMatches.push({ teamIndex, slotIndex });
      }
    });
  });
  if (sourceMatches.length !== 1) {
    const error = new Error('The selected player is not in exactly one team in this draft.');
    error.statusCode = 409;
    throw error;
  }

  const source = sourceMatches[0];
  const filler = nextFillerPlayer(getUsedFillerNumbers(teams));
  teams[source.teamIndex].players[source.slotIndex] = filler;
  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'Replacing a player with a filler cannot create a region conflict.'
  });
}

async function addCurrentDraftMemberToFillerSlot({
  teamCheckCollection,
  membersCollection,
  avoidsCollection,
  previousPairingsCollection,
  generationId,
  targetTeamName,
  targetSlotIndex,
  replacementDiscordId,
  now = () => new Date()
}) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.generationId !== generationId || draft.status !== 'pending') {
    const error = new Error('The pending Team Check draft changed. Reload it and try again.');
    error.statusCode = 409;
    throw error;
  }
  if (!Array.isArray(draft.teams) || draft.teams.some((team) =>
    !Array.isArray(team.players) || team.players.length !== TEAM_SIZE)) {
    const error = new Error('This draft does not have the expected three-player team structure.');
    error.statusCode = 409;
    throw error;
  }
  if (typeof targetTeamName !== 'string' || !Number.isInteger(targetSlotIndex) ||
      targetSlotIndex < 0 || targetSlotIndex >= TEAM_SIZE ||
      !/^\d{17,20}$/.test(replacementDiscordId || '')) {
    const error = new Error('Choose a valid filler slot and replacement member.');
    error.statusCode = 400;
    throw error;
  }

  const teams = draft.teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player }))
  }));
  const teamIndex = teams.findIndex((team) => team.name === targetTeamName);
  const target = teams[teamIndex]?.players[targetSlotIndex];
  if (!target || target.region !== 'Filler' || target.discordId) {
    const error = new Error('The selected slot is no longer an empty filler slot.');
    error.statusCode = 409;
    throw error;
  }
  if (teams.some((team) => team.players.some((player) =>
    player.discordId === replacementDiscordId))) {
    const error = new Error('The replacement member is already assigned to this draft.');
    error.statusCode = 409;
    throw error;
  }

  const profile = await membersCollection?.findOne({ _id: replacementDiscordId }) ||
    await membersCollection?.findOne({ discordId: replacementDiscordId });
  if (!profile || String(profile.discordId || profile._id || '') !== replacementDiscordId) {
    const error = new Error('The replacement member is no longer in the Members list.');
    error.statusCode = 404;
    throw error;
  }
  const region = typeof profile.region === 'string' ? profile.region.trim() : '';
  if (!VALID_REGIONS.has(region)) {
    const error = new Error('The replacement member needs a valid East, West, or Both region.');
    error.statusCode = 422;
    throw error;
  }
  const teammates = teams[teamIndex].players.filter((_, index) => index !== targetSlotIndex);
  if (teammates.some((teammate) => !regionSwapAllowed({ region }, teammate))) {
    const error = new Error('That replacement would mix East and West players on a team.');
    error.statusCode = 422;
    throw error;
  }

  const username = String(profile.username || '').trim();
  teams[teamIndex].players[targetSlotIndex] = {
    id: replacementDiscordId,
    discordId: replacementDiscordId,
    username,
    name: String(profile.nickname || username || replacementDiscordId).trim(),
    region,
    steamId: profile.steamId || null,
    streamLink: profile.streamLink || null
  };
  return saveCurrentDraftTeamChange({
    teamCheckCollection,
    avoidsCollection,
    previousPairingsCollection,
    generationId,
    draft,
    teams,
    now,
    regionError: 'That replacement would mix East and West players on a team.'
  });
}

async function beginCurrentDraftApproval({ teamCheckCollection, roundsDatabase, round, now = () => new Date() }) {
  const draft = await teamCheckCollection.findOne({ _id: CURRENT_SNAPSHOT_ID });
  if (!draft || draft.round !== round || !['pending', 'approving', 'approved'].includes(draft.status)) {
    throw new Error(`No pending Team Check draft exists for Round #${round}.`);
  }

  const roundCollection = roundsDatabase.collection(roundCollectionName(round));
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
    $set: {
      status: 'approved',
      approvedAt,
      updatedAt: approvedAt,
      reviewActivity: [],
      activeViewers: {}
    }
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
  addCurrentDraftFillerTeam,
  addCurrentDraftMemberToFillerSlot,
  beginCurrentDraftApproval,
  completeCurrentDraftApproval,
  createCurrentTeamDraft,
  deleteCurrentDraftFillerTeam,
  findNextRound,
  formatTeamCheckPreview,
  generateTeamGroups,
  inspectTeams,
  labelForTeam,
  loadPairingKeys,
  recordCurrentDraftReview,
  recordCurrentDraftViewer,
  recordPreviousPairings,
  replaceCurrentDraftPlayer,
  replaceCurrentDraftPlayerWithFiller,
  saveReactedPlayersSnapshot,
  splitDiscordMessage,
  swapCurrentDraftPlayers,
  updateCurrentDraftViewerPresence
};
