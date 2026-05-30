function assignPlayersToPlannedTeams(teamPlan, regionBuckets, safeLog) {
  const SCRIPT_VERSION = "assignPlayersToPlannedTeams v3.0.0"; // schema unified
  const LOG_ENABLED = false;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(`[${SCRIPT_VERSION}] ${msg}`);
    }
  }

  log("Starting assignPlayersToPlannedTeams");

  try {
    const clonedBuckets = {
      East: regionBuckets.East.slice(),
      West: regionBuckets.West.slice(),
      Both: regionBuckets.Both.slice(),
    };

    const teams = [];
    let fillerCount = 0;

    for (const [index, format] of teamPlan.entries()) {
      log(`Assigning team #${index + 1} with format: ${format.join(", ")}`);
      const team = [];

      for (const role of format) {
        if (role === "Filler") {
          fillerCount++;
          const fillerPlayer = {
            id: `FILLER_${fillerCount}`,
            name: `Filler #${fillerCount}`,
            region: "Filler"
          };
          team.push(fillerPlayer);
          log(`Assigned ${fillerPlayer.name} to role Filler in team #${index + 1}`);
          continue;
        }

        const bucketName = role === "East" ? "East" : role === "West" ? "West" : "Both";
        let candidate = clonedBuckets[bucketName].shift();

        if (!candidate) {
          fillerCount++;
          candidate = {
            id: `FILLER_${fillerCount}`,
            name: `Filler #${fillerCount}`,
            region: "Filler"
          };
          log(`Bucket empty, assigned ${candidate.name} to ${role} in team #${index + 1}`);
        } else {
          log(`Assigned player ${candidate.name} (ID: ${candidate.id}) to role ${role} in team #${index + 1}`);
        }

        team.push(candidate);
      }

      teams.push(team);
    }

    log(`All teams assigned successfully`);
    return { success: true, teams, nextStep: "teamCheck" };

  } catch (error) {
    log(`Error in assignPlayersToPlannedTeams: ${error.message}`);
    return { success: false, teams: [], nextStep: "teamCheck" };
  }
}
