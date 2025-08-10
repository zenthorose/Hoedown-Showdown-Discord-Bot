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
