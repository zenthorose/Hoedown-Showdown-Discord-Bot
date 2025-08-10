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
