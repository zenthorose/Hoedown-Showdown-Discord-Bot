/**
 * generateTeams
 * Version: 1.2.0 (with log toggle)
 * Fully self-contained, safe logging
 */
function generateTeams(players, safeLog) {
  const SCRIPT_VERSION = "generateTeams v1.2.0";
  const LOG_ENABLED = false; // <-- set to false to disable logs

  // Wrapper around safeLog that respects toggle
  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(msg);
    }
  }

  log("Starting generateTeams script");
  const regionBuckets = groupPlayersByRegion(players, log); // pass log down
  log(`Players grouped by region: ${JSON.stringify(regionBuckets)}`);

  for (const region of ['East','West','Both']) {
    shuffleArray(regionBuckets[region]);
    log(`Shuffled ${region} players: ${regionBuckets[region].map(p => p.username).join(', ')}`);
  }

  const lowerCaseBuckets = {
    east: regionBuckets.East || [],
    west: regionBuckets.West || [],
    both: regionBuckets.Both || [],
  };

  let teamPlan;
  try {
    teamPlan = planTeamFormats(lowerCaseBuckets, log);
    log(`Planned team formats: ${JSON.stringify(teamPlan)}`);
  } catch (e) {
    log(`Error in planTeamFormats: ${e.message}`);
    throw e;
  }

  let result;
  try {
    result = assignPlayersToPlannedTeams(teamPlan, regionBuckets, log);
  } catch (e) {
    log(`Error in assignPlayersToPlannedTeams: ${e.message}`);
    throw e;
  }

  if (result && result.success) {
    log("Teams successfully generated!");
    return result.teams;
  } else {
    log("Failed to create teams without duplicates. Using fallback assignment.");
    return fallbackTeamAssignment(regionBuckets);
  }
}
