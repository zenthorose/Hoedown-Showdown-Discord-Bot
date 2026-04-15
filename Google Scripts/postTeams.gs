/**
 * postTeams
 * Version: 1.3.1 (Robust label handling)
 * Posts generated teams to the spreadsheet and sends Discord preview.
 */
function postTeams(sheet, teams, safeLog) {
  const SCRIPT_VERSION = "postTeams v1.3.1";
  const LOG_ENABLED = false;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log("Starting postTeams");

  // Helper to generate team letters (A-Z, then AA-ZZ)
  const getLabelForTeam = (index) => {
    index = index % 52;
    if (index < 26) return String.fromCharCode(65 + index);
    return String.fromCharCode(65 + (index - 26)) + String.fromCharCode(65 + (index - 26));
  };

  // Determine next team index based on last label safely
  let nextTeamIndex = 0;
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > 1) {
    try {
      const lastRow = sheet.getLastRow();
      const lastLabelCell = sheet.getRange(Math.max(lastRow - 3, 1), lastColumn).getValue();
      if (lastLabelCell && typeof lastLabelCell === "string") {
        const parts = lastLabelCell.split(' ');
        const lastTeamLabel = parts[1];
        if (lastTeamLabel) {
          if (lastTeamLabel.length === 1) nextTeamIndex = lastTeamLabel.charCodeAt(0) - 65 + 1;
          else if (lastTeamLabel.length === 2 && lastTeamLabel[0] === lastTeamLabel[1])
            nextTeamIndex = 26 + (lastTeamLabel.charCodeAt(0) - 65) + 1;
        }
      }
    } catch (e) {
      log(`Failed to get last team label safely: ${e.message}`);
      nextTeamIndex = 0; // fallback
    }
  }

  const columnToPost = lastColumn + 1;

  // Determine round number
  let round = 1;
  try {
    if (lastColumn > 1) {
      const prevRoundCell = sheet.getRange(1, lastColumn).getValue();
      round = prevRoundCell && prevRoundCell.toString().includes('Round #')
        ? parseInt(prevRoundCell.replace('Round #', '')) + 1
        : 1;
    }
  } catch {
    round = 1; // fallback
  }

  sheet.getRange(1, columnToPost).setValue(`Round #${round}`);

  const teamData = [];
  const discordTeams = [];
  const teamLetters = [];

  teams.forEach((team, index) => {
    const label = getLabelForTeam(nextTeamIndex + index);
    teamLetters.push(label); // for Discord
    teamData.push([`Team ${label}`]);

    team.forEach(p => {
      const playerName = p && p.name ? p.name : "Unknown";
      const playerRegion = p && p.region ? p.region : "Unknown";
      teamData.push([`${playerName} (${playerRegion})`]);
    });

    teamData.push(['']); // empty row between teams
    discordTeams.push(team.map(p => ({
      name: p && p.name ? p.name : "Unknown",
      region: p && p.region ? p.region : "Unknown"
    })));

    log(`Team ${label}: ${team.map(p => `${p && p.name ? p.name : "Unknown"} (${p && p.region ? p.region : "Unknown"})`).join(', ')}`);
  });

  // Post to sheet
  sheet.getRange(2, columnToPost, teamData.length, 1).setValues(teamData);

  // Copy new column to column B safely
  try {
    const dataToCopy = sheet.getRange(2, columnToPost, sheet.getLastRow() - 1, 1).getValues();
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).clearContent();
    sheet.getRange(2, 2, dataToCopy.length, 1).setValues(dataToCopy);
  } catch (e) {
    log(`Error copying new column to column B: ${e.message}`);
  }

  log("postTeams sheet update completed");

  // Post preview to Discord
  postTeamsPreview(discordTeams, teamLetters, round, safeLog);
  log("postTeams Discord preview sent");
}
