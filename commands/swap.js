function swapPlayers(teamSet, removePlayer, addPlayer) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Players That Reacted');
  var lastColumn = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();

  // Get the data from Row 1 (for headers) and find the correct column for the team set
  var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var teamColumn = -1;

  // Regular expression to match columns like "Team 1st", "Team 2nd", etc.
  var regex = new RegExp("^Team " + teamSet + "(st|nd|rd|th)$", "i");

  // Loop through all the columns to find the one that matches the pattern
  for (var i = 0; i < header.length; i++) {
    if (regex.test(header[i])) {
      teamColumn = i + 1; // Spreadsheet column index is 1-based, so add 1
      break;
    }
  }

  if (teamColumn === -1) {
    logToSheet(`Swap failed: Could not find Team ${teamSet}`);
    return;
  }

  // Get the team data from the found column (excluding the header)
  var teamData = sheet.getRange(2, teamColumn, lastRow - 1, 1).getValues();
  
  var swapped = false;

  // Iterate through the team data to find and swap the players
  for (var i = 0; i < teamData.length; i++) {
    var playerList = teamData[i][0].split("\n");  // Assuming players are stored line by line
    
    var removeIndex = playerList.indexOf(removePlayer);
    var addIndex = playerList.indexOf(addPlayer);
    
    if (removeIndex !== -1 && addIndex === -1) {
      // If removePlayer is in the team and addPlayer is not already in the team
      playerList[removeIndex] = addPlayer;  // Replace removePlayer with addPlayer
      teamData[i][0] = playerList.join("\n");  // Join the player list back with newlines
      swapped = true;
      logToSheet(`Swapped ${removePlayer} with ${addPlayer} in Team ${teamSet}`);
      break;
    }
  }

  // If swapped, update the sheet with the new team data
  if (swapped) {
    // Write the updated team data back into the same column
    sheet.getRange(2, teamColumn, teamData.length, 1).setValues(teamData);
  } else {
    logToSheet(`Swap failed: Could not find ${removePlayer} or ${addPlayer} in Team ${teamSet}`);
  }
}