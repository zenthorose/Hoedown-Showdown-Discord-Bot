function generateTeams(players, previousPairings, logSheet) {
  logSheet.appendRow([`Starting team generation...`, new Date()]);

  // Step 1: Group players by region
  const regionBuckets = groupPlayersByRegion(players);
  logSheet.appendRow([`Players grouped by region:`, JSON.stringify(regionBuckets)]);

  // Step 2: Plan team formats based on player counts in regions
  const teamPlan = planTeamFormats(regionBuckets);
  logSheet.appendRow([`Planned team formats:`, JSON.stringify(teamPlan)]);

  // Step 3: Assign players to teams based on the planned team formats
  const result = assignPlayersToPlannedTeams(teamPlan, regionBuckets, previousPairings);

  if (result.success) {
    logSheet.appendRow([`Teams successfully generated!`, new Date()]);
    return result.teams; // If teams were generated without duplicates
  } else {
    logSheet.appendRow([`Failed to create teams without duplicates.`, new Date()]);

    // Fallback logic if we couldn't generate valid teams
    logSheet.appendRow([`Attempting fallback team assignment with fillers...`, new Date()]);
    return fallbackTeamAssignment(regionBuckets); // Use fillers if necessary
  }
}
