function groupPlayersByRegion(players, safeLog) {
  safeLog("Starting groupPlayersByRegion script");
  return {
    East: players.filter(p => p.region === 'East'),
    West: players.filter(p => p.region === 'West'),
    Both: players.filter(p => p.region === 'Both')
  };
}
