const DEBUG = true;
const SCRIPT_VERSION = 376;

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
        return grabReactions(data);

      case "replace":
        logDebug(`[${timestamp}] Handling replace`);
        return replacePlayers(data);

      case "swap":
        logDebug(`[${timestamp}] Handling swap`);
        if (!data.round || !data.player1 || !data.player2) {
          return createErrorResponse("Missing required parameters for swap: round, player1, player2.");
        }
        return swapPlayers(data);

      case "approve-teams":
        logDebug(`[${timestamp}] Handling approve-teams`);
        return approveTeams(data);

      case "info-check":
        logDebug(`[${timestamp}] Handling info-check`);
        return infoCheck(data);

      case "register":
        logDebug(`[${timestamp}] Handling register`);
        return register(data);

      case "member-update":
        logDebug(`[${timestamp}] Handling member-update`);
        return memberUpdate(data);

      case "update":
        logDebug(`[${timestamp}] Handling update`);
        return updatePlayerField(data);

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
