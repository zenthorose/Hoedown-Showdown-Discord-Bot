/**
 * teamInfo
 * Returns the latest approved round (based on header background being green) and its teams.
 * Expects no parameters.
 * Returns: { success:true, round:number, teams: { A:[{name,discordId,steamId,streamLink}], ... } }
 */
function teamInfo() {
  const SCRIPT_VERSION = "teamInfo v1";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Players That Reacted");
  const membersSheet = ss.getSheetByName("Discord Member List");

  if (!teamsSheet || !membersSheet) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, reason: 'missing_sheet' })).setMimeType(ContentService.MimeType.JSON);
  }

  // Build member map (now reading through column F - StreamLink is column F)
  const membersData = membersSheet.getRange(2, 1, Math.max(membersSheet.getLastRow()-1,0), 6).getValues();
  const memberMap = {};
  membersData.forEach(([name, _colB, discordId, region, steamId, streamLink]) => {
    if (name) {
      memberMap[String(name).trim().toLowerCase()] = {
        discordId: discordId ? String(discordId).trim() : null,
        region: region ? String(region).trim() : null,
        steamId: steamId ? String(steamId).trim() : null,
        streamLink: streamLink ? String(streamLink).trim() : null
      };
    }
  });

  const lastCol = teamsSheet.getLastColumn();
  if (lastCol < 1) return ContentService.createTextOutput(JSON.stringify({ success: false, reason: 'no_rounds' })).setMimeType(ContentService.MimeType.JSON);

  const headersRange = teamsSheet.getRange(1, 1, 1, lastCol);
  const headers = headersRange.getValues()[0];
  const backgrounds = headersRange.getBackgrounds()[0];

  let latestRoundNum = null;
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (!h || String(h).indexOf('Round #') === -1) continue;
    const bg = (backgrounds[c] || '').toString().toLowerCase();
    if (bg === '#00ff00' || bg === 'green') {
      const m = String(h).match(/Round #?(\d+)/);
      const rn = m ? parseInt(m[1]) : null;
      if (rn && (latestRoundNum === null || rn > latestRoundNum)) latestRoundNum = rn;
    }
  }

  if (!latestRoundNum) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, reason: 'no_approved_round', message: 'No approved round found' })).setMimeType(ContentService.MimeType.JSON);
  }

  // Build teams for that round (same logic as postRoundFinal)
  const roundHeader = `Round #${latestRoundNum}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, reason: 'not_found' })).setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = teamsSheet.getLastRow();
  const roundValues = teamsSheet.getRange(2, roundColIndex + 1, Math.max(lastRow-1,0), 1).getValues().flat();

  const teams = {};
  let currentTeam = null;
  roundValues.forEach(val => {
    if (!val) return;
    const cleanVal = String(val).replace(/\s*\(.*\)$/, "");
    if (/^Team [A-Z]+$/.test(cleanVal)) {
      currentTeam = cleanVal.replace('Team ', '');
      teams[currentTeam] = [];
    } else if (currentTeam) {
      const member = memberMap[cleanVal.toLowerCase()] || {};
      const playerData = {
        name: cleanVal,
        discordId: member.discordId || null,
        steamId: member.steamId || null,
        streamLink: member.streamLink || null
      };
      teams[currentTeam].push(playerData);
    }
  });

  return ContentService.createTextOutput(JSON.stringify({ success: true, round: latestRoundNum, teams })).setMimeType(ContentService.MimeType.JSON);
}
