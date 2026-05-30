/**
 * teamCheck
 * Version: 3.0.0 (ID-based, fully normalized)
 */
function teamCheck(teams, previousSheet, avoidSheet, safeLog) {
  const SCRIPT_VERSION = "teamCheck v3.0.0";
  const LOG_ENABLED = false;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(`[${SCRIPT_VERSION}] ${msg}`);
    }
  }

  log(`teamCheck called with ${teams.length} teams`);

  // --- Load pairs from a sheet ---
  function loadPairs(sheet) {
    const values = sheet.getDataRange().getValues();
    const set = new Set();
    for (let i = 1; i < values.length; i++) {
      const [a, b] = values[i];
      if (a && b) set.add(pairKey({ id: a }, { id: b }));
    }
    return set;
  }

  const previousPairings = loadPairs(previousSheet);
  const avoidPairings = loadPairs(avoidSheet);

  const summary = [];
  const initialDuplicates = new Set();
  const initialAvoids = new Set();
  const regionErrors = new Set();

  teams.forEach((teamArray, tIndex) => {
    log(`--- Checking Team #${tIndex + 1} ---`);
    teamArray.forEach((p, idx) => {
      log(`Slot ${idx}: id=${p?.id}, name=${p?.name}, region=${p?.region}`);
    });

    const team = teamArray.filter(p => p.region !== "Filler");
    let previousCount = 0;
    let avoidCount = 0;

    const regions = team.map(p => p.region);
    if (regions.includes("East") && regions.includes("West") && !regions.includes("Both")) {
      regionErrors.add(tIndex);
      log(`Region ERROR: Team #${tIndex + 1} has East+West mix`);
    }

    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const pairStr = pairKey(team[i], team[j]); // <-- pass full objects
        log(`Comparing pair: ${team[i].name} (${team[i].id}) ↔ ${team[j].name} (${team[j].id}) → key=${pairStr}`);

        if (previousPairings.has(pairStr)) {
          previousCount++;
          initialDuplicates.add(pairStr);
          log(`Team #${tIndex + 1} previous pairing conflict: ${team[i].name} & ${team[j].name}`);
        }

        if (avoidPairings.has(pairStr)) {
          avoidCount++;
          initialAvoids.add(pairStr);
          log(`Team #${tIndex + 1} avoid pairing conflict: ${team[i].name} & ${team[j].name}`);
        }
      }
    }

    summary.push({ teamIndex: tIndex, previousConflicts: previousCount, avoidConflicts: avoidCount });
  });

  log(`teamCheck completed. Summary: ${JSON.stringify(summary)}`);
  log(`Snapshot → Duplicates: ${initialDuplicates.size}, Avoids: ${initialAvoids.size}, Region errors: ${regionErrors.size}`);

  return {
    summary,
    initialDuplicates,
    initialAvoids,
    regionErrors,
    previousPairings,
    avoidPairings
  };
}
