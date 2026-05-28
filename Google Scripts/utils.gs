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
    const text = typeof message === 'string' ? message : JSON.stringify(message);

    if (spreadsheetId) {
      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        const logSheet = ss.getSheetByName('Logs');
        if (logSheet) logSheet.appendRow([timestamp, text]);
      } catch (e) {
        // Fall through to console logging if sheet write fails
        console.log(`[LOG] (sheet write failed) ${text} - ${e.message}`);
      }
    } else {
      console.log(`[LOG] ${text}`);
    }
  } catch (e) {
    console.log(`[LOG] ${message} - logging failed: ${e.message}`);
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
  const members = sheet.getRange(2, 1, Math.max(lastRow - 1, 0), 6).getValues();

  // Find the row where column C (index 2) matches userId
  const user = members.find(row => row[2] == userId);

  if (!user) {
    return ContentService.createTextOutput(JSON.stringify({ error: "User not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Return region (D), steam ID (E), and stream link (F)
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

  // Build member map (non-fillers) using new layout A–F: Nickname, Username, Discord ID, Region, Steam ID, Stream Link
  const discordData = discordSheet.getRange(2, 1, Math.max(discordSheet.getLastRow() - 1, 0), 6).getValues();
  const memberMap = {};
  discordData.forEach(row => {
    const nickname = row[0];
    const username = row[1];
    const region = row[3];
    if (username) memberMap[username] = `${username} (${region})`;
    if (nickname && !memberMap[nickname]) memberMap[nickname] = `${nickname} (${region})`;
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

  // --- Build member map for full names with regions (A–F layout)
  const discordData = discordSheet.getRange(2, 1, Math.max(discordSheet.getLastRow() - 1, 0), 6).getValues();
  const memberMap = {};
  discordData.forEach(row => {
    const nickname = row[0]; // Column A = Nickname
    const username = row[1]; // Column B = Username
    const region = row[3];   // Column D = Region
    if (username) memberMap[username] = `${username} (${region})`;
    if (nickname && !memberMap[nickname]) memberMap[nickname] = `${nickname} (${region})`;
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

  if (!data.memberData || !Array.isArray(data.memberData)) {
    logErrorToSheet('Error: Invalid or missing memberData array in data.');
    throw new Error('Invalid or missing memberData array in data.');
  }

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName("Discord Member List");
    if (!sheet) throw new Error('Discord Member List sheet not found.');

    // Desired headers for the new layout
    const requiredHeaders = ["Nickname", "Username", "Discord ID", "Region", "Steam ID", "Stream Link"];
    const existingHeaders = sheet.getRange(1, 1, 1, requiredHeaders.length).getValues()[0];
    if (JSON.stringify(existingHeaders) !== JSON.stringify(requiredHeaders)) {
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    }

    // Read existing rows
    const lastRow = sheet.getLastRow();
    const existingData = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, requiredHeaders.length).getValues()
      : [];

    const memberData = data.memberData;
    const dataToInsert = [];

    memberData.forEach(rawRow => {
      // Skip header rows if present
      if (Array.isArray(rawRow) && rawRow.length >= 2 && String(rawRow[0]).trim() === requiredHeaders[0] && String(rawRow[1]).trim() === requiredHeaders[1]) return;

      let row = Array.isArray(rawRow) ? rawRow.slice() : [String(rawRow)];

      // Normalize various incoming shapes to 6 columns:
      // - New bot format: [Nickname, Username, DiscordID]
      // - Legacy: [Username, DiscordID, Region] or 5-col
      // - Full 6-col: [Nickname, Username, DiscordID, Region, Steam, Stream]

      // If there's a leading empty cell and data is shifted right, shift left
      if ((row[0] === '' || row[0] === null) && (/#\d{4}$/.test(String(row[1] || '')) || /^\d{16,}$/.test(String(row[2] || '')))) {
        row = [row[1] || '', row[2] || '', row[3] || '', row[4] || 'Both', row[5] || '', row[6] || ''];
      }

      if (row.length === 3) {
        const maybeId = String(row[2] || '');
        if (/^\d{16,}$/.test(maybeId)) {
          // [Nickname, Username, DiscordID]
          row = [row[0] || '', row[1] || '', row[2] || '', 'Both', '', ''];
        } else {
          // [Username, DiscordID, Region]
          row = ['', row[0] || '', row[1] || '', row[2] || 'Both', '', ''];
        }
      } else if (row.length === 5) {
        // [username, discordId, region, steam, stream] -> ['', username, discordId, region, steam, stream]
        row = ['', row[0], row[1], row[2], row[3], row[4]];
      } else if (row.length < 6) {
        while (row.length < 6) row.push('');
      }

      // Ensure Discord ID field exists
      const discordId = String(row[2] || '').trim();
      // Find existing by Discord ID (column C / index 2)
      const existingIndex = existingData.findIndex(r => String(r[2] || '').trim() === discordId && discordId !== '');

      if (existingIndex !== -1) {
        // Preserve existing Region/Steam/Stream (columns D-F) unless incoming row provides non-empty values
        const existingRow = existingData[existingIndex] || [];
        row[3] = (row[3] && String(row[3]).trim() !== '') ? row[3] : (existingRow[3] || 'Both');
        row[4] = (row[4] && String(row[4]).trim() !== '') ? row[4] : (existingRow[4] || '');
        row[5] = (row[5] && String(row[5]).trim() !== '') ? row[5] : (existingRow[5] || '');

        // Update the whole 6-column row, preserving linked data
        sheet.getRange(existingIndex + 2, 1, 1, requiredHeaders.length).setValues([row]);
      } else {
        // New row defaults
        if (!row[3] || String(row[3]).trim() === '') row[3] = 'Both';
        dataToInsert.push(row);
      }
    });

    if (dataToInsert.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, dataToInsert.length, requiredHeaders.length).setValues(dataToInsert);
    }

    // Sort by Username (Column B = 2)
    if (sheet.getLastRow() > 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 2, ascending: true });
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Member list successfully updated.' })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    logErrorToSheet("Error in memberUpdate: " + error.message);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message })).setMimeType(ContentService.MimeType.JSON);
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
    region: 3,      // Column D
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

    // Step 2: Set headers if missing (A–F)
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

      const discordId = row[2]; // Discord ID is column C / index 2
      const existingIndex = existingData.findIndex(existingRow => existingRow[2] === discordId);

      if (existingIndex !== -1) {
        // Update existing entry
        sheet.getRange(existingIndex + 2, 1, 1, row.length).setValues([row]);
        logToSheet(`[${timestamp}] 🔄 Updated existing member: ${row[0]}`);
      } else {
        // Add new entry
        sheet.appendRow(row);
        logToSheet(`[${timestamp}] ➕ Added new member: ${row[0]}`);
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
    const colCFormula = `=IF(A${newRowIndex}<>'', INDEX('Discord Member List'!B:B, MATCH(A${newRowIndex}, 'Discord Member List'!C:C, 0)), '')`;
    const colDFormula = `=IF(B${newRowIndex}<>'', INDEX('Discord Member List'!B:B, MATCH(B${newRowIndex}, 'Discord Member List'!C:C, 0)), '')`;

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

// Append a Discord user's data to the 'TEST' sheet in column A (next empty row)
function appendDiscordUser(data) {
  try {
    if (!data || !data.user) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Missing user data' })).setMimeType(ContentService.MimeType.JSON);
    }

    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Spreadsheet ID not set' })).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('TEST');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Sheet 'TEST' not found" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Normalize user data into a single string for column A
    const u = data.user;
    const parts = [];
    if (u.id) parts.push(`id:${u.id}`);
    if (u.username) parts.push(`username:${u.username}`);
    if (u.discriminator) parts.push(`disc:${u.discriminator}`);
    if (u.tag) parts.push(`tag:${u.tag}`);
    if (u.displayName) parts.push(`display:${u.displayName}`);
    if (u.nick) parts.push(`nick:${u.nick}`);
    if (u.isBot !== undefined) parts.push(`bot:${u.isBot}`);
    if (u.avatarURL) parts.push(`avatar:${u.avatarURL}`);
    if (u.createdAt) parts.push(`created:${u.createdAt}`);
    if (u.joinedAt) parts.push(`joined:${u.joinedAt}`);
    if (u.roles && Array.isArray(u.roles) && u.roles.length) parts.push(`roles:${u.roles.join('|')}`);

    const line = parts.join(' | ');

    sheet.appendRow([line]);

    return ContentService.createTextOutput(JSON.stringify({ success: true, written: line })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logErrorToSheet(`appendDiscordUser error: ${err.message}`);
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}