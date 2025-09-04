/**
 * postTeams
 * Version: 1.3.0
 * Posts generated teams to the spreadsheet and sends Discord preview.
 */
function postTeams(sheet, teams, safeLog) {
  const SCRIPT_VERSION = "postTeams v1.3.0";
  const LOG_ENABLED = true;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[postTeams] ${msg}`);
  }

  log("Starting postTeams");

  // Helper to generate team letters
  const getLabelForTeam = (index) => {
    index = index % 52;
    if (index < 26) return String.fromCharCode(65 + index);
    const letter = String.fromCharCode(65 + (index - 26));
    return letter + letter;
  };

  // Determine next team index based on last label
  let nextTeamIndex = 0;
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > 1) {
    try {
      const lastLabelCell = sheet.getRange(sheet.getLastRow() - 3, lastColumn).getValue();
      const lastTeamLabel = lastLabelCell.split(' ')[1];
      if (lastTeamLabel.length === 1) nextTeamIndex = lastTeamLabel.charCodeAt(0) - 65 + 1;
      else if (lastTeamLabel.length === 2 && lastTeamLabel[0] === lastTeamLabel[1])
        nextTeamIndex = 26 + (lastTeamLabel.charCodeAt(0) - 65) + 1;
    } catch (e) {
      log(`Failed to get last team label: ${e.message}`);
    }
  }

  const columnToPost = lastColumn + 1;
  const roundNumber = lastColumn === 2 ? 1 : parseInt(sheet.getRange(1, lastColumn).getValue().replace('Round #', '')) + 1;
  sheet.getRange(1, columnToPost).setValue(`Round #${roundNumber}`);

  const teamData = [];
  const discordTeams = [];
  const teamLetters = [];

  teams.forEach((team, index) => {
    const label = getLabelForTeam(nextTeamIndex + index);
    teamLetters.push(label); // Store letter for Discord
    teamData.push([`Team ${label}`]);

    team.forEach(p => teamData.push([`${p.username} (${p.region})`]));

    teamData.push(['']);

    // Build Discord-friendly team with username + region
    discordTeams.push(team.map(p => ({ username: p.username, region: p.region })));

    log(`Team ${label}: ${team.map(p => `${p.username} (${p.region})`).join(', ')}`);
  });

  // Post to sheet
  sheet.getRange(2, columnToPost, teamData.length, 1).setValues(teamData);

  // Copy new column to column B
  const dataToCopy = sheet.getRange(2, columnToPost, sheet.getLastRow() - 1, 1).getValues();
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).clearContent();
  sheet.getRange(2, 2, dataToCopy.length, 1).setValues(dataToCopy);

  log("postTeams sheet update completed");

  // Post preview to Discord with letters and round
  postTeamsPreview(discordTeams, teamLetters, roundNumber, safeLog);
  log("postTeams Discord preview sent");
}
