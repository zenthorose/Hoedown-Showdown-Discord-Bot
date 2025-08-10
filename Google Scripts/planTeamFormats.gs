function planTeamFormats({ east, west, both }) {
  const teamPlan = [];
  let useEast = east.length <= west.length; // Start with the side with more players, or East if equal

  while (east.length + west.length + both.length > 0) {
    // Format 1: ['East', 'Both', 'Both'] or ['West', 'Both', 'Both']
    if (((useEast && east.length >= 1) || (!useEast && west.length >= 1)) && both.length >= 2) {
      const team = useEast ? ['East', 'Both', 'Both'] : ['West', 'Both', 'Both'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 1); // Remove 1 West player
      } else {
        east.splice(0, 1); // Remove 1 East player
      }
      both.splice(0, 2); // Remove 2 Both players

    // Format 2: ['East', 'East', 'Both'] or ['West', 'West', 'Both']
    } else if (((useEast && east.length >= 2) || (!useEast && west.length >= 2)) && both.length === 1) {
      const team = useEast ? ['East', 'East', 'Both'] : ['West', 'West', 'Both'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 2); // Remove 2 West players
      } else {
        east.splice(0, 2); // Remove 2 East players
      }
      both.splice(0, 1); // Remove 1 Both player

    // Format 3: ['East', 'East', 'East'] or ['West', 'West', 'West']
    } else if (((useEast && east.length >= 3) || (!useEast && west.length >= 3)) && both.length === 0) {
      const team = useEast ? ['East', 'East', 'East'] : ['West', 'West', 'West'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 3); // Remove 3 West players
      } else {
        east.splice(0, 3); // Remove 3 East players
      }

    // Format 4: ['East', 'East', 'Filler'] or ['West', 'West', 'Filler']
    } else if (((useEast && east.length === 2) || (!useEast && west.length === 2)) && both.length === 0) {
      const team = useEast ? ['East', 'East', 'Filler'] : ['West', 'West', 'Filler'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 2); // Remove 2 West players
      } else {
        east.splice(0, 2); // Remove 2 East players
      }

    // Format 5: ['East', 'Both', 'Filler'] or ['West', 'Both', 'Filler']
    } else if (((useEast && east.length === 1) || (!useEast && west.length === 1)) && both.length === 1) {
      const team = useEast ? ['East', 'Both', 'Filler'] : ['West', 'Both', 'Filler'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 1); // Remove 1 West player
      } else {
        east.splice(0, 1); // Remove 1 East player
      }
      both.splice(0, 1); // Remove 1 Both player

    // Format 6: ['East', 'Filler', 'Filler'] or ['West', 'Filler', 'Filler']
    } else if (((useEast && east.length === 1) || (!useEast && west.length === 1)) && both.length === 0) {
      const team = useEast ? ['East', 'Filler', 'Filler'] : ['West', 'Filler', 'Filler'];
      teamPlan.push(team);
      useEast = !useEast;
      if (useEast) {
        west.splice(0, 1); // Remove 1 West player
      } else {
        east.splice(0, 1); // Remove 1 East player
      }

    // Format 7: ['Both', 'Both', 'Both']
    } else if (east.length === 0 && west.length === 0 && both.length >= 3) {
      teamPlan.push(['Both', 'Both', 'Both']);
      both.splice(0, 3); // Remove 3 Both players

    // Format 8: ['Both', 'Both', 'Filler']
    } else if (east.length === 0 && west.length === 0 && both.length === 2) {
      teamPlan.push(['Both', 'Both', 'Filler']);
      both.splice(0, 2); // Remove 2 Both players

    // Format 9: ['Both', 'Filler', 'Filler']
    } else if (east.length === 0 && west.length === 0 && both.length === 1) {
      teamPlan.push(['Both', 'Filler', 'Filler']);
      both.splice(0, 1); // Remove 1 Both player

    } else {
      useEast = !useEast; // If no conditions match, switch regions
    }
  }

  console.log(`Generated ${teamPlan.length} teams.`);
  return teamPlan;
}
