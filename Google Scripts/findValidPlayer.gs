function findValidPlayer(role, regionBuckets, usedPlayers, currentTeam, previousPairings) {
  const pool = getRolePool(role, regionBuckets);
  for (const player of pool) {
    if (usedPlayers.has(player.username)) continue;
    if (hasDuplicatePairing(player, currentTeam, previousPairings)) continue;
    return player;
  }
  return null; // No valid player found
}