function fallbackTeamAssignment(clonedBuckets, format, logSheet, teams, startingFillerCount = 0, previousPairings = new Set()) {
  let fillerCount = startingFillerCount;

  try {
    if (!teams || !Array.isArray(teams) || teams.length === 0) {
      safeLog(logSheet, "Fallback called but no teams provided. Exiting fallback.");
      return fillerCount;
    }

    safeLog(logSheet, `Running fallback assignment for ${teams.length} team(s).`);

    for (const [teamIndex, team] of teams.entries()) {
      safeLog(logSheet, `Processing fallback for team #${teamIndex + 1}`);

      for (let i = 0; i < (format ? format.length : 3); i++) {
        const role = format[i] || "Both";

        if (team[i]) continue;

        let player;
        if (role !== "Filler" && clonedBuckets[role] && clonedBuckets[role].length > 0) {
          player = clonedBuckets[role].shift();
          player.fallbackAssigned = true; // ✅ mark for swap checking
          team.push(player);
          safeLog(logSheet, `Fallback assigned ${player.username} to role ${role} in team #${teamIndex + 1}`);
        } else {
          fillerCount++;
          const fillerPlayer = { username: `Filler #${fillerCount}`, region: "Filler", fallbackAssigned: true };
          team.push(fillerPlayer);
          safeLog(logSheet, `Fallback assigned ${fillerPlayer.username} to team #${teamIndex + 1}`);
        }

        // Immediately attempt to fix duplicates after each assignment
        fixDuplicatesBySwapping(teams, previousPairings, logSheet);
      }

      // Ensure team length matches format
      while (team.length < (format ? format.length : 3)) {
        fillerCount++;
        const fillerPlayer = { username: `Filler #${fillerCount}`, region: "Filler", fallbackAssigned: true };
        team.push(fillerPlayer);
        safeLog(logSheet, `Fallback assigned ${fillerPlayer.username} to fill remaining spot in team #${teamIndex + 1}`);
      }

      safeLog(logSheet, `Team #${teamIndex + 1} after fallback: ${team.map(p => p.username).join(", ")}`);
    }

  } catch (error) {
    safeLog(logSheet, `Error in fallbackTeamAssignment: ${error.message}`);
    console.error(error);
  }

  return fillerCount;
}
