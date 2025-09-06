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
  return [a, b].sort().join('|');
}

function groupPlayersByRegion(players, safeLog) {
  safeLog("Starting groupPlayersByRegion script");
  return {
    East: players.filter(p => p.region === 'East'),
    West: players.filter(p => p.region === 'West'),
    Both: players.filter(p => p.region === 'Both')
  };
}

function saveNewPairings(pairingsSheet, pairs, logSheet = null) {
  if (!pairs.length) return;

  try {
    const rows = pairs.map(([p1, p2]) => [p1, p2]);
    pairingsSheet.getRange(pairingsSheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
    if (logSheet) logSheet.appendRow([`Saved ${rows.length} new pairings.`, new Date()]);
  } catch (e) {
    if (logSheet) logSheet.appendRow([`Error saving pairings: ${e.message}`, new Date()]);
  }
}

function extractNewPairs(teams) {
  const pairs = [];
  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const p1 = team[i];
        const p2 = team[j];
        if (p1.region === 'Filler' || p2.region === 'Filler') continue;
        pairs.push([p1.username, p2.username]);
      }
    }
  }
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
    const key = pairKey(player.username, teammate.username);
    if (previousPairings.has(key)) dupes.push(`${player.username}–${teammate.username}`);
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
      if (avoidPairings.has(pairKey(teamArray[i].username, teamArray[j].username))) return true;
    }
  }
  return false;
}


//Command
function approveTeams({ round }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  const teams = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();

  const rowIndex = teams.findIndex(row => row[0] == round);
  if (rowIndex === -1) return ContentService.createTextOutput(JSON.stringify({ error: "Team set not found." }));

  sheet.getRange(rowIndex + 2, 6).setValue("Approved");
  return ContentService.createTextOutput(JSON.stringify({ success: true }));
}

