// regionChange.gs - Changes a User's Region
function regionChange({ userId, region }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Discord Member List");
  const members = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();

  const rowIndex = members.findIndex(row => row[2] == userId);
  if (rowIndex === -1) return ContentService.createTextOutput(JSON.stringify({ error: "User not found." }));

  sheet.getRange(rowIndex + 2, 4).setValue(region);
  return ContentService.createTextOutput(JSON.stringify({ success: true }));
}
