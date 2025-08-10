// swapPlayers.gs - Swaps Players in a Team Set
function swapPlayers({ TeamSet, RemovePlayer, AddPlayer }) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  const teams = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();

  const rowIndex = teams.findIndex(row => row[0] == TeamSet);
  if (rowIndex === -1) return ContentService.createTextOutput(JSON.stringify({ error: "Team set not found." }));

  const updatedTeam = teams[rowIndex].map(player => player === RemovePlayer ? AddPlayer : player);
  sheet.getRange(rowIndex + 2, 2, 1, 4).setValues([updatedTeam.slice(1)]);

  return ContentService.createTextOutput(JSON.stringify({ success: true, updatedTeam }));
}