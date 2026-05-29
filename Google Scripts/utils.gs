// ===== Configuration =====

// Function to set the SPREADSHEET_ID in script properties
function setSpreadsheetId() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty(
    'SPREADSHEET_ID',
    '1TtFXWGpdbcVBEcj8HSkWWp2Ik0iJ4y_xU_70wrkLIdw'
  );
}

// Function to get the SPREADSHEET_ID from script properties
function getSpreadsheetId() {
  const scriptProperties = PropertiesService.getScriptProperties();
  return scriptProperties.getProperty('SPREADSHEET_ID');
}

// Function to log messages to both console and "Logs" sheet
function logToSheet(message) {
  try {
    const spreadsheetId = getSpreadsheetId();
    const timestamp = new Date();

    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID is not set.");
    }

    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Logs');
    if (!sheet) {
      throw new Error('Logs sheet not found.');
    }

    // Log to Apps Script execution log
    console.log(`[v${SCRIPT_VERSION}] ${message}`);

    // Log to spreadsheet
    sheet.appendRow([timestamp, SCRIPT_VERSION, message]);
  } catch (error) {
    console.error(`[v${SCRIPT_VERSION}] Logging Error: ${error.message}`);
  }
}

// Function to log errors
function logErrorToSheet(errorMessage) {
  logToSheet("ERROR: " + errorMessage);
}

function logSanityCheck(teams, eastPool, westPool, bothPool, fillerCount) {
  try {
    const totalPlayers = teams.flat().filter(p => p.region !== "Filler").length;
    const totalFillers = teams.flat().filter(p => p.region === "Filler").length;
    const totalTeams = teams.length;

    safeLog(`Sanity Check:`);
    safeLog(`- Teams formed: ${totalTeams}`);
    safeLog(`- Players assigned: ${totalPlayers}`);
    safeLog(`- Fillers used: ${totalFillers} (expected: ${fillerCount})`);
    safeLog(`- Remaining in East pool: ${eastPool.length}`);
    safeLog(`- Remaining in West pool: ${westPool.length}`);
    safeLog(`- Remaining in Both pool: ${bothPool.length}`);
  } catch (err) {
    safeLog(`Sanity check failed: ${err.message}`);
  }
}

function pairKey(a, b) {
  const idA = String(a.id ?? a.name).trim();
  const idB = String(b.id ?? b.name).trim();
  return [idA, idB].sort().join('|'); // simple string sort is fine
}

function groupPlayersByRegion(players, safeLog) {
  safeLog("Starting groupPlayersByRegion script");
  return {
    East: players.filter(p => p.region === 'East'),
    West: players.filter(p => p.region === 'West'),
    Both: players.filter(p => p.region === 'Both')
  };
}

