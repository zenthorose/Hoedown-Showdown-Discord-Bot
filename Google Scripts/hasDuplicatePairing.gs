function hasDuplicatePairing(player, currentTeam, previousPairings) {
  return currentTeam.some(p => previousPairings.has(pairKey(p.username, player.username)));
}