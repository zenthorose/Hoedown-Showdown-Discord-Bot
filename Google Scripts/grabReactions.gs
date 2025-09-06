/**
 * grabReactions
 * Version: 1.2.0 (self-contained safe logging with toggle)
 * Processes Discord usernames, generates teams, logs all steps safely.
 */
function grabReactions({ discordUsernames }) {
  const SCRIPT_VERSION = "grabReactions v1.2.0";
  const LOG_ENABLED = true; // <-- set to false to disable logs

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Players That Reacted");
  const discordMemberSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");
  const pairingsSheet = ss.getSheetByName("Previous Pairings");
  const avoidPairingsSheet = ss.getSheetByName("Avoid Pairings");

  // Unified safe logging function with toggle
  function safeLog(message) {
    if (!LOG_ENABLED) return;
    if (logSheet && typeof logSheet.appendRow === "function") {
      logSheet.appendRow([`[${new Date()}] ${message}`]);
    } else {
      console.warn(`[${SCRIPT_VERSION}] ${message}`);
    }
  }

  safeLog("Starting grabReactions script");

  // Validate required sheets
  if (!sheet || !discordMemberSheet || !pairingsSheet || !avoidPairingsSheet) {
    safeLog("Required sheets not found.");
    return ContentService.createTextOutput(JSON.stringify({ error: "Required sheets not found." }));
  }

  // Clear previous data in column A only
  sheet.getRange("A2:A").clearContent();

  // Get player data (Username: col B, Discord ID: col C, Region: col D)
  const data = discordMemberSheet.getRange(2, 2, discordMemberSheet.getLastRow() - 1, 3).getValues();
  const playerData = [];

  discordUsernames.map(u => u.trim()).forEach(username => {
    const match = data.find(row => row[0] === username);
    if (match) {
      const [username, discordId, region] = match;
      playerData.push({ username, discordId, region });
    } else {
      safeLog(`Username not found: ${username}`);
    }
  });

  // Post usernames to column A
  playerData.forEach((p, i) => sheet.getRange(2 + i, 1).setValue(p.username));

  // Load previous pairings safely
  const previousPairings = loadPreviousPairings(pairingsSheet);

  // Generate teams
  let teams;
  try {
    teams = generateTeams(playerData, safeLog);
    if (!teams || teams.length === 0) throw new Error("No teams generated");
  } catch (e) {
    safeLog(`Team generation failed: ${e.message}`);
    return ContentService.createTextOutput(JSON.stringify({ error: "Team generation failed." }));
  }

  // Run teamCheck
  const checkSummary = teamCheck(teams, pairingsSheet, avoidPairingsSheet, safeLog);
  safeLog(`Team check summary: ${JSON.stringify(checkSummary.summary)}`);
  safeLog(`Starting snapshot → Duplicates: ${checkSummary.initialDuplicates.size}, Avoids: ${checkSummary.initialAvoids.size}, Region errors: ${checkSummary.regionErrors.size}`);

  // Run teamFixer to attempt resolving conflicts, passing the starting audit
  const fixResult = teamFixer(teams, pairingsSheet, avoidPairingsSheet, safeLog, checkSummary, LOG_ENABLED);
  teams = fixResult.teams;

  safeLog(`teamFixer applied ${fixResult.swapsApplied} swaps. Unresolved previous pairings: ${fixResult.unresolvedPrevious}, unresolved avoid pairings: ${fixResult.unresolvedAvoid}`);
  safeLog(`Post-fixer audit → Duplicates: ${fixResult.postAudit.initialDuplicates.size}, Avoids: ${fixResult.postAudit.initialAvoids.size}, Region errors: ${fixResult.postAudit.regionErrors.size}`);


  // Post teams to the sheet
  postTeams(sheet, teams, safeLog);

  // Extract new pairings
  const newPairings = extractNewPairs(teams);

  // Save new pairings
  saveNewPairings(pairingsSheet, newPairings, safeLog);

  safeLog("grabReactions completed successfully");
  return ContentService.createTextOutput(JSON.stringify({ success: true }));

  // --- Helper functions ---
  function loadPreviousPairings(sheet) {
    const values = sheet.getDataRange().getValues();
    const pairingsSet = new Set();
    for (let i = 1; i < values.length; i++) {
      const [playerA, playerB] = values[i];
      if (playerA && playerB) pairingsSet.add(pairKey(playerA, playerB));
    }
    return pairingsSet;
  }

  function extractNewPairs(teams) {
    const pairs = new Set();
    teams.forEach(team => {
      const players = team.filter(p => p.region !== "Filler");
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          pairs.add(pairKey(players[i].username, players[j].username));
        }
      }
    });
    return pairs;
  }

  function saveNewPairings(sheet, newPairs, log) {
    try {
      const rows = [];
      newPairs.forEach(pairStr => {
        const [playerA, playerB] = pairStr.split('|');
        rows.push([playerA, playerB]);
      });
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
        log(`Saved ${rows.length} new pairings.`);
      } else {
        log("No new pairings to save.");
      }
    } catch (e) {
      log(`Error saving new pairings: ${e.message}`);
    }
  }
}
