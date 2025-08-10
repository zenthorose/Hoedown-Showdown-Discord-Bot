function dupeCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Players That Reacted");
  const logSheetName = "Logs";
  let logSheet = ss.getSheetByName(logSheetName);
  
  // Create Logs sheet if it doesn't exist
  if (!logSheet) {
    logSheet = ss.insertSheet(logSheetName);
  } else {
    logSheet.clear();
  }
  logSheet.appendRow([
    "Duplicate Pair",
    "First Seen (Round)",
    "First Seen (Team)",
    "Duplicate Found (Round)",
    "Duplicate Found (Team)"
  ]);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const startCol = 2; // Column C
  const allPairs = {}; // { "Player1-Player2": { round: X, team: Y } }

  for (let col = startCol; col < headers.length; col++) {
    const roundName = headers[col];

    let row = 1;
    while (row < data.length) {
      const cell = data[row][col];
      
      if (typeof cell === 'string' && cell.startsWith("Team ")) {
        const teamName = cell;
        const players = [];

        // Get next 3 players
        for (let i = 1; i <= 3; i++) {
          if (data[row + i] && data[row + i][col]) {
            players.push(data[row + i][col]);
          }
        }

        // Create pairs and check for duplicates
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
            const pair = [players[i], players[j]].sort().join(" - ");

            if (allPairs[pair]) {
              const first = allPairs[pair];
              logSheet.appendRow([
                pair,
                first.round,
                first.team,
                roundName,
                teamName
              ]);
            } else {
              allPairs[pair] = {
                round: roundName,
                team: teamName
              };
            }
          }
        }

        row += 4; // Skip ahead to next team name row
      } else {
        row++;
      }
    }
  }

  Logger.log("Duplicate pairing check complete.");
}
