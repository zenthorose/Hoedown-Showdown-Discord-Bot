// approveTeams.gs - Approves a Team Set
function approveTeams({ TeamSet }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  const teams = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();

  const rowIndex = teams.findIndex(row => row[0] == TeamSet);
  if (rowIndex === -1) return ContentService.createTextOutput(JSON.stringify({ error: "Team set not found." }));

  sheet.getRange(rowIndex + 2, 6).setValue("Approved");
  return ContentService.createTextOutput(JSON.stringify({ success: true }));
}