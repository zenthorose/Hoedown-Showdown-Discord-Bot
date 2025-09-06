/**
 * teamFixer
 * Version: 2.7.0
 * Resolves avoid pairings strictly, then minimizes duplicates iteratively.
 * Accepts a starting audit from teamCheck and logs it.
 * Swaps can temporarily create duplicates if it reduces overall duplicate count.
 * Enforces strict region rules (East and West never on same team).
 */
function teamFixer(teams, previousSheet, avoidSheet, safeLog, startingAudit = null, LOG_ENABLED = true) {
  const SCRIPT_VERSION = "teamFixer v2.7.0";
  function log(msg) { if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`); }

  log(`Starting teamFixer with ${teams.length} teams`);

  function loadPairs(sheet) {
    const values = sheet.getDataRange().getValues();
    const set = new Set();
    for (let i = 1; i < values.length; i++) {
      const [a, b] = values[i];
      if (a && b) set.add(pairKey(a, b));
    }
    return set;
  }

  const previousPairings = loadPairs(previousSheet);
  const avoidPairings = loadPairs(avoidSheet);

  if (startingAudit) {
    log(`Starting audit → Duplicates: ${startingAudit.initialDuplicates.size}, Avoids: ${startingAudit.initialAvoids.size}, Region errors: ${startingAudit.regionErrors.size}`);
  }

  let swapsApplied = 0;
  const unresolvedConflicts = [];
  const MAX_PASSES = 30;
  let passCount = 0;
  let anyFixThisPass;

  function countDuplicates(teams) {
    let count = 0;
    for (const team of teams) {
      const filtered = team.filter(p => p.region !== "Filler");
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          if (previousPairings.has(pairKey(filtered[i].username, filtered[j].username))) count++;
        }
      }
    }
    return count;
  }

  let totalDuplicates = countDuplicates(teams);

  // --- Main pass loop ---
  do {
    passCount++;
    anyFixThisPass = false;

    outerLoop:
    for (let t = 0; t < teams.length; t++) {
      const team = teams[t].filter(p => p.region !== "Filler");
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const memberA = team[i];
          const memberB = team[j];
          const pairStr = pairKey(memberA.username, memberB.username);

          const isAvoid = avoidPairings.has(pairStr);
          const isDuplicate = previousPairings.has(pairStr);
          if (!isAvoid && !isDuplicate) continue;

          let fixed = false;

          // --- Swap memberA first ---
          for (let t2 = 0; t2 < teams.length && !fixed; t2++) {
            if (t2 === t) continue;
            const otherTeam = teams[t2].filter(p => p.region !== "Filler");
            for (let m2 = 0; m2 < otherTeam.length; m2++) {
              if (!regionSwapAllowed(memberA, otherTeam[m2])) continue;

              const tempTeams = JSON.parse(JSON.stringify(teams));
              tempTeams[t][i] = tempTeams[t2][m2];
              tempTeams[t2][m2] = memberA;

              // --- Reject swaps that create East/West mix ---
              if (!regionTeamValid(tempTeams[t]) || !regionTeamValid(tempTeams[t2])) continue;

              const newDuplicates = countDuplicates(tempTeams);

              if (!hasAvoidConflict(tempTeams[t], avoidPairings) && !hasAvoidConflict(tempTeams[t2], avoidPairings) && newDuplicates < totalDuplicates) {
                const tmp = teams[t][i];
                teams[t][i] = teams[t2][m2];
                teams[t2][m2] = tmp;
                totalDuplicates = newDuplicates;
                swapsApplied++;
                anyFixThisPass = true;
                fixed = true;
                log(`Swapped ${memberA.username} (Team ${t+1}) with ${otherTeam[m2].username} (Team ${t2+1}), duplicates now ${totalDuplicates}`);
                break outerLoop;
              }
            }
          }

          // --- Swap memberB if not fixed ---
          if (!fixed) {
            for (let t2 = 0; t2 < teams.length && !fixed; t2++) {
              if (t2 === t) continue;
              const otherTeam = teams[t2].filter(p => p.region !== "Filler");
              for (let m2 = 0; m2 < otherTeam.length; m2++) {
                if (!regionSwapAllowed(memberB, otherTeam[m2])) continue;

                const tempTeams = JSON.parse(JSON.stringify(teams));
                tempTeams[t][j] = tempTeams[t2][m2];
                tempTeams[t2][m2] = memberB;

                if (!regionTeamValid(tempTeams[t]) || !regionTeamValid(tempTeams[t2])) continue;

                const newDuplicates = countDuplicates(tempTeams);

                if (!hasAvoidConflict(tempTeams[t], avoidPairings) && !hasAvoidConflict(tempTeams[t2], avoidPairings) && newDuplicates < totalDuplicates) {
                  const tmp = teams[t][j];
                  teams[t][j] = teams[t2][m2];
                  teams[t2][m2] = tmp;
                  totalDuplicates = newDuplicates;
                  swapsApplied++;
                  anyFixThisPass = true;
                  fixed = true;
                  log(`Swapped ${memberB.username} (Team ${t+1}) with ${otherTeam[m2].username} (Team ${t2+1}), duplicates now ${totalDuplicates}`);
                  break outerLoop;
                }
              }
            }
          }

          if (!fixed) unresolvedConflicts.push(pairStr);
        }
      }
    }
  } while (anyFixThisPass && passCount < MAX_PASSES);

  const postAudit = teamCheck(teams, previousSheet, avoidSheet, safeLog);
  log(`teamFixer completed. Swaps applied: ${swapsApplied}, unresolved previous pairings: ${unresolvedConflicts.filter(p => previousPairings.has(p)).length}, unresolved avoid pairings: ${unresolvedConflicts.filter(p => avoidPairings.has(p)).length}`);
  log(`Post-fixer audit → Duplicates: ${postAudit.initialDuplicates.size}, Avoids: ${postAudit.initialAvoids.size}, Region errors: ${postAudit.regionErrors.size}`);

  return {
    teams,
    swapsApplied,
    unresolvedPrevious: unresolvedConflicts.filter(p => previousPairings.has(p)).length,
    unresolvedAvoid: unresolvedConflicts.filter(p => avoidPairings.has(p)).length,
    postAudit
  };
}