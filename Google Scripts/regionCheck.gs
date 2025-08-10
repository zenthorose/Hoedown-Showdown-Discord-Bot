// regionCheck.gs - Checks a User's Region
function regionCheck({ userId }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Discord Member List");
  const members = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();

  const user = members.find(row => row[2] == userId);
  if (!user) return ContentService.createTextOutput(JSON.stringify({ error: "User not found." }));

  return ContentService.createTextOutput(JSON.stringify({ region: user[3] }));
}