/**
 * teamCheck
 * Version: 1.3.1 (audit object ready for teamFixer)
 * Checks teams against previous and avoid pairings and logs conflicts.
 * Returns full audit including Sets for duplicates, avoids, and region errors.
 */
function teamCheck(teams, previousSheet, avoidSheet, safeLog) {
  const SCRIPT_VERSION = "teamCheck v1.3.1";
  const LOG_ENABLED = true; // toggle logging on/off

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(`[${SCRIPT_VERSION}] ${msg}`);
    }
  }

  log(`teamCheck called with ${teams.length} teams`);

  function loadPairs(sheet) {
    const values = sheet.getDataRange().getValues();
    const pairSet = new Set();
    for (let i = 1; i < values.length; i++) {
      const [a, b] = values[i];
      if (a && b) pairSet.add(pairKey(a, b));
    }
    return pairSet;
  }

  const previousPairings = loadPairs(previousSheet);
  const avoidPairings = loadPairs(avoidSheet);

  const summary = [];
  const initialDuplicates = new Set();
  const initialAvoids = new Set();
  const regionErrors = new Set();

  teams.forEach((teamArray, tIndex) => {
    const team = teamArray.filter(p => p.region !== "Filler");
    let previousCount = 0;
    let avoidCount = 0;

    // Check for East/West mix without Both
    const regions = team.map(p => p.region);
    if (regions.includes("East") && regions.includes("West") && !regions.includes("Both")) {
      regionErrors.add(tIndex);
      log(`Region ERROR: Team #${tIndex + 1} has East+West mix`);
    }

    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const pairStr = pairKey(team[i].username, team[j].username);

        if (previousPairings.has(pairStr)) {
          previousCount++;
          initialDuplicates.add(pairStr);
          log(`Team #${tIndex + 1} previous pairing conflict: ${team[i].username} & ${team[j].username}`);
        }

        if (avoidPairings.has(pairStr)) {
          avoidCount++;
          initialAvoids.add(pairStr);
          log(`Team #${tIndex + 1} avoid pairing conflict: ${team[i].username} & ${team[j].username}`);
        }
      }
    }

    summary.push({ teamIndex: tIndex, previousConflicts: previousCount, avoidConflicts: avoidCount });
  });

  log(`teamCheck completed. Summary: ${JSON.stringify(summary)}`);
  log(`Snapshot → Duplicates: ${initialDuplicates.size}, Avoids: ${initialAvoids.size}, Region errors: ${regionErrors.size}`);

  // Return audit object ready to be passed into teamFixer
  return {
    summary,
    initialDuplicates,
    initialAvoids,
    regionErrors,
    previousPairings,
    avoidPairings
  };
}
