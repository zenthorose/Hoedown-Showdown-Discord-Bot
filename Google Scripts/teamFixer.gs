/**
 * teamFixer
 * Version: 3.0.0 (Avoids always prioritized, undefined-safe logging)
 */
function teamFixer(teams, previousSheet, avoidSheet, safeLog, startingAudit = null, LOG_ENABLED = false) {
  const SCRIPT_VERSION = "teamFixer v3.0.0";
  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log(`Starting teamFixer with ${teams.length} teams`);

  // --- Safe helper for logging player names ---
  function nameOf(player) {
    return player ? (player.name || player.id || "Unknown") : "Missing";
  }

  // --- Load previous and avoid pairings ---
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
  log(`Loaded previous pairings: ${previousPairings.size}, avoid pairings: ${avoidPairings.size}`);

  if (startingAudit) {
    log(
      `Starting audit → Duplicates: ${startingAudit.initialDuplicates.size}, Avoids: ${startingAudit.initialAvoids.size}, Region errors: ${startingAudit.regionErrors.size}`
    );
  }

  let swapsApplied = 0;
  const unresolvedConflicts = [];
  const MAX_PASSES = 1000;
  let passCount = 0;
  let anyFixThisPass;

  // --- Counting helpers ---
  function countDuplicates(teams) {
    let count = 0;
    for (const team of teams) {
      const filtered = team.filter((p) => p && p.region !== "Filler");
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          if (previousPairings.has(pairKey(filtered[i], filtered[j]))) count++;
        }
      }
    }
    return count;
  }

  function countAvoids(teams) {
    let count = 0;
    for (const team of teams) {
      const filtered = team.filter((p) => p && p.region !== "Filler");
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          if (avoidPairings.has(pairKey(filtered[i], filtered[j]))) count++;
        }
      }
    }
    return count;
  }

  let totalDuplicates = countDuplicates(teams);
  let totalAvoids = countAvoids(teams);
  log(`Initial counts → Duplicates: ${totalDuplicates}, Avoids: ${totalAvoids}`);

  // --- Main swap loop ---
  do {
    passCount++;
    anyFixThisPass = false;

    outerLoop:
    for (let t = 0; t < teams.length; t++) {
      const team = teams[t].filter((p) => p && p.region !== "Filler");
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const memberA = team[i];
          const memberB = team[j];
          const pairStr = pairKey(memberA, memberB);

          const isAvoid = avoidPairings.has(pairStr);
          const isDuplicate = previousPairings.has(pairStr);
          if (!isAvoid && !isDuplicate) continue;

          if (isAvoid) log(`🚫 Avoid conflict detected: ${nameOf(memberA)} & ${nameOf(memberB)}`);
          if (isDuplicate) log(`⚠️ Duplicate detected: ${nameOf(memberA)} & ${nameOf(memberB)}`);

          let fixed = false;

          // --- Attempt swaps (A first, then B) ---
          for (const [swapTarget, swapIndex] of [[memberA, i], [memberB, j]]) {
            if (fixed) break;

            for (let t2 = 0; t2 < teams.length && !fixed; t2++) {
              if (t2 === t) continue;
              const otherTeam = teams[t2].filter((p) => p && p.region !== "Filler");

              for (let m2 = 0; m2 < otherTeam.length; m2++) {
                if (!regionSwapAllowed(swapTarget, otherTeam[m2])) continue;

                const tempTeams = JSON.parse(JSON.stringify(teams));
                tempTeams[t][swapIndex] = tempTeams[t2][m2];
                tempTeams[t2][m2] = swapTarget;

                if (!regionTeamValid(tempTeams[t]) || !regionTeamValid(tempTeams[t2])) continue;

                const newDuplicates = countDuplicates(tempTeams);
                const newAvoids = countAvoids(tempTeams);

                // --- Strict avoid-first priority ---
                const avoidImproved = newAvoids < totalAvoids;
                const avoidSame = newAvoids === totalAvoids;
                const dupImproved = newDuplicates < totalDuplicates;

                if (avoidImproved || (avoidSame && dupImproved)) {
                  log(
                    `✅ Swap accepted: ${nameOf(swapTarget)} (T${t + 1}) ↔ ${nameOf(otherTeam[m2])} (T${t2 + 1}) | Avoids: ${totalAvoids}→${newAvoids}, Dups: ${totalDuplicates}→${newDuplicates}`
                  );

                  const tmp = teams[t][swapIndex];
                  teams[t][swapIndex] = teams[t2][m2];
                  teams[t2][m2] = tmp;

                  totalAvoids = newAvoids;
                  totalDuplicates = newDuplicates;
                  swapsApplied++;
                  anyFixThisPass = true;
                  fixed = true;
                  break outerLoop;
                }
              }
            }
          }

          if (!fixed) {
            unresolvedConflicts.push(pairStr);
            log(`❌ Unresolved conflict: ${nameOf(memberA)} & ${nameOf(memberB)}`);
          }
        }
      }
    }
  } while (anyFixThisPass && passCount < MAX_PASSES);

  const postAudit = teamCheck(teams, previousSheet, avoidSheet, safeLog);
  log(`🏁 teamFixer completed after ${passCount} passes`);
  log(`Swaps applied: ${swapsApplied}`);
  log(`Unresolved Avoids: ${unresolvedConflicts.filter((p) => avoidPairings.has(p)).length}`);
  log(`Unresolved Duplicates: ${unresolvedConflicts.filter((p) => previousPairings.has(p)).length}`);
  log(
    `Post-fixer audit → Duplicates: ${postAudit.initialDuplicates.size}, Avoids: ${postAudit.initialAvoids.size}, Region errors: ${postAudit.regionErrors.size}`
  );

  return {
    teams,
    swapsApplied,
    unresolvedPrevious: unresolvedConflicts.filter((p) => previousPairings.has(p)).length,
    unresolvedAvoid: unresolvedConflicts.filter((p) => avoidPairings.has(p)).length,
    postAudit,
  };
}
