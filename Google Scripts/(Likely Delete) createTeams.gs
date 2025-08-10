function createTeams(players, logSheet) {
  logSheet.appendRow([`createTeams Triggered?`]);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Players That Reacted');

  const getPastTeamsData = () => {
    const pastTeamsRange = sheet.getRange('C1:Z'); // Adjust as needed
    const pastTeamsData = pastTeamsRange.getValues();
    if (pastTeamsData.length < 1 || pastTeamsData[0].length < 1) {
      throw new Error('No past teams data available in the specified range.');
    }
    return pastTeamsData;
  };

  const getPastPairings = (pastTeamsData) => {
    const pastPairings = new Set();
    const numRows = pastTeamsData.length;
    const numCols = pastTeamsData[0].length;

    for (let col = 0; col < numCols; col++) {
      for (let row = 0; row < numRows - 3; row++) {
        const cellValue = pastTeamsData[row][col];
        if (typeof cellValue === 'string' && cellValue.toLowerCase().includes('team')) {
          const rawPlayers = [
            pastTeamsData[row + 1][col],
            pastTeamsData[row + 2][col],
            pastTeamsData[row + 3][col]
          ];

          const players = rawPlayers.map(player => {
            if (typeof player !== 'string') return null;
            const trimmed = player.trim();
            // Remove region if present, like "Jordan (East)" => "Jordan"
            return trimmed.replace(/\s*\(.*?\)\s*$/, '');
          }).filter(player => {
            return (
              player &&
              player !== '' &&
              !/^Team\s+[A-Z]+$/i.test(player) &&
              !/^Round\s*#?\d+/i.test(player) &&
              !player.startsWith('Filler')
            );
          });

          for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
              const sortedPair = [players[i], players[j]].sort().join('-');
              pastPairings.add(sortedPair);
            }
          }

          row += 3; // Skip the team block to avoid overlap
        }
      }
    }
    return pastPairings;
  };

  const isPairDuplicate = (username1, username2, pastPairings) => {
    const pairKey = [username1, username2].sort().join('-');
    return pastPairings.has(pairKey);
  };

  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

  const east = players.filter(p => p.region === 'East');
  const west = players.filter(p => p.region === 'West');
  const both = players.filter(p => p.region === 'Both');

  let eastShuffled = shuffle([...east]);
  let westShuffled = shuffle([...west]);
  let bothShuffled = shuffle([...both]);

  const teams = [];
  let teamIndex = 0;
  let useEast = true;
  let fillerCount = 1;

  const pastTeamsData = getPastTeamsData();
  const pastPairings = getPastPairings(pastTeamsData);

  if (pastPairings.size > 0) {
    logSheet.appendRow([`Found ${pastPairings.size} past pairings.`, new Date()]);
  } else {
    logSheet.appendRow([`No past pairings found.`, new Date()]);
  }

  const canFormUniqueTeams = () => { 
    const remainingPlayers = [...eastShuffled, ...westShuffled, ...bothShuffled];
    const seenPairs = new Set();
    for (let i = 0; i < remainingPlayers.length; i++) {
      for (let j = i + 1; j < remainingPlayers.length; j++) {
        const player1 = remainingPlayers[i];
        const player2 = remainingPlayers[j];
        if (!isPairDuplicate(player1.username, player2.username, pastPairings)) {
          return true; // If a valid pair exists, return true
        }
      }
    }
    return false; // No valid unique pairs found
  };

  let retryCount = 0;
  const MAX_RETRIES = 3; // You can tweak the number of retries
  let loopCounter = 0;
  while (eastShuffled.length + westShuffled.length + bothShuffled.length > 0 && loopCounter < 50) {
    logSheet.appendRow([`Attempt #${loopCounter + 1}`]);
    if (!canFormUniqueTeams()) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        logSheet.appendRow([`⚠️ Could not form any new unique pairings after ${MAX_RETRIES} attempts. Resetting players...`]);
        eastShuffled = shuffle([...east]);
        westShuffled = shuffle([...west]);
        bothShuffled = shuffle([...both]);
        retryCount = 0; // Reset retry count
      } else {
        logSheet.appendRow([`Retry #${retryCount}: Attempting to form valid pairs again.`]);
      }
    } else {
      const team = [];
      let formed = false;

      const addPair = (player1, player2, pastPairings) => {
        const pairKey = [player1.username, player2.username].sort().join('-');
        pastPairings.add(pairKey);
      };

      if ((useEast && eastShuffled.length >= 1 && bothShuffled.length >= 2) || 
          (!useEast && westShuffled.length >= 1 && bothShuffled.length >= 2)) {
        const region = useEast ? 'East' : 'West';
        let player1 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player2 = bothShuffled.pop();
        let player3 = bothShuffled.pop();
        logSheet.appendRow([`${region},B,B`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings) &&
            !isPairDuplicate(player1.username, player3.username, pastPairings) &&
            !isPairDuplicate(player2.username, player3.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);
          addPair(player1, player3, pastPairings);
          addPair(player2, player3, pastPairings);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: ${region} + Both + Both`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}, ${player3.username}`]);
          if (useEast) {
            eastShuffled.push(player1);
          } else {
            westShuffled.push(player1);
          }
          bothShuffled.push(player2, player3); // Move players back to the pool
        }
      } else if ((useEast && eastShuffled.length >= 2 && bothShuffled.length >= 1) || 
                (!useEast && westShuffled.length >= 2 && bothShuffled.length >= 1)) {
        const region = useEast ? 'East' : 'West';
        let player1 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player2 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player3 = bothShuffled.pop();
        logSheet.appendRow([`${region},${region},B`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings) &&
            !isPairDuplicate(player1.username, player3.username, pastPairings) &&
            !isPairDuplicate(player2.username, player3.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);
          addPair(player1, player3, pastPairings);
          addPair(player2, player3, pastPairings);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: ${region} + ${region} + Both`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}, ${player3.username}`]);
          if (useEast) {
            eastShuffled.push(player1, player2);
          } else {
            westShuffled.push(player1, player2);
          }
          bothShuffled.push(player3); // Move players back to the pool
        }
      } else if ((useEast && eastShuffled.length >= 3 && bothShuffled.length >= 0) || 
                (!useEast && westShuffled.length >= 3 && bothShuffled.length >= 0)) {
        const region = useEast ? 'East' : 'West';
        let player1 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player2 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player3 = useEast ? eastShuffled.pop() : westShuffled.pop();
        logSheet.appendRow([`${region},${region},${region}`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings) &&
            !isPairDuplicate(player1.username, player3.username, pastPairings) &&
            !isPairDuplicate(player2.username, player3.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);
          addPair(player1, player3, pastPairings);
          addPair(player2, player3, pastPairings);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: ${region} + ${region} + ${region}`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}, ${player3.username}`]);
          if (useEast) {
            eastShuffled.push(player1, player2, player3);
          } else {
            westShuffled.push(player1, player2, player3);
          } // Move players back to the pool
        }
      } else if ((useEast && eastShuffled.length >= 2 && bothShuffled.length >= 0) || 
                (!useEast && westShuffled.length >= 2 && bothShuffled.length >= 0)) {
        const region = useEast ? 'East' : 'West';
        let player1 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player2 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player3 = { username: `Filler ${fillerCount++}`, region: 'None' };
        logSheet.appendRow([`${region},${region},F`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);  // Add the player-to-player pair
          logSheet.appendRow([player1,player2]);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: ${region} + ${region} + Filler`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}`]);
          if (useEast) {
            eastShuffled.push(player1, player2);
          } else {
            westShuffled.push(player1, player2);
          } // Push back the players
        }
      } else if ((useEast && eastShuffled.length >= 1 && bothShuffled.length >= 0) || 
                (!useEast && westShuffled.length >= 1 && bothShuffled.length >= 0)) {
        const region = useEast ? 'East' : 'West';
        let player1 = useEast ? eastShuffled.pop() : westShuffled.pop();
        let player2 = { username: `Filler ${fillerCount++}`, region: 'None' };
        let player3 = { username: `Filler ${fillerCount++}`, region: 'None' };
        logSheet.appendRow([`${region},F,F`]);

        team.push(player1, player2, player3);
        logSheet.appendRow([player1]);
        useEast = !useEast;  // Alternate between East and West
        formed = true;
        //logSheet.appendRow([`Team #${teamIndex + 1}: ${region} + Filler + Filler`, new Date()]);
      }else if (bothShuffled.length === 3 && eastShuffled.length === 0 && westShuffled.length === 0) {
        // E/W = 0 and Both = 3 (Both players and a filler)
        let player1 = bothShuffled.pop();
        let player2 = bothShuffled.pop();
        let player3 = bothShuffled.pop();
        logSheet.appendRow([`B,B,B`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings) &&
            !isPairDuplicate(player1.username, player3.username, pastPairings) &&
            !isPairDuplicate(player2.username, player3.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);
          addPair(player1, player3, pastPairings);
          addPair(player2, player3, pastPairings);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: Both + Both + Both`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}`]);
          bothShuffled.push(player1, player2, player3); // Push back the players
        }
      } else if (bothShuffled.length === 2 && eastShuffled.length === 0 && westShuffled.length === 0) {
        let player1 = bothShuffled.pop();
        let player2 = bothShuffled.pop();
        let player3 = { username: `Filler ${fillerCount++}`, region: 'None' };
        logSheet.appendRow([`B,B,F`]);

        if (!isPairDuplicate(player1.username, player2.username, pastPairings)) {
          team.push(player1, player2, player3);
          addPair(player1, player2, pastPairings);  // Add the player-to-player pair
          logSheet.appendRow([player1,player2]);
          useEast = !useEast;  // Alternate between East and West
          formed = true;
          //logSheet.appendRow([`Team #${teamIndex + 1}: Both + Both + Filler`, new Date()]);
        } else {
          logSheet.appendRow([`Duplicate pair found: ${player1.username}, ${player2.username}`]);
          bothShuffled.push(player1, player2); // Push back the players
        }
      } else if (bothShuffled.length === 1 && eastShuffled.length === 0 && westShuffled.length === 0) {
        let player1 = bothShuffled.pop();
        let player2 = { username: `Filler ${fillerCount++}`, region: 'None' };
        let player3 = { username: `Filler ${fillerCount++}`, region: 'None' };
        logSheet.appendRow([`B,F,F`]);

        team.push(player1, player2, player3);
        logSheet.appendRow([player1]);
        useEast = !useEast;  // Alternate between East and West
        formed = true;
        //logSheet.appendRow([`Team #${teamIndex + 1}: Both + Filler + Filler`, new Date()]);
      } else {
        useEast = !useEast;  // Alternate between East and West
      }

      if (formed) {
        teams.push(team);
        teamIndex++;
      }
      loopCounter++;
      logSheet.appendRow([useEast]);
      logSheet.appendRow([
        `Remaining - East: ${eastShuffled.map(p => p.username).join(', ')}`,
        `West: ${westShuffled.map(p => p.username).join(', ')}`,
        `Both: ${bothShuffled.map(p => p.username).join(', ')}`,
      ]);
    }
  }
  return teams;
}
