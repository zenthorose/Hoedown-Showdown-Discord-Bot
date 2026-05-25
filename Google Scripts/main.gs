const DEBUG = true;
const SCRIPT_VERSION = 512;

function logDebug(message) {
  if (DEBUG) logToSheet(message);
}

function logVersion(message) {
  logToSheet(`[v${SCRIPT_VERSION}] ${message}`);
}

function createErrorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const timestamp = new Date().toISOString();
  try {
    logVersion(`[${timestamp}] doPost called`);

    if (!e.postData || !e.postData.contents) throw new Error("No POST data received");

    const data = JSON.parse(e.postData.contents);
    logDebug(`[${timestamp}] Parsed data: ${JSON.stringify(data)}`);

    const command = data.command;
    logVersion(`[${timestamp}] Received command: ${command}`);

    if (command === "ping") {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "pong", version: SCRIPT_VERSION }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) {
      logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error: SPREADSHEET_ID is not set.`);
      return createErrorResponse("Spreadsheet ID is not set.");
    }

    const sheet = SpreadsheetApp.openById(spreadsheetId);
    if (!sheet) {
      logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error: Unable to access spreadsheet.`);
      return createErrorResponse("Unable to access the spreadsheet.");
    }

    switch (command) {
      case "grab-reactions":
        logDebug(`[${timestamp}] Handling grab-reactions`);
        // ✅ Now expects `discordPlayers: [{id, name}, ...]`
        return grabReactions(data.discordPlayers);

      case "replace":
        logDebug(`[${timestamp}] Handling replace`);
        return replacePlayers(data);

      case "swap":
        logDebug(`[${timestamp}] Handling swap`);

        // Validate for new format: round + swaps array
        if (!data.round || !data.swaps || !Array.isArray(data.swaps) || data.swaps.length === 0) {
          return createErrorResponse("Missing required parameters for swap: round, swaps array.");
        }

        // Pass the full data object to swapPlayers
        return swapPlayers(data);

      case "approve-round":
        logDebug(`[${timestamp}] Handling approve-round`);
        return postRoundFinal(data);

      case "past-teams":
        logDebug(`[${timestamp}] Handling past-teams`);
        return pastTeams(data);

      case "team-info":
        logDebug(`[${timestamp}] Handling team-info`);
        return teamInfo(data);

      case "info-check":
        logDebug(`[${timestamp}] Handling info-check`);
        return infoCheck(data);

      case "lookup":
        logDebug(`[${timestamp}] Handling lookup`);
        // For lookup we expect `targetId` in the POST body; reuse infoCheck logic
        return infoCheck({ userId: data.targetId });

      case "register":
        logDebug(`[${timestamp}] Handling register`);
        return register(data);

      case "member-update":
        logDebug(`[${timestamp}] Handling member-update`);
        return memberUpdate(data);

      case "update":
        logDebug(`[${timestamp}] Handling update`);
        return updatePlayerField(data);

      case "avoid":
        logDebug(`[${timestamp}] Handling avoid`);
        return avoidPairings(data);

      case "unavoid":
        logDebug(`[${timestamp}] Handling unavoid`);
        return unavoidPairings(data);

      case "avoid-list":
        logDebug(`[${timestamp}] Handling avoid-list`);
        return avoidList(data);

      default:
        throw new Error(`Unknown command: ${command}`);
    }

  } catch (error) {
    logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error in doPost: ${error.message}`);
    return createErrorResponse(error.message);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "dev endpoint working", version: SCRIPT_VERSION }))
                       .setMimeType(ContentService.MimeType.JSON);
}
