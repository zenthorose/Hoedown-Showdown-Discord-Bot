function postTeams(sheet, teams, logSheet) {
  logSheet.appendRow(["I made it to postTeams!"]);
  // Helper function to generate labels for teams (A-Z, AA-ZZ using same letters)
  const getLabelForTeam = (index) => {
    // Wrap around every 52 labels (A-Z, AA-ZZ)
    index = index % 52;

    if (index < 26) {
      // A-Z
      return String.fromCharCode(index + 65);
    } else {
      // AA, BB, ..., ZZ
      const letter = String.fromCharCode((index - 26) + 65);
      return letter + letter;
    }
  };

  // Helper function to get the last team label from the last column
  const getLastTeamLabel = () => {
    const lastColumn = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();

    // Go up 3 rows to get the last team label
    const labelRow = lastRow - 3;
    const lastLabel = sheet.getRange(labelRow, lastColumn).getValue();
    const labelParts = lastLabel.split(' ');
    const lastTeamLabel = labelParts[1];

    logSheet.appendRow(["Last team label: " + lastTeamLabel]);
    return lastTeamLabel;
  };

  // Get the last team label and calculate index to continue from
  const lastTeamLabel = getLastTeamLabel();
  let nextTeamIndex = 0;

  if (lastTeamLabel) {
    if (lastTeamLabel.length === 1) {
      // A-Z
      nextTeamIndex = (lastTeamLabel.charCodeAt(0) - 65 + 1) % 52;
    } else if (lastTeamLabel.length === 2 && lastTeamLabel[0] === lastTeamLabel[1]) {
      // AA, BB, ..., ZZ
      nextTeamIndex = (26 + (lastTeamLabel.charCodeAt(0) - 65) + 1) % 52;
    }
    logSheet.appendRow(["Next team index: " + nextTeamIndex]);
  }

  // Determine the next column
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 2) {
    sheet.getRange(1, 3).setValue('Round #1');
  } else {
    const roundNumber = parseInt(sheet.getRange(1, lastColumn).getValue().replace('Round #', '')) + 1;
    sheet.getRange(1, lastColumn + 1).setValue(`Round #${roundNumber}`);
  }

  let columnToPost = lastColumn + 1;
  const teamData = [];

  teams.forEach((team, index) => {
    const label = `Team ${getLabelForTeam(nextTeamIndex + index)}`;
    teamData.push([label]);

    team.forEach(p => {
      teamData.push([`${p.username} (${p.region})`]);
    });

    teamData.push(['']);

    const teamDetails = team.map(p => `${p.username} (${p.region})`).join(', ');
    logSheet.appendRow([`${label}: ${teamDetails}`, new Date()]);
  });

  // Write team data to the sheet
  sheet.getRange(2, columnToPost, teamData.length, 1).setValues(teamData);

  // Copy last column to column B
  const lastColumnRange = sheet.getRange(2, columnToPost, sheet.getLastRow() - 1, 1);
  const data = lastColumnRange.getValues();
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).clearContent();
  sheet.getRange(2, 2, data.length, 1).setValues(data);
}