function saveNewPairings(round, safeLog) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Players That Reacted");
  const membersSheet = ss.getSheetByName("Discord Member List");
  const pairingsSheet = ss.getSheetByName("Previous Pairings");
  const logSheet = ss.getSheetByName("Logs");

  safeLog = safeLog || Logger.log;
  safeLog(`Starting saveNewPairings for Round #${round}`);

  if (!teamsSheet || !pairingsSheet || !membersSheet) {
    safeLog("❌ Missing required sheet(s)");
    return;
  }

  // --- Build member map: name -> Discord ID (Discord ID moved to column C)
  const membersData = membersSheet.getRange(2, 1, membersSheet.getLastRow() - 1, 3).getValues();
  const memberMap = {};
  membersData.forEach(([name, _colB, discordId]) => {
    if (name && discordId) {
      memberMap[String(name).trim().toLowerCase()] = String(discordId).trim();
    }
  });

  // --- Find round column
  const headers = teamsSheet.getRange(1, 1, 1, teamsSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    safeLog(`❌ Round column not found: ${roundHeader}`);
    return;
  }

  // --- Get round data
  const lastRow = teamsSheet.getLastRow();
  const roundValues = teamsSheet.getRange(2, roundColIndex + 1, lastRow - 1, 1).getValues().flat();

  // --- Extract teams
  const teams = [];
  let currentTeam = null;
  let currentPlayers = [];

  roundValues.forEach(val => {
    if (!val) return;
    const clean = String(val).trim();
    if (/^Team [A-Z]+$/.test(clean)) {
      if (currentTeam && currentPlayers.length > 1) {
        teams.push({ team: currentTeam, players: currentPlayers });
      }
      currentTeam = clean.replace("Team ", "");
      currentPlayers = [];
    } else {
      const playerName = clean.replace(/\s*\(.*\)$/, ""); // strip region
      currentPlayers.push(playerName);
    }
  });

  if (currentTeam && currentPlayers.length > 1) {
    teams.push({ team: currentTeam, players: currentPlayers });
  }

  safeLog(`Found ${teams.length} teams for Round #${round}`);

  // --- Build all pairings
  const pairs = [];
  for (const { team, players } of teams) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const p1 = players[i];
        const p2 = players[j];
        const id1 = memberMap[p1.toLowerCase()] || "";
        const id2 = memberMap[p2.toLowerCase()] || "";
        pairs.push([id1, id2]);
      }
    }
  }

  safeLog(`Generated ${pairs.length} new pairings`);

  if (!pairs.length) {
    safeLog("No pairings to save.");
    return;
  }

  // --- Save to Previous Pairings sheet
  try {
    const startRow = pairingsSheet.getLastRow() + 1;

    const rows = pairs.map(([p1, p2], i) => {
      const row = startRow + i;
      return [
        p1, // Player 1 ID
        p2, // Player 2 ID
        `=IF(A${row}<>"", INDEX('Discord Member List'!B:B, MATCH(A${row}, 'Discord Member List'!C:C, 0)), "")`, // Player 1 Username
        `=IF(B${row}<>"", INDEX('Discord Member List'!B:B, MATCH(B${row}, 'Discord Member List'!C:C, 0)), "")` // Player 2 Username
      ];
    });

    pairingsSheet.getRange(startRow, 1, rows.length, 4).setValues(rows);
    safeLog(`✅ Saved ${rows.length} pairings for Round #${round}`);

  } catch (e) {
    safeLog(`❌ Error saving pairings: ${e.message}`);
  }
}

function extractNewPairs(teams, safeLog) {
  // 🔍 Log full team composition before processing
  safeLog(`extractNewPairs called with ${teams.length} teams`);
  teams.forEach((team, idx) => {
    const players = team.map(p => `${p.name} (${p.id}, ${p.region})`);
    safeLog(`Team ${idx + 1}: ${players.join(" | ")}`);
  });

  const pairs = [];
  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const p1 = team[i];
        const p2 = team[j];
        if (p1.region === 'Filler' || p2.region === 'Filler') continue;
        pairs.push([p1.id, p2.id]);
      }
    }
  }

  safeLog(`extractNewPairs generated ${pairs.length} pairs`);
  safeLog(`Pairs: ${JSON.stringify(pairs)}`);

  return pairs;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getDuplicatePairings(player, team, previousPairings) {
  const dupes = [];
  for (const teammate of team) {
    if (teammate === player || teammate.region === "Filler") continue;
    const key = pairKey(player, teammate);
    if (previousPairings.has(key)) dupes.push(`${player.name}–${teammate.name}`);
  }
  return dupes;
}


function regionSwapAllowed(playerA, playerB) {
  return !(playerA.region === "East" && playerB.region === "West") &&
         !(playerA.region === "West" && playerB.region === "East");
}

function regionTeamValid(teamArray) {
  const regions = teamArray.map(p => p.region).filter(r => r !== "Filler");
  return !(regions.includes("East") && regions.includes("West"));
}

function hasAvoidConflict(teamArray, avoidPairings) {
  for (let i = 0; i < teamArray.length; i++) {
    for (let j = i + 1; j < teamArray.length; j++) {
      if (avoidPairings.has(pairKey(teamArray[i], teamArray[j]))) return true;
    }
  }
  return false;
}

