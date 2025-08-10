function assignPlayersToPlannedTeams(teamPlan, regionBuckets, previousPairings) {
  const usedPlayers = new Set();
  const teams = [];

  // Step 1: Flatten all region buckets into one map by username
  const allPlayers = [...regionBuckets.East, ...regionBuckets.West, ...regionBuckets.Both];

  // Step 2: Build duplicate count for each player
  const duplicateCountMap = {};
  for (const player of allPlayers) {
    let count = 0;
    for (const other of allPlayers) {
      if (player.username !== other.username) {
        const key = pairKey(player.username, other.username);
        if (previousPairings.has(key)) {
          count++;
        }
      }
    }
    duplicateCountMap[player.username] = count;
  }

  // Step 3: Sort players in each region bucket by duplicate count (descending)
  for (const region of ['East', 'West', 'Both']) {
    regionBuckets[region].sort((a, b) => duplicateCountMap[b.username] - duplicateCountMap[a.username]);
  }

  // Step 4: Assign teams using prioritized players
  for (const format of teamPlan) {
    const team = [];

    for (const role of format) {
      const candidate = findValidPlayer(role, regionBuckets, usedPlayers, team, previousPairings);
      if (!candidate) return { success: false }; // Cannot fill this team format
      team.push(candidate);
      usedPlayers.add(candidate.username);
    }

    teams.push(team);
  }

  return { success: true, teams };
}
