// Wrapper for /lookup POST requests — validates and reuses infoCheck()
function lookup({ targetId, targetName }) {
  if (!targetId && !targetName) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Missing targetId or targetName' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Discord Member List');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Discord Member List sheet not found.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'No members found in the sheet.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const members = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

    // Try to find by ID (column C) first if provided
    let row = null;
    if (targetId) {
      row = members.find(r => String(r[2]) == String(targetId));
    }

    // If not found by ID, try matching the username (col B) or nickname (col A)
    if (!row && targetName) {
      const nameLower = String(targetName).trim().toLowerCase();
      row = members.find(r => String(r[1] || '').trim().toLowerCase() == nameLower || String(r[0] || '').trim().toLowerCase() == nameLower);
    }

    if (!row) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'User not found.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const result = {
      region: row[3],
      steamCode: row[4],
      streamLink: row[5]
    };

    return ContentService.createTextOutput(JSON.stringify(result))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    logErrorToSheet(`lookup error: ${err.message}`);
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