//Command
function infoCheck({ userId }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Discord Member List");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Discord Member List sheet not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService.createTextOutput(JSON.stringify({ error: "No members found in the sheet." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Grab columns A–F (6 columns total, headers in row 1)
  const members = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  // Find the row where column C (index 2) matches userId (Discord ID moved to column C)
  const user = members.find(row => row[2] == userId);

  if (!user) {
    return ContentService.createTextOutput(JSON.stringify({ error: "User not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Return region (now column D), steam ID (E), and stream link (F)
  const result = {
    region: user[3],
    steamCode: user[4],
    streamLink: user[5]
  };

  return ContentService.createTextOutput(JSON.stringify(result))
                       .setMimeType(ContentService.MimeType.JSON);
}

function replacePlayers({ round, removePlayer, addPlayer }) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reactedSheet = ss.getSheetByName("Players That Reacted");
  const discordSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");

  function log(message) {
    console.log(message);
    if (logSheet) logSheet.appendRow([new Date(), message]);
  }

  log(`replacePlayers called with round="${round}", removePlayer=${JSON.stringify(removePlayer)}, addPlayer=${JSON.stringify(addPlayer)}`);

  if (!reactedSheet || !discordSheet) {
    const missingSheet = !reactedSheet ? "Players That Reacted" : "Discord Member List";
    log(`${missingSheet} sheet not found.`);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: `${missingSheet} sheet not found.`, type: "sheet_missing" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Build member map (non-fillers)
  const discordData = discordSheet.getRange(2, 1, discordSheet.getLastRow() - 1, 6).getValues();
  const memberMap = {};
  discordData.forEach(row => {
    const username = row[1]; // Username is now column B (index 1)
    const region = row[3];
    if (username) memberMap[username] = `${username} (${region})`;
  });

  // --- Resolve remove target ---
  let removeFull;
  if (removePlayer.filler) {
    const num = parseInt(removePlayer.username.replace(/\D/g, ""), 10);
    if (isNaN(num)) {
      log(`Invalid filler number for remove: ${removePlayer.username}`);
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: `Invalid filler number: "${removePlayer.username}"`,
        type: "invalid_filler"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    removeFull = `Filler #${num}`;
  } else {
    if (!memberMap[removePlayer.username]) {
      log(`Remove player not found: ${removePlayer.username}`);
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: `Remove player "${removePlayer.username}" not found.`,
        type: "player_not_found",
        missing: { removeMissing: true, addMissing: false }
      })).setMimeType(ContentService.MimeType.JSON);
    }
    removeFull = memberMap[removePlayer.username];
  }

  // --- Resolve add target ---
  let addFull;
  if (addPlayer.filler) {
    const num = parseInt(addPlayer.username.replace(/\D/g, ""), 10);
    if (isNaN(num)) {
      log(`Invalid filler number for add: ${addPlayer.username}`);
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: `Invalid filler number: "${addPlayer.username}"`,
        type: "invalid_filler"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    addFull = `Filler #${num}`;
  } else {
    if (!memberMap[addPlayer.username]) {
      log(`Add player not found: ${addPlayer.username}`);
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: `Add player "${addPlayer.username}" not found.`,
        type: "player_not_found",
        missing: { removeMissing: false, addMissing: true }
      })).setMimeType(ContentService.MimeType.JSON);
    }
    addFull = memberMap[addPlayer.username];
  }

  log(`Resolved names: remove="${removeFull}", add="${addFull}"`);

  // --- Find round column ---
  const headers = reactedSheet.getRange(1, 1, 1, reactedSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    log(`Round header not found: ${roundHeader}`);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: `Round "${round}" not found.`, type: "round_missing" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  log(`Round column found at index ${roundColIndex} (1-based column: ${roundColIndex + 1})`);

  // --- Get round values ---
  const roundValues = reactedSheet.getRange(2, roundColIndex + 1, reactedSheet.getLastRow() - 1, 1).getValues().flat();

  // --- Duplicate check ---
  if (roundValues.some(val => val && addPlayer.filler
        ? val.toLowerCase().startsWith(addFull.toLowerCase())
        : val === addFull)) {
    log(`Duplicate detected: "${addFull}" is already in Round #${round}`);
    try { if (typeof repostTeamsPreview === "function") repostTeamsPreview(round, log); } catch (e) { log(`Error repostTeamsPreview: ${e.message}`); }
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: `"${addFull}" is already in Round #${round}`,
      type: "duplicate",
      player: addFull,
      round
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // --- Find remove row ---
  const rowIndex = removePlayer.filler
    ? roundValues.findIndex(val => val && val.toLowerCase().startsWith(removeFull.toLowerCase()))
    : roundValues.findIndex(val => val === removeFull);

  if (rowIndex === -1) {
    log(`Remove target "${removeFull}" not found in Round #${round}`);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: `"${removeFull}" not found in Round #${round}`,
      type: "remove_not_found",
      player: removeFull,
      round
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // --- Replace in round column and update Column B on same row ---
  const newValue = addPlayer.filler ? `${addFull} (Filler)` : addFull;
  roundValues[rowIndex] = newValue;

  reactedSheet.getRange(2, roundColIndex + 1, roundValues.length, 1).setValues(roundValues.map(v => [v]));
  reactedSheet.getRange(rowIndex + 2, 2).setValue(newValue); // Column B same row

  log(`Round #${round} updated successfully.`);

  // --- Trigger repostTeamsPreview ---
  try {
    if (typeof repostTeamsPreview === "function") {
      repostTeamsPreview(round, log);
      log(`repostTeamsPreview triggered successfully for Round #${round}`);
    }
  } catch (e) {
    log(`Error repostTeamsPreview: ${e.message}`);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    type: "success",
    round,
    removed: removeFull,
    added: newValue,
    roundValues
  })).setMimeType(ContentService.MimeType.JSON);
}

function swapPlayers(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reactedSheet = ss.getSheetByName("Players That Reacted");
  const discordSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");

  function log(message) {
    console.log(message);
    if (logSheet) logSheet.appendRow([new Date(), message]);
  }

  // --- Log raw input first ---
  log(`swapPlayers called. RAW INPUT: ${JSON.stringify(data)}`);

  const round = data?.round;
  const swaps = Array.isArray(data?.swaps) ? data.swaps : [];

  if (!round || swaps.length === 0) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: "Missing round or swaps array in request." })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (!reactedSheet || !discordSheet) {
    log("Required sheets not found.");
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: "Required sheets not found." })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // --- Build member map for full names with regions ---
  const discordData = discordSheet.getRange(2, 1, discordSheet.getLastRow() - 1, 6).getValues();
  const memberMap = {};
  discordData.forEach(row => {
    const username = row[1]; // Column B = Username
    const region = row[3];   // Column D = Region (moved)
    if (username) memberMap[username] = `${username} (${region})`;
  });

  // --- Find round column ---
  const headers = reactedSheet.getRange(1, 1, 1, reactedSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);

  if (roundColIndex === -1) {
    log(`Round header not found: ${roundHeader}`);
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: `Round "${round}" not found.` })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  log(`Round column found at index ${roundColIndex} (1-based col: ${roundColIndex + 1})`);

  // --- Get values for round column + column B ---
  const roundValues = reactedSheet.getRange(2, roundColIndex + 1, reactedSheet.getLastRow() - 1, 1).getValues().flat();
  const colBValues = reactedSheet.getRange(2, 2, reactedSheet.getLastRow() - 1, 1).getValues();

  log(`Round values before swaps: ${JSON.stringify(roundValues)}`);

  // --- Track results per swap ---
  const results = [];

  swaps.forEach((swap, i) => {
    const p1Full = memberMap[swap.player1?.username];
    const p2Full = memberMap[swap.player2?.username];
    const pair = [swap.player1?.username, swap.player2?.username];

    if (!p1Full || !p2Full) {
      const reason = "One or both players not in Discord Member List";
      log(`Swap #${i+1}: ❌ Failed - ${reason}. Pair=${pair.join(" ↔ ")}`);
      results.push({ pair, status: "failed", reason });
      return;
    }

    log(`Swap #${i+1}: Full names: ${p1Full} ↔ ${p2Full}`);

    const idx1 = roundValues.findIndex(val => val === p1Full);
    const idx2 = roundValues.findIndex(val => val === p2Full);

    if (idx1 === -1 || idx2 === -1) {
      const reason = `Player(s) not found in Round #${round}`;
      log(`Swap #${i+1}: ❌ Failed - ${reason}. idx1=${idx1}, idx2=${idx2}`);
      results.push({ pair, status: "failed", reason });
      return;
    }

    // Perform the swap
    [roundValues[idx1], roundValues[idx2]] = [roundValues[idx2], roundValues[idx1]];
    [colBValues[idx1][0], colBValues[idx2][0]] = [colBValues[idx2][0], colBValues[idx1][0]];

    log(`Swap #${i+1}: ✅ Completed successfully.`);
    results.push({ pair, status: "ok" });
  });

  // --- Save updates only if at least one succeeded ---
  if (results.some(r => r.status === "ok")) {
    reactedSheet.getRange(2, roundColIndex + 1, roundValues.length, 1).setValues(roundValues.map(v => [v]));
    reactedSheet.getRange(2, 2, colBValues.length, 1).setValues(colBValues);
    log(`All successful swaps applied. Final round values: ${JSON.stringify(roundValues)}`);
  } else {
    log("No successful swaps to apply.");
  }

  // --- Trigger repostTeamsPreview ---
  try {
    if (typeof repostTeamsPreview === "function") {
      repostTeamsPreview(round, log);
      log(`repostTeamsPreview triggered successfully for Round #${round}`);
    } else {
      log("repostTeamsPreview function not found.");
    }
  } catch (e) {
    log(`Error triggering repostTeamsPreview: ${e.message}`);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: results.some(r => r.status === "ok"),
    results
  })).setMimeType(ContentService.MimeType.JSON);
}

