/**
 * grabReactions
 * Version: 2.1.1 (ID-based, updated for new column layout)
 * Processes Discord players (id + name), generates teams, logs all steps safely.
 */
function grabReactions(discordPlayers) {
  const SCRIPT_VERSION = "grabReactions v2.1.1";
  const LOG_ENABLED = false; // set to false to disable logs

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Players That Reacted");
  const discordMemberSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");
  const pairingsSheet = ss.getSheetByName("Previous Pairings");
  const avoidPairingsSheet = ss.getSheetByName("Avoid Pairings");

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

  // Get player data from Discord Member List (columns A–F: Username, Discord ID, Region, Steam ID, <extra>, Stream Link)
  const data = discordMemberSheet.getRange(2, 1, discordMemberSheet.getLastRow() - 1, 6).getValues();
  const playerData = [];

  discordPlayers.forEach(p => {
    const { id, name } = p;
    const match = data.find(row => row[2] === id); // Discord ID moved to column C (index 2)
    if (match) {
      const [username, _colB, discordId, region] = match;
      playerData.push({ id: discordId, name: username, region });
    } else {
      safeLog(`Discord ID not found: ${id} (name: ${name})`);
    }
  });

  // Post player names to column A
  playerData.forEach((p, i) => sheet.getRange(2 + i, 1).setValue(p.name));

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

  // Run teamFixer to attempt resolving conflicts
  const fixResult = teamFixer(teams, pairingsSheet, avoidPairingsSheet, safeLog, checkSummary, LOG_ENABLED);
  teams = fixResult.teams;

  safeLog(`teamFixer applied ${fixResult.swapsApplied} swaps. Unresolved previous pairings: ${fixResult.unresolvedPrevious}, unresolved avoid pairings: ${fixResult.unresolvedAvoid}`);
  safeLog(`Post-fixer audit → Duplicates: ${fixResult.postAudit.initialDuplicates.size}, Avoids: ${fixResult.postAudit.initialAvoids.size}, Region errors: ${fixResult.postAudit.regionErrors.size}`);

  // Post teams to the sheet
  postTeams(sheet, teams, safeLog);

  // Extract new pairings
  const newPairings = extractNewPairs(teams, safeLog);
  safeLog(`Extracted newPairings count: ${newPairings.size}`);
  safeLog(`Extracted newPairings raw: ${JSON.stringify(Array.from(newPairings))}`);

  safeLog("grabReactions completed successfully");
  return ContentService.createTextOutput(JSON.stringify({ success: true }));
}
