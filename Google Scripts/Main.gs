const SCRIPT_VERSION = 273;

function doPost(e) {
  const timestamp = new Date().toISOString();

  try {
    logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] doPost called`);

    if (!e.postData || !e.postData.contents) {
      throw new Error("No POST data received");
    }

    const data = JSON.parse(e.postData.contents);
    logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Parsed data: ${JSON.stringify(data)}`);

    const command = data.command;
    logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Received command: ${command}`);

    if (command === "ping") {
      // Respond immediately to ping command
      return ContentService
        .createTextOutput(JSON.stringify({ status: "success", message: "pong", version: SCRIPT_VERSION }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) {
      logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error: SPREADSHEET_ID is not set.`);
      return ContentService.createTextOutput(JSON.stringify({ error: "Spreadsheet ID is not set." }))
                            .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.openById(spreadsheetId);
    if (!sheet) {
      logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error: Unable to access spreadsheet.`);
      return ContentService.createTextOutput(JSON.stringify({ error: "Unable to access the spreadsheet." }))
                            .setMimeType(ContentService.MimeType.JSON);
    }

    switch (command) {
      case "grab-reactions":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling grab-reactions`);
        return grabReactions(data);
      case "swap-players":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling swap-players`);
        return swapPlayers(data);
      case "approve-teams":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling approve-teams`);
        return approveTeams(data);
      case "region-check":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling region-check`);
        return regionCheck(data);
      case "region-change":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling region-change`);
        return regionChange(data);
      case "register":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling register`);
        return register(data);
      case "member-update":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling member-update`);
        return memberUpdate(data);
      case "update":
        logToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Handling update`);
        return updatePlayerField(data);
      default:
        throw new Error(`Unknown command: ${command}`);
    }

  } catch (error) {
    logErrorToSheet(`[${timestamp}] [v${SCRIPT_VERSION}] Error in doPost: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
                          .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "dev endpoint working", version: SCRIPT_VERSION }))
                       .setMimeType(ContentService.MimeType.JSON);
}