function memberUpdate(data) {
  const timestamp = new Date().toISOString();

  // Step 1: Validate input
  if (!data.memberData || !Array.isArray(data.memberData)) {
    logErrorToSheet('Error: Invalid or missing memberData array in data.');
    throw new Error('Invalid or missing memberData array in data.');
  }

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName("Discord Member List");

    // Step 2: Ensure correct headers (Nickname in A, Username in B, Discord ID in C)
    const requiredHeaders = ["Nickname", "Username", "Discord ID", "Region", "Steam ID", "Stream Link"];
    const existingHeaders = sheet.getRange(1, 1, 1, requiredHeaders.length).getValues()[0];

    if (JSON.stringify(existingHeaders) !== JSON.stringify(requiredHeaders)) {
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    }

    // Step 3: Get current data (excluding headers)
    const lastRow = sheet.getLastRow();
    const existingData = lastRow > 1 
      ? sheet.getRange(2, 1, lastRow - 1, requiredHeaders.length).getValues()
      : [];

    // Step 4: Prepare new or updated rows
    const memberData = data.memberData;
    const dataToInsert = [];

    memberData.forEach(row => {
      // Skip header row if sent
      if (JSON.stringify(row.slice(0, 2)) === JSON.stringify(requiredHeaders.slice(0, 2))) return;

      // Ensure row has at least 3 columns (Nickname, Username, Discord ID)
      while (row.length < 3) row.push("");

      // Check if Discord ID already exists (Discord ID moved to index 2)
      const existingIndex = existingData.findIndex(existingRow => existingRow[2] === row[2]);

      if (existingIndex !== -1) {
        // Preserve existing region if it exists, otherwise use incoming or default to "Both"
          const existingRegion = existingData[existingIndex][3];
          row[3] = existingRegion && existingRegion.trim() !== "" ? existingRegion : (row[3] || "Both");

        // Update existing row
        sheet.getRange(existingIndex + 2, 1, 1, requiredHeaders.length).setValues([row]);
      } else {
        // New row: default region to "Both" if missing
        if (!row[3] || row[3].trim() === "") row[3] = "Both";
        dataToInsert.push(row);
      }
    });

    // Step 5: Insert new members at the bottom
    if (dataToInsert.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, dataToInsert.length, requiredHeaders.length)
           .setValues(dataToInsert);
    }

    // Step 6: Sort by Username (Column B)
    if (sheet.getLastRow() > 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
           .sort({ column: 2, ascending: true });
    }

    return ContentService.createTextOutput("✅ Member list successfully updated.")
                         .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    logErrorToSheet("Error in memberUpdate: " + error.message);
    return ContentService.createTextOutput("Error: " + error.message)
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function updatePlayerField(data) {
  const timestamp = new Date().toISOString();
  logToSheet(`[${timestamp}] updatePlayerField called with data: ${JSON.stringify(data)}`);

  const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName('Discord Member List');
  if (!sheet) {
    throw new Error('Sheet "Discord Member List" not found.');
  }

  const [userId, field, newValue] = data.updateData[0];
  const values = sheet.getDataRange().getValues();

  // Column index mapping (0-based)
  const fieldMap = {
    region: 2,      // Column C
    steamid: 4,     // Column E
    streamlink: 5   // Column F
  };

  const colIndex = fieldMap[field.toLowerCase()];
  if (colIndex === undefined) {
    throw new Error(`Invalid field: ${field}`);
  }

  const rowIndex = values.findIndex(row => row[2] == userId); // Discord ID is column C (index 2)
  if (rowIndex === -1) {
    throw new Error(`User with ID ${userId} not found.`);
  }

  sheet.getRange(rowIndex + 1, colIndex + 1).setValue(newValue); // Adjust for 1-based index
  logToSheet(`[${timestamp}] Updated ${field} for user ${userId} to "${newValue}"`);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: `${field} updated.` }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function register(data) {
  const timestamp = new Date().toISOString();

  // Step 1: Validate data
  if (!data.registerData || !Array.isArray(data.registerData)) {
    const msg = 'Invalid or missing registerData array in data.';
    logErrorToSheet(`[${timestamp}] ❌ ${msg}`);
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: msg })
    ).setMimeType(ContentService.MimeType.JSON);
  } else {
    logToSheet(`[${timestamp}] ✅ Received valid registerData array.`);
  }

  logToSheet(`[${timestamp}] registerData: ${JSON.stringify(data.registerData)}`);

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName("Discord Member List");

    // Step 2: Set headers if missing
    const headers = ["Nickname", "Username", "Discord ID", "Region", "Steam ID", "Stream Link"];
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    const existingHeaders = headerRange.getValues()[0];

    if (!existingHeaders.every((header, index) => header === headers[index])) {
      headerRange.setValues([headers]);
      logToSheet(`[${timestamp}] ✅ Headers were set or corrected.`);
    }

    // Step 3: Insert or update data
    const registerData = data.registerData;
    const lastRow = sheet.getLastRow();
    const existingData = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
      : [];

    registerData.forEach((row) => {
      if (row.length !== headers.length) {
        logErrorToSheet(`[${timestamp}] ❌ Invalid row data: ${JSON.stringify(row)}`);
        return;
      }

      const discordId = row[2]; // Discord ID is column C / index 2 (moved)
      const existingIndex = existingData.findIndex(existingRow => existingRow[2] === discordId);

      if (existingIndex !== -1) {
        // Update existing entry
        sheet.getRange(existingIndex + 2, 1, 1, row.length).setValues([row]);
        logToSheet(`[${timestamp}] 🔄 Updated existing member: ${row[1]}`);
      } else {
        // Add new entry
        sheet.appendRow(row);
        logToSheet(`[${timestamp}] ➕ Added new member: ${row[1]}`);
      }
    });

    // Step 4: Sort data by Username (Column B, index 2)
    const updatedLastRow = sheet.getLastRow();
    if (updatedLastRow > 1) {
      sheet.getRange(2, 1, updatedLastRow - 1, headers.length)
           .sort({ column: 2, ascending: true });
      logToSheet(`[${timestamp}] ✅ Data sorted by Username.`);
    }

    // ✅ SUCCESS RESPONSE
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, message: "Member list successfully updated." })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    logErrorToSheet("Error in register: " + error.message);

    // ❌ FAILURE RESPONSE
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: error.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function avoidPairings(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const avoidSheet = ss.getSheetByName("Avoid Pairings");
  const discordSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");

  function log(message) {
    console.log(message);
    if (logSheet) logSheet.appendRow([new Date(), message]);
  }

  log(`avoidPairings called. RAW INPUT: ${JSON.stringify(data)}`);

  const users = Array.isArray(data?.users) ? data.users : [];
  if (users.length < 2) {
    log("Error: At least 2 users are required.");
    return ContentService.createTextOutput(JSON.stringify({ error: "At least 2 users required." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  if (!avoidSheet || !discordSheet) {
    log("Required sheets not found.");
    return ContentService.createTextOutput(JSON.stringify({ error: "Required sheets not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // --- Fetch existing pairs ---
  const lastRow = Math.max(avoidSheet.getLastRow(), 1);
  const existingPairs = avoidSheet.getRange(1, 1, lastRow, 2).getValues()
    .map(row => [row[0]?.toString(), row[1]?.toString()]);

  let addedCount = 0;
  let skippedCount = 0;
  const newRows = [];

  const firstUser = users[0];

  for (let i = 1; i < users.length; i++) {
    const userA = firstUser.id.toString();
    const userB = users[i].id.toString();

    // --- Check if pair exists in either order ---
    const exists = existingPairs.some(([a, b]) =>
      (a === userA && b === userB) || (a === userB && b === userA)
    );

    if (exists) {
      log(`Pair skipped (already exists): ${userA} =/ ${userB}`);
      skippedCount++;
      continue;
    }

    // --- Prepare formulas for columns C and D ---
    const newRowIndex = avoidSheet.getLastRow() + newRows.length + 1;
      const colCFormula = `=IF(A${newRowIndex}<>"", INDEX('Discord Member List'!B:B, MATCH(A${newRowIndex}, 'Discord Member List'!C:C, 0)), "")`;
      const colDFormula = `=IF(B${newRowIndex}<>"", INDEX('Discord Member List'!B:B, MATCH(B${newRowIndex}, 'Discord Member List'!C:C, 0)), "")`;

    newRows.push([userA, userB, colCFormula, colDFormula]);
    log(`Pair added: ${userA} =/ ${userB}`);
    addedCount++;
  }

  if (newRows.length > 0) {
    avoidSheet.getRange(avoidSheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }

  log(`Avoid Pairings update complete. Added: ${addedCount}, Skipped: ${skippedCount}`);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    addedPairs: addedCount,
    skippedPairs: skippedCount
  })).setMimeType(ContentService.MimeType.JSON);
}

function unavoidPairings(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const avoidSheet = ss.getSheetByName("Avoid Pairings");
  const discordSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");

  function log(message) {
    console.log(message);
    if (logSheet) logSheet.appendRow([new Date(), message]);
  }

  log(`unavoidPairings called. RAW INPUT: ${JSON.stringify(data)}`);

  const users = Array.isArray(data?.users) ? data.users : [];
  if (users.length < 2) {
    log("Error: At least 2 users are required.");
    return ContentService.createTextOutput(JSON.stringify({ error: "At least 2 users required." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  if (!avoidSheet || !discordSheet) {
    log("Required sheets not found.");
    return ContentService.createTextOutput(JSON.stringify({ error: "Required sheets not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const userA = users[0].id.toString();
  const userB = users[1].id.toString();

  const lastRow = Math.max(avoidSheet.getLastRow(), 1);
  const existingPairs = avoidSheet.getRange(1, 1, lastRow, 2).getValues()
    .map((row, i) => ({ a: row[0]?.toString(), b: row[1]?.toString(), rowNum: i + 1 }));

  let removedCount = 0;
  let skippedCount = 0;
  const rowsToDelete = [];

  // --- Find matching pairs (both directions) ---
  existingPairs.forEach(pair => {
    if ((pair.a === userA && pair.b === userB) || (pair.a === userB && pair.b === userA)) {
      rowsToDelete.push(pair.rowNum);
    }
  });

  if (rowsToDelete.length > 0) {
    // Sort descending before deleting to avoid shifting row indices
    rowsToDelete.sort((a, b) => b - a);
    rowsToDelete.forEach(rowNum => {
      avoidSheet.deleteRow(rowNum);
      removedCount++;
      log(`Pair removed: ${userA} <-> ${userB} (Row ${rowNum})`);
    });
  } else {
    skippedCount++;
    log(`No matching pair found for: ${userA} <-> ${userB}`);
  }

  log(`Unavoid Pairings complete. Removed: ${removedCount}, Skipped: ${skippedCount}`);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    removedPairs: removedCount,
    skippedPairs: skippedCount
  })).setMimeType(ContentService.MimeType.JSON);
}

function avoidList(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const avoidSheet = ss.getSheetByName("Avoid Pairings");
  const logSheet = ss.getSheetByName("Logs");

  function log(message) {
    console.log(message);
    if (logSheet) logSheet.appendRow([new Date(), message]);
  }

  log(`avoidList called. RAW INPUT: ${JSON.stringify(data)}`);

  if (!avoidSheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Sheet not found" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = avoidSheet.getLastRow();
  if (lastRow < 1) {
    return ContentService.createTextOutput(JSON.stringify({ success: true, pairs: [] }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const values = avoidSheet.getRange(1, 1, lastRow, 4).getValues(); // A–D
  let pairs = [];

  if (data.userId) {
    // Filter for specific user ID (check both A and B)
    const userId = data.userId.toString();
    pairs = values
      .filter(r => r[0] && r[1] && (r[0].toString() === userId || r[1].toString() === userId))
      .map(r => [r[2] || r[0], r[3] || r[1]]);
    log(`Found ${pairs.length} avoid pairs for userId ${userId}`);
  } else {
    // Return ALL rows with valid names
    pairs = values.filter(r => r[2] && r[3]).map(r => [r[2], r[3]]);
    log(`Returning all avoid pairs: ${pairs.length} entries.`);
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true, pairs }))
                       .setMimeType(ContentService.MimeType.JSON);
}