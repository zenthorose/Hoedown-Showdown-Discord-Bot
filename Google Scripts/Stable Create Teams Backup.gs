/*function createTeams(players, logSheet) {
  const east = players.filter(p => p.region === 'East');
  const west = players.filter(p => p.region === 'West');
  const both = players.filter(p => p.region === 'Both');

  const shuffle = arr => arr.sort(() => Math.random() - 0.5);
  const eastShuffled = shuffle([...east]);
  const westShuffled = shuffle([...west]);
  const bothShuffled = shuffle([...both]);

  const teams = [];
  let teamIndex = 0;
  let useEast = true;
  let fillerCount = 1; // Initialize filler count

  while (eastShuffled.length + westShuffled.length + bothShuffled.length > 0) {
    const team = [];

    if (eastShuffled.length >= 1 || westShuffled.length >= 1) {
      if (useEast) {
        // For East teams
        if (eastShuffled.length >= 1 && bothShuffled.length >= 2) {
          team.push(eastShuffled.pop());
          team.push(bothShuffled.pop());
          team.push(bothShuffled.pop());
          useEast = false;
        } else if (eastShuffled.length >= 2 && bothShuffled.length >= 1) {
          team.push(eastShuffled.pop());
          team.push(eastShuffled.pop());
          team.push(bothShuffled.pop());
          useEast = false;
        } else if (eastShuffled.length >= 3 && bothShuffled.length === 0) {
          team.push(eastShuffled.pop());
          team.push(eastShuffled.pop());
          team.push(eastShuffled.pop());
          useEast = false;
        } else if (eastShuffled.length >= 2 && bothShuffled.length === 0) {
          team.push(eastShuffled.pop());
          team.push(eastShuffled.pop());
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
          useEast = false;
        } else if (eastShuffled.length >= 1 && bothShuffled.length === 0) {
          team.push(eastShuffled.pop());
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
          useEast = false;
        } else {
          break;
        }
      } else {
        // For West teams (mirrored logic)
        if (westShuffled.length >= 1 && bothShuffled.length >= 2) {
          team.push(westShuffled.pop());
          team.push(bothShuffled.pop());
          team.push(bothShuffled.pop());
          useEast = true;
        } else if (westShuffled.length >= 2 && bothShuffled.length >= 1) {
          team.push(westShuffled.pop());
          team.push(westShuffled.pop());
          team.push(bothShuffled.pop());
          useEast = true;
        } else if (westShuffled.length >= 3 && bothShuffled.length === 0) {
          team.push(westShuffled.pop());
          team.push(westShuffled.pop());
          team.push(westShuffled.pop());
          useEast = true;
        } else if (westShuffled.length >= 2 && bothShuffled.length === 0) {
          team.push(westShuffled.pop());
          team.push(westShuffled.pop());
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
          useEast = true;
        } else if (westShuffled.length >= 1 && bothShuffled.length === 0) {
          team.push(westShuffled.pop());
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
          team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
        } else {
          break;
        }
      }
    } else {
      if (bothShuffled.length >= 3) {
        team.push(bothShuffled.pop());
        team.push(bothShuffled.pop());
        team.push(bothShuffled.pop());
      } else if (bothShuffled.length >= 2) {
        team.push(bothShuffled.pop());
        team.push(bothShuffled.pop());
        team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
      } else if (bothShuffled.length >= 1) {
        team.push(bothShuffled.pop());
        team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
        team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
      } else {
        break;
      }
    }

    // Final fallback - fillers
    while (team.length < 3) {
      team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
    }

    teams.push(team);
    teamIndex++;
  }

  // Handle leftover player(s)
  const leftovers = [...eastShuffled, ...westShuffled, ...bothShuffled];
  if (leftovers.length) {
    while (leftovers.length > 0) {
      const team = [];
      const leftoverPlayer = leftovers.pop();
      team.push(leftoverPlayer);

      // Fill with fillers if the team has fewer than 3 players
      while (team.length < 3) {
        team.push({ username: `Filler ${fillerCount++}`, region: 'None' });
      }

      teams.push(team);
      teamIndex++;
    }
  }

  return teams;
}*/