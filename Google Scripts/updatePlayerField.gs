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
