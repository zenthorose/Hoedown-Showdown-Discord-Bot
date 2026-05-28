/**
 * pastTeams
 * Expects: { eventSheetName: string, userId: string }
 * Returns: { success: true, results: [{ round:number, team:string, members:[string] }, ...] }
 */
function pastTeams(data) {
  try {
    if (!data || !data.eventSheetName || !data.userId) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Missing eventSheetName or userId' })).setMimeType(ContentService.MimeType.JSON);
    }

    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return ContentService.createTextOutput(JSON.stringify({ error: 'Spreadsheet ID not set' })).setMimeType(ContentService.MimeType.JSON);

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const membersSheet = ss.getSheetByName('Discord Member List');
    if (!membersSheet) return ContentService.createTextOutput(JSON.stringify({ error: 'Discord Member List sheet not found' })).setMimeType(ContentService.MimeType.JSON);

    const membersData = membersSheet.getRange(2, 1, Math.max(membersSheet.getLastRow()-1,0), 5).getValues();
    let displayName = null;
    let region = null;
    for (let i = 0; i < membersData.length; i++) {
      const row = membersData[i];
      const name = row[0] ? String(row[0]).trim() : null;
      const discordId = row[1] ? String(row[1]).trim() : null;
      const regionCell = row[2] ? String(row[2]).trim() : null; // column C
      if (discordId && discordId === String(data.userId)) {
        displayName = name;
        region = regionCell;
        break;
      }
    }

    if (!displayName) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'User not found in Discord Member List' })).setMimeType(ContentService.MimeType.JSON);
    }

    const searchLabel = region ? `${displayName} (${region})` : displayName;

    const eventSheet = ss.getSheetByName(String(data.eventSheetName));
    if (!eventSheet) return ContentService.createTextOutput(JSON.stringify({ error: 'Event sheet not found' })).setMimeType(ContentService.MimeType.JSON);

    const eventName = eventSheet.getName();

    const lastCol = eventSheet.getLastColumn();
    const lastRow = Math.max(eventSheet.getLastRow(), 1);

    const headers = eventSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const results = [];

    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header || String(header).toString().indexOf('Round #') === -1) continue;
      const roundNumberMatch = String(header).match(/Round #?(\d+)/);
      const roundNum = roundNumberMatch ? parseInt(roundNumberMatch[1]) : null;

      const colIndex = c + 1; // 1-based
      const colValues = eventSheet.getRange(2, colIndex, Math.max(lastRow-1,0), 1).getValues().flat();

      for (let r = 0; r < colValues.length; r++) {
        const cell = colValues[r] ? String(colValues[r]).trim() : '';
        if (!cell) continue;
        // match by exact label or by name prefix
        if (cell === searchLabel || cell.startsWith(displayName + ' (') || cell === displayName) {
          // found occurrence at row r (relative to row 2)
          const sheetRow = r + 2;
          // find team label by scanning upward until Team X
          let teamLabel = null;
          for (let up = sheetRow - 1; up >= 1; up--) {
            const val = eventSheet.getRange(up, colIndex).getValue();
            if (val && /^Team [A-Z]+$/.test(String(val))) {
              teamLabel = String(val).replace('Team ', '');
              break;
            }
          }

          // collect members under team: starting at teamRow+1
          const members = [];
          if (teamLabel) {
            // find the team header row
            let teamRow = null;
            for (let up = sheetRow - 1; up >= 1; up--) {
              const val = eventSheet.getRange(up, colIndex).getValue();
              if (val && /^Team [A-Z]+$/.test(String(val))) { teamRow = up; break; }
            }
            if (teamRow) {
              // collect next non-empty rows after teamRow
              let found = 0;
              for (let down = teamRow + 1; down <= lastRow; down++) {
                const v = eventSheet.getRange(down, colIndex).getValue();
                if (!v || String(v).trim() === '') break;
                members.push(String(v).toString());
                found++;
                if (found >= 3) break; // only need three
              }
            }
          }

          results.push({ round: roundNum || null, team: teamLabel || null, members });
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, eventName: eventName, results })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
