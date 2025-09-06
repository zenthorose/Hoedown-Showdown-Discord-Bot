function planTeamFormats({ east, west, both }, safeLog) {
  const SCRIPT_VERSION = "planTeamFormats v1.2.1";
  const LOG_ENABLED = false; // <-- toggle logging on/off

  // Wrapper around safeLog that respects toggle
  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") {
      safeLog(`[${SCRIPT_VERSION}] ${msg}`);
    }
  }

  log("Starting script");

  // Defensive copies
  east = east.slice();
  west = west.slice();
  both = both.slice();

  let useEast = east.length >= west.length;
  log(`Initial counts - East: ${east.length}, West: ${west.length}, Both: ${both.length}`);

  const teamPlan = [];
  let iterationCounter = 0;

  while (east.length + west.length + both.length > 0) {
    iterationCounter++;
    if (iterationCounter > 1000) {
      log("ERROR: exceeded 1000 iterations, possible infinite loop");
      throw new Error("planTeamFormats exceeded 1000 iterations, possible infinite loop");
    }

    let chosenFormat = null;

    if (((useEast && east.length >= 1) || (!useEast && west.length >= 1)) && both.length >= 2) {
      chosenFormat = useEast ? ['East','Both','Both'] : ['West','Both','Both'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,1); else west.splice(0,1);
      both.splice(0,2);
    } else if (((useEast && east.length >= 2) || (!useEast && west.length >= 2)) && both.length === 1) {
      chosenFormat = useEast ? ['East','East','Both'] : ['West','West','Both'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,2); else west.splice(0,2);
      both.splice(0,1);
    } else if (((useEast && east.length >= 3) || (!useEast && west.length >= 3)) && both.length === 0) {
      chosenFormat = useEast ? ['East','East','East'] : ['West','West','West'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,3); else west.splice(0,3);
    } else if (((useEast && east.length === 2) || (!useEast && west.length === 2)) && both.length === 0) {
      chosenFormat = useEast ? ['East','East','Filler'] : ['West','West','Filler'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,2); else west.splice(0,2);
    } else if (((useEast && east.length === 1) || (!useEast && west.length === 1)) && both.length === 1) {
      chosenFormat = useEast ? ['East','Both','Filler'] : ['West','Both','Filler'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,1); else west.splice(0,1);
      both.splice(0,1);
    } else if (((useEast && east.length === 1) || (!useEast && west.length === 1)) && both.length === 0) {
      chosenFormat = useEast ? ['East','Filler','Filler'] : ['West','Filler','Filler'];
      teamPlan.push(chosenFormat);
      if (useEast) east.splice(0,1); else west.splice(0,1);
    } else if (east.length === 0 && west.length === 0 && both.length >= 3) {
      chosenFormat = ['Both','Both','Both'];
      teamPlan.push(chosenFormat);
      both.splice(0,3);
    } else if (east.length === 0 && west.length === 0 && both.length === 2) {
      chosenFormat = ['Both','Both','Filler'];
      teamPlan.push(chosenFormat);
      both.splice(0,2);
    } else if (east.length === 0 && west.length === 0 && both.length === 1) {
      chosenFormat = ['Both','Filler','Filler'];
      teamPlan.push(chosenFormat);
      both.splice(0,1);
    } else {
      useEast = !useEast;
      continue;
    }

    log(`Chose format: ${JSON.stringify(chosenFormat)} | Remaining - East: ${east.length}, West: ${west.length}, Both: ${both.length}`);
    useEast = !useEast;
  }

  log(`Generated ${teamPlan.length} teams: ${JSON.stringify(teamPlan)}`);
  return teamPlan;
}