function infoCheck({ userId }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Discord Member List");

  // Grab columns A–F (6 columns total, assuming headers in row 1)
  const members = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();

  // Find the row where column C (index 2) matches userId
  const user = members.find(row => row[2] == userId);

  if (!user) {
    return ContentService.createTextOutput(JSON.stringify({ error: "User not found." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return region (D), steam code (E), and stream link (F)
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

  log(`replacePlayers called with round="${round}", removePlayer="${removePlayer}", addPlayer="${addPlayer}"`);

  if (!reactedSheet) {
    log("Players That Reacted sheet not found.");
    return ContentService.createTextOutput(JSON.stringify({ error: "Players That Reacted sheet not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  if (!discordSheet) {
    log("Discord Member List sheet not found.");
    return ContentService.createTextOutput(JSON.stringify({ error: "Discord Member List sheet not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Build full names with region from Discord Member List
  const discordData = discordSheet.getRange(2, 2, discordSheet.getLastRow() - 1, 3).getValues(); // Columns B-D
  const memberMap = {};
  discordData.forEach(row => {
    const name = row[0];
    const region = row[2]; // Column D is index 2
    if (name) memberMap[name] = `${name} (${region})`;
  });

  if (!memberMap[removePlayer] || !memberMap[addPlayer]) {
    log(`Error: One or both players not found. removePlayer="${removePlayer}", addPlayer="${addPlayer}"`);
    return ContentService.createTextOutput(JSON.stringify({ error: "One or both players not found in Discord Member List." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const removeFull = memberMap[removePlayer];
  const addFull = memberMap[addPlayer];
  log(`Full names with regions: remove="${removeFull}", add="${addFull}"`);

  // Get headers from Players That Reacted
  const headers = reactedSheet.getRange(1, 1, 1, reactedSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    log(`Round header not found: ${roundHeader}`);
    return ContentService.createTextOutput(JSON.stringify({ error: `Round "${round}" not found.` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  log(`Round column found at index ${roundColIndex} (1-based column: ${roundColIndex + 1})`);

  // Get all values in that round column (skip header)
  const roundValues = reactedSheet.getRange(2, roundColIndex + 1, reactedSheet.getLastRow() - 1, 1).getValues().flat();

  // Find removePlayer in the round column
  const rowIndex = roundValues.findIndex(val => val === removeFull);
  if (rowIndex === -1) {
    log(`Player "${removeFull}" not found in Round #${round}`);
    return ContentService.createTextOutput(JSON.stringify({ error: `"${removePlayer}" not found in Round #${round}` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Log exact cell for round column
  const roundCellRef = `R${rowIndex + 2}C${roundColIndex + 1}`;
  log(`Replacing "${removeFull}" with "${addFull}" at round column cell ${roundCellRef}`);

  // Replace the player in round column
  roundValues[rowIndex] = addFull;
  reactedSheet.getRange(2, roundColIndex + 1, roundValues.length, 1).setValues(roundValues.map(v => [v]));

  // Also replace in column 2 (Discord Member List column) same row with plain name
  const col2CellRef = `R${rowIndex + 2}C2`;
  log(`Also updating column 2 cell ${col2CellRef} with "${addPlayer}"`);
  reactedSheet.getRange(rowIndex + 2, 2).setValue(addPlayer);

  log(`Round #${round} column and column 2 updated successfully.`);

  return ContentService.createTextOutput(JSON.stringify({ success: true, roundValues: roundValues }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function swapPlayers({ round, player1, player2 }) {
  const spreadsheetId = getSpreadsheetId();
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Teams");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Teams sheet not found." }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Construct header to match "Round #<number>"
  const targetHeader = `Round #${round}`;

  // Get all headers (assumes first row contains round names)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const roundIndex = headers.findIndex(h => h === targetHeader);

  if (roundIndex === -1) {
    return ContentService.createTextOutput(JSON.stringify({ error: `Round "${round}" not found.` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Get all player values in that round (excluding header row)
  const playerValues = sheet.getRange(2, roundIndex + 1, sheet.getLastRow() - 1, 1).getValues().flat();

  const idx1 = playerValues.findIndex(p => p === player1);
  const idx2 = playerValues.findIndex(p => p === player2);

  if (idx1 === -1) {
    return ContentService.createTextOutput(JSON.stringify({ error: `"${player1}" not found in round "${round}".` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  if (idx2 === -1) {
    return ContentService.createTextOutput(JSON.stringify({ error: `"${player2}" not found in round "${round}".` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // Swap players
  [playerValues[idx1], playerValues[idx2]] = [playerValues[idx2], playerValues[idx1]];

  // Write updated column back to sheet
  const updatedColumn = playerValues.map(p => [p]); // convert to 2D array
  sheet.getRange(2, roundIndex + 1, updatedColumn.length, 1).setValues(updatedColumn);

  // Optional log
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Swap Log");
  if (logSheet) {
    logSheet.appendRow([new Date(), targetHeader, player1, player2]);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    round: targetHeader,
    updatedColumn: playerValues
  })).setMimeType(ContentService.MimeType.JSON);
}


function memberUpdate(data) {
  const timestamp = new Date().toISOString();

  // Step 1: Validate data
  if (!data.memberData || !Array.isArray(data.memberData)) {
    logErrorToSheet('Error: Invalid or missing memberData array in data.');
    throw new Error('Invalid or missing memberData array in data.');
  }

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName("Discord Member List");
    
    // Step 2: Get current data
    const existingData = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    const headers = existingData[0];

    // Step 3: Prepare data for insertion
    const memberData = data.memberData;
    const dataToInsert = [];

    memberData.forEach((row) => {
      // Skip if matching the header row
      if (JSON.stringify(row) === JSON.stringify(headers)) return;

      // Check if Discord ID already exists
      const existingIndex = existingData.findIndex(existingRow => existingRow[2] === row[2]);

      if (existingIndex !== -1) {
        // Update existing row
        sheet.getRange(existingIndex + 1, 1, 1, row.length).setValues([row]);
      } else {
        // Add to insertion array if not found
        dataToInsert.push(row);
      }
    });

    // Step 4: Insert new data at the bottom
    if (dataToInsert.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, dataToInsert.length, dataToInsert[0].length).setValues(dataToInsert);
    }

    // Step 5: Sort by Username (B column)
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
         .sort({ column: 2, ascending: true });

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

  // Column index mapping (0-based, adjust for 1-based sheet.getRange)
  const fieldMap = {
    region: 3,      // Column D
    steamid: 4,     // Column E
    streamlink: 5   // Column F
  };

  const colIndex = fieldMap[field.toLowerCase()];
  if (colIndex === undefined) {
    throw new Error(`Invalid field: ${field}`);
  }

  const rowIndex = values.findIndex(row => row[2] == userId);
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
    logErrorToSheet('Error: Invalid or missing registerData array in data.');
    throw new Error('Invalid or missing registerData array in data.');
  } else {
    logToSheet(`[${timestamp}] ✅ Received valid registerData array.`);
  }

  // Debug: Log the contents of registerData
  logToSheet(`[${timestamp}] registerData: ${JSON.stringify(data.registerData)}`);

  try {
    const sheet = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName("Discord Member List");
    
    // Step 2: Set headers if missing
    const headers = ["Nickname", "Username", "Discord ID", "Region", "Steam ID", "Stream Link"];
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    const existingHeaders = headerRange.getValues()[0];
    
    // If headers are missing or incorrect, set them
    if (!existingHeaders.every((header, index) => header === headers[index])) {
      headerRange.setValues([headers]);
      logToSheet(`[${timestamp}] ✅ Headers were set or corrected.`);
    }

    // Step 3: Insert new data
    const registerData = data.registerData;
    logToSheet(`[${timestamp}] registerData length: ${registerData.length}`);
    
    const existingData = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

    // Avoid duplicates by checking Discord ID
    registerData.forEach((row) => {
      if (row.length !== headers.length) {
        logErrorToSheet(`[${timestamp}] Invalid row data`);
        return;
      }

      const discordId = row[2]; // Assuming Discord ID is the 3rd element
      const existingIndex = existingData.findIndex(existingRow => existingRow[2] === discordId);

      if (existingIndex !== -1) {
        // Update existing entry
        sheet.getRange(existingIndex + 2, 1, 1, row.length).setValues([row]);
        logToSheet(`[${timestamp}] ✅ Updated existing member: ${row[1]}`);
      } else {
        // Add new entry
        sheet.appendRow(row);
        logToSheet(`[${timestamp}] ✅ Added new member: ${row[1]}`);
      }
    });

    // Step 4: Sort data by Username (Column B, index 2)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, headers.length)
        .sort({ column: 2, ascending: true });
      logToSheet(`[${timestamp}] ✅ Data sorted by Username.`);
    }

    return ContentService.createTextOutput("✅ Member list successfully updated.")
                          .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    logErrorToSheet("Error in register: " + error.message);
    return ContentService.createTextOutput("Error: " + error.message)
                          .setMimeType(ContentService.MimeType.JSON);
  }
}