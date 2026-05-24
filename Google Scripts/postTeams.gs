/**
 * postTeams
 * Version: 1.3.4 (Robust label handling)
 * Posts generated teams to the spreadsheet and sends Discord preview.
 */
function postTeams(sheet, teams, safeLog) {
  const SCRIPT_VERSION = "postTeams v1.3.4";
  const LOG_ENABLED = true;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log("Starting postTeams");

  // Helper to generate team letters using repeated same-letter scheme:
  // 1-letter: A..Z (26)
  // 2-letter: AA..ZZ (26)
  // 3-letter: AAA..ZZZ (26)
  // total = 78, then wrap to A
  const getLabelForTeam = (idx) => {
    const index = Math.max(0, Math.floor(idx));
    const perLength = 26;
    const total = perLength * 3; // 78
    const i = index % total; // wrap after ZZZ

    if (i < perLength) {
      return String.fromCharCode(65 + i);
    } else if (i < perLength * 2) {
      const k = i - perLength;
      const ch = String.fromCharCode(65 + k);
      return ch + ch;
    } else {
      const k = i - perLength * 2;
      const ch = String.fromCharCode(65 + k);
      return ch + ch + ch;
    }
  };

  // Inverse: map labels of form A, BB, CCC to 0-based index
  // If label has mixed characters (e.g., 'AB'), use first char and length as fallback
  const labelToIndex = (label) => {
    if (!label || typeof label !== 'string') return 0;
    const clean = label.toUpperCase();
    const len = Math.min(clean.length, 3);
    const ch = clean[0];
    const code = ch.charCodeAt(0) - 65;
    if (code < 0 || code > 25) return 0;
    const perLength = 26;
    const offset = (len === 1) ? 0 : (len === 2) ? perLength : perLength * 2;
    return offset + code;
  };

  // Determine next team index based on last label safely
  let nextTeamIndex = 0;
  const lastColumn = sheet.getLastColumn();

  // Helper: find the last non-empty row in a specific column
  const getLastRowInColumn = (col) => {
    const overallLast = sheet.getLastRow();
    const numRows = Math.max(overallLast, 1);
    const vals = sheet.getRange(1, col, numRows, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      const v = vals[i] && vals[i][0];
      if (v !== '' && v !== null && v !== undefined) return i + 1;
    }
    return 0;
  };

  if (lastColumn > 1) {
    try {
      const lastRow = getLastRowInColumn(lastColumn);
      const probeRow = Math.max(lastRow - 3, 1);
      const lastLabelCell = lastRow > 0 ? sheet.getRange(probeRow, lastColumn).getValue() : '';

      // Log what we found when checking the last column team label.
      try {
        const preview = (lastLabelCell && typeof lastLabelCell === 'string') ? lastLabelCell : String(lastLabelCell);
        if (typeof safeLog === 'function') {
          safeLog(`[${SCRIPT_VERSION}] Checked last column: lastColumn=${lastColumn}, lastRow=${lastRow}, lastLabelCell=${preview}`);
        } else if (typeof Logger !== 'undefined' && Logger && Logger.log) {
          Logger.log(`[${SCRIPT_VERSION}] Checked last column: lastColumn=%s, lastRow=%s, lastLabelCell=%s`, lastColumn, lastRow, preview);
        }
      } catch (logErr) {
        // ignore logging errors
      }

      if (lastLabelCell && typeof lastLabelCell === "string") {
        const parts = lastLabelCell.split(' ');
        const lastTeamLabel = parts[1];
        if (lastTeamLabel) {
          nextTeamIndex = labelToIndex(lastTeamLabel) + 1;
          const MAX = 26 * 3;
          if (nextTeamIndex >= MAX) nextTeamIndex = 0;
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
