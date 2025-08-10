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
