/**
 * postTeams
 * Version: 3.0.0 (Robust label handling)
 * Posts generated teams to the spreadsheet and sends Discord preview.
 */
function postTeams(sheet, teams, safeLog) {
  const SCRIPT_VERSION = "postTeams v3.0.0";
  const LOG_ENABLED = false;

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
  let lastTeamLabel = null;
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

  // Helper: get the last team label (e.g., 'A', 'BB') from a given column's label cell
  const getLastTeamLabelInColumn = (col) => {
    try {
      const lastRowCol = getLastRowInColumn(col);
      const probeRowCol = Math.max(lastRowCol - 3, 1);
      const cell = lastRowCol > 0 ? sheet.getRange(probeRowCol, col).getValue() : '';
      if (cell && typeof cell === 'string') {
        const parts = cell.split(' ');
        return parts[1] || null;
      }
    } catch (e) {
      // ignore and return null
    }
    return null;
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
        lastTeamLabel = parts[1] || null;
      }

      // Also capture the previous column's last team label (the "previous round")
      var prevTeamLabel = null;
      if (lastColumn - 1 > 1) {
        prevTeamLabel = getLastTeamLabelInColumn(lastColumn - 1);
      }
    } catch (e) {
      log(`Failed to get last team label safely: ${e.message}`);
      nextTeamIndex = 0; // fallback
    }
  }

  // Decide whether to reuse the last column (redo) or create a new one.
  // If the last column header background is red (#ff0000) we treat it as a redo:
  //  - overwrite that column (wipe contents and formatting)
  //  - keep the same round number (no +1)
  // Otherwise, post to a new column and increment the round number as before.
  let columnToPost;
  let round = 1;
  try {
    if (lastColumn > 1) {
      const prevRoundCell = sheet.getRange(1, lastColumn).getValue();
      // getBackground may return colors in different cases; normalize to lowercase
      const prevBg = (sheet.getRange(1, lastColumn).getBackground() || '').toString().toLowerCase();
      const isRedo = prevBg === '#ff0000' || prevBg === 'red';

      if (isRedo) {
        columnToPost = lastColumn;
        // Keep the same round number when redoing
        round = prevRoundCell && prevRoundCell.toString().includes('Round #')
          ? parseInt(prevRoundCell.replace('Round #', ''))
          : 1;

        // Wipe the existing column contents but preserve formatting (borders, alignment)
        try {
          const lastRow = Math.max(sheet.getLastRow(), 1);
          sheet.getRange(1, columnToPost, lastRow, 1).clearContent();
        } catch (wipeErr) {
          log(`Failed to wipe redo column: ${wipeErr.message}`);
        }
      } else {
        columnToPost = lastColumn + 1;
        round = prevRoundCell && prevRoundCell.toString().includes('Round #')
          ? parseInt(prevRoundCell.replace('Round #', '')) + 1
          : 1;
      }

      // Determine nextTeamIndex based on whether we're redoing or adding a new column
      try {
        const MAX = 26 * 3;
        if (isRedo) {
          // When redoing, base labels on the previous round (column before the red one)
          if (prevTeamLabel) {
            nextTeamIndex = labelToIndex(prevTeamLabel) + 1;
            if (nextTeamIndex >= MAX) nextTeamIndex = 0;
          } else if (lastTeamLabel) {
            // fallback to lastTeamLabel if previous isn't available
            nextTeamIndex = labelToIndex(lastTeamLabel);
          } else {
            nextTeamIndex = 0;
          }
        } else {
          if (lastTeamLabel) {
            nextTeamIndex = labelToIndex(lastTeamLabel) + 1;
            if (nextTeamIndex >= MAX) nextTeamIndex = 0;
          } else {
            nextTeamIndex = 0;
          }
        }
      } catch (idxErr) {
        log(`Failed to set nextTeamIndex: ${idxErr.message}`);
        nextTeamIndex = 0;
      }
    } else {
      columnToPost = lastColumn + 1;
      round = 1;
    }
  } catch (e) {
    columnToPost = lastColumn + 1;
    round = 1; // fallback
    log(`Error determining post column/round: ${e.message}`);
  }

  // Set the Round# header and style it red with white text for readability
  const roundCell = sheet.getRange(1, columnToPost);
  roundCell.setValue(`Round #${round}`);
  try {
    roundCell.setBackground('#ff0000');
    roundCell.setFontColor('#ffffff');
    // center the header text
    roundCell.setHorizontalAlignment('center');
  } catch (e) {
    log(`Failed to style round header: ${e.message}`);
  }

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
  try {
    // center posted team text for readability
    sheet.getRange(2, columnToPost, teamData.length, 1).setHorizontalAlignment('center');
  } catch (e) {
    log(`Failed to set alignment for posted teams: ${e.message}`);
  }

  // Copy new column to column B safely
  try {
    const dataToCopy = sheet.getRange(2, columnToPost, sheet.getLastRow() - 1, 1).getValues();
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).clearContent();
    sheet.getRange(2, 2, dataToCopy.length, 1).setValues(dataToCopy);
    try {
      sheet.getRange(2, 2, dataToCopy.length, 1).setHorizontalAlignment('center');
    } catch (e) {
      log(`Failed to set alignment for column B copy: ${e.message}`);
    }
  } catch (e) {
    log(`Error copying new column to column B: ${e.message}`);
  }

  // Ensure the Players That Reacted column (column B) header matches (no color changes)
  try {
    const headerB = sheet.getRange(1, 2);
    headerB.setValue(`Round #${round}`);
  } catch (e) {
    log(`Failed to set header in column B: ${e.message}`);
  }

  log("postTeams sheet update completed");

  // Post preview to Discord
  postTeamsPreview(discordTeams, teamLetters, round, safeLog);
  log("postTeams Discord preview sent");
}
