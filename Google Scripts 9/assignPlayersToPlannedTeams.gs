function assignPlayersToPlannedTeams(teamPlan, regionBuckets, safeLog) {
  const SCRIPT_VERSION = "assignPlayersToPlannedTeams v1.2.0";
  const LOG_ENABLED = false; // <-- toggle logging on/off

  // Wrapper around safeLog that respects toggle
  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(msg);
    }
  }

  log("Starting assignPlayersToPlannedTeams script");
  log("Starting simplified assignPlayersToPlannedTeams");

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
          const fillerPlayer = { username: `Filler #${fillerCount}`, region: "Filler" };
          team.push(fillerPlayer);
          log(`Assigned ${fillerPlayer.username} to role Filler in team #${index + 1}`);
          continue;
        }

        const bucketName = role === "East" ? "East" : role === "West" ? "West" : "Both";
        let candidate = clonedBuckets[bucketName].shift();

        if (!candidate) {
          fillerCount++;
          candidate = { username: `Filler #${fillerCount}`, region: "Filler" };
          log(`Bucket empty, assigned ${candidate.username} to ${role} in team #${index + 1}`);
        } else {
          log(`Assigned player ${candidate.username} to role ${role} in team #${index + 1}`);
        }

        team.push(candidate);
      }

      teams.push(team);
    }

    log(`All teams assigned successfully`);

    return { success: true, teams, nextStep: "teamCheck" };
  } catch (error) {
    log(`Error in simplified assignPlayersToPlannedTeams: ${error.message}`);
    return { success: false, teams: [], nextStep: "teamCheck" };
  }
}
