/**
 * Posts a message via the Render-hosted bot endpoint.
 */
function postToDiscord(channelId, message, safeLog) {
  const SCRIPT_VERSION = "postToDiscord v3.0.0";
  const LOG_ENABLED = false; // set to false to disable logs

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log("Starting postToDiscord v3.0.0");

  const props = PropertiesService.getScriptProperties();
  const renderUrl = props.getProperty('DISCORD_BOT_API_URL');

  if (!channelId || !renderUrl) {
    log('❌ Missing channelId or DISCORD_BOT_API_URL in Script Properties');
    return;
  }

  // Mark this payload as originating from Google Apps Script so the bot can detect and optionally block it
  const payload = { channelId, message, source: 'GAS' };

  try {
    const response = UrlFetchApp.fetch(renderUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: {
        'x-from-gas': 'true'
      }
    });
    log(`✅ Post status: ${response.getResponseCode()}, body: ${response.getContentText()}`);
  } catch (e) {
    log(`❌ Error posting to Discord via Render: ${e.message}`);
  }
}

/**
 * Posts team preview to the configured check channel.
 * Includes name + region and proper formatting.
 */
function postTeamsPreview(teams, teamLetters, round, safeLog) {
  const SCRIPT_VERSION = "postTeamsPreview v1.5.0"; // updated version
  const LOG_ENABLED = false;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log(`Starting postTeamsPreview for Round #${round}`);

  if (!teams || !Array.isArray(teams) || !teamLetters || teams.length !== teamLetters.length) {
    log("❌ Teams or teamLetters invalid for postTeamsPreview");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const channelId = props.getProperty('TeamCheckChannelID');
  const MAX_LENGTH = 1900;

  // --- Build message ---
  let message = `**Round #${round} – Team Check Preview**\n\n`;
  teams.forEach((team, i) => {
    message += `__**Team ${teamLetters[i]}:**__\n`;
    team.forEach(player => {
      message += `${player.name} (${player.region})\n`;
    });
    message += `\n`;
  });

  // --- Get pairing conflicts ---
  const report = getPairingReport(round, safeLog);

  // --- Append conflict section ---
  message += `\n`;
  const avoidCount = (report.avoidConflicts || []).length;
  const prevCount = (report.previousConflicts || []).length;

  if (avoidCount === 0 && prevCount === 0) {
    message += `✅ No Previous Pairings or Avoid Pairings Detected`;
  } else {
    if (avoidCount > 0) {
      message += `\n__**Avoid Pairings Found (${avoidCount})**__\n`;
      report.avoidConflicts.forEach(p => {
        message += `🔴 ${p.a} × ${p.b}\n`;
      });
    }
    if (prevCount > 0) {
      message += `\n__**Previous Pairings Found (${prevCount})**__\n`;
      report.previousConflicts.forEach(p => {
        message += `⚠️ ${p.a} × ${p.b}\n`;
      });
    }
  }

  // --- Post to Discord with line-safe character splitting ---
  try {
    const lines = message.trim().split("\n");
    const chunks = [];
    let currentChunk = "";

    lines.forEach(line => {
      // +1 for the newline character
      if ((currentChunk.length + line.length + 1) > MAX_LENGTH) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      currentChunk += line + "\n";
    });
    if (currentChunk) chunks.push(currentChunk.trim());

    // Post each chunk
    chunks.forEach((chunk, idx) => {
      postToDiscord(channelId, chunk, safeLog);
      Utilities.sleep(500); // delay to prevent rate limiting
      log(`Posted chunk ${idx + 1}/${chunks.length} (${chunk.length} chars)`);
    });

    log(`✅ postTeamsPreview completed successfully (${chunks.length} chunk${chunks.length > 1 ? "s" : ""})`);
  } catch (e) {
    log(`❌ Error posting to Discord: ${e.message}`);
  }
}

/**
 * repostTeamsPreview
 * - builds the team preview for round
 * - calls getPairingReport(round, safeLog) to get conflicts
 * - appends conflict lines after the team preview
 * - posts combined message to Discord
 */
function repostTeamsPreview(round, safeLog) {
  const SCRIPT_VERSION = "repostTeamsPreview v3.0.0";
  const LOG_ENABLED = false;
  function log(msg) { if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`); }

  log(`Starting repostTeamsPreview for Round #${round}`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Players That Reacted");
  if (!teamsSheet) {
    log("❌ Teams sheet not found");
    return ContentService.createTextOutput(JSON.stringify({ error: "Teams sheet not found" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // --- Find the round column ---
  const headers = teamsSheet.getRange(1, 1, 1, teamsSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    log(`❌ Round header not found: ${roundHeader}`);
    return ContentService.createTextOutput(JSON.stringify({ error: `Round "${round}" not found.` }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  log(`Found round column at index ${roundColIndex} (1-based: ${roundColIndex + 1})`);

  // --- Grab all values in the round column (skip header) ---
  const lastRow = Math.max(teamsSheet.getLastRow(), 1);
  const numRows = Math.max(lastRow - 1, 0);
  const roundValues = numRows > 0
    ? teamsSheet.getRange(2, roundColIndex + 1, numRows, 1).getValues().flat()
    : [];

  log(`Raw roundValues (${roundValues.length} rows): ${JSON.stringify(roundValues)}`);

  // --- Build team preview message (preserve region tags) ---
  let message = `**Round #${round} – Team Check Preview**\n\n`;

  // Filter out completely blank rows and avoid adding unnecessary empty lines
  const cleanedValues = roundValues
    .map(v => (typeof v === "string" ? v.trim() : v))
    .filter(v => v !== "" && v != null);

  cleanedValues.forEach((val, idx) => {
    if (/^Team [A-Z]/.test(val)) {
      // Add blank line before each new team except the first one
      if (idx > 0) message += `\n`;
      message += `__**${val}**__\n`;
    } else {
      message += `${val}\n`;
    }
  });

  // --- Get pairing conflicts ---
  const report = getPairingReport(round, safeLog);

  // --- Append conflict section ---
  message += `\n`; // spacer
  const avoidCount = (report.avoidConflicts || []).length;
  const prevCount = (report.previousConflicts || []).length;

  if (avoidCount === 0 && prevCount === 0) {
    message += `✅ No Previous Pairings or Avoid Pairings Detected`;
  } else {
    if (avoidCount > 0) {
      message += `\n__**Avoid Pairings Found (${avoidCount})**__\n`;
      report.avoidConflicts.forEach(p => {
        message += `🔴 ${p.a} × ${p.b}\n`;
      });
    }
    if (prevCount > 0) {
      message += `\n__**Previous Pairings Found (${prevCount})**__\n`;
      report.previousConflicts.forEach(p => {
        message += `⚠️ ${p.a} × ${p.b}\n`;
      });
    }
  }

  // --- Post to Discord with safe chunking ---
  const props = PropertiesService.getScriptProperties();
  const channelId = props.getProperty('TeamCheckChannelID');
  const MAX_LENGTH = 1900;

  try {
    const trimmedMessage = message.trim();

    if (trimmedMessage.length <= MAX_LENGTH) {
      postToDiscord(channelId, trimmedMessage, safeLog);
    } else {
      log(`Message length ${trimmedMessage.length} exceeds ${MAX_LENGTH}. Splitting into chunks...`);
      const lines = trimmedMessage.split("\n");
      const chunks = [];
      let currentChunk = "";

      lines.forEach(line => {
        if ((currentChunk.length + line.length + 1) > MAX_LENGTH) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
        currentChunk += line + "\n";
      });
      if (currentChunk) chunks.push(currentChunk.trim());

      chunks.forEach((chunk, idx) => {
        postToDiscord(channelId, chunk, safeLog);
        Utilities.sleep(500); // small delay between posts
        log(`Posted chunk ${idx + 1}/${chunks.length} (${chunk.length} chars)`);
      });
    }

    log("✅ repostTeamsPreview completed successfully");
  } catch (e) {
    log(`❌ Error posting to Discord: ${e.message}`);
  }
}

/**
 * getPairingReport(round, safeLog)
 * - reads round teams from "Players That Reacted"
 * - strips region tags "(...)" from player names
 * - loads pair lists from columns C & D of "Avoid Pairings" and "Previous Pairings"
 * - normalizes names (trim + lowercase) and compares using order-agnostic keys
 * - logs everything (raw rows loaded, normalized keys, checks, conflicts)
 * - returns { avoidConflicts: [{a,b}], previousConflicts: [{a,b}] }
 */
function getPairingReport(round, safeLog) {
  const SCRIPT_VERSION = "getPairingReport v3.0.0";
  const LOG_ENABLED = false;
  function log(msg) { if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[${SCRIPT_VERSION}] ${msg}`); }

  log(`Starting getPairingReport for Round #${round}`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Players That Reacted");
  const avoidSheet = ss.getSheetByName("Avoid Pairings");
  const previousSheet = ss.getSheetByName("Previous Pairings");

  if (!teamsSheet) {
    log("❌ 'Players That Reacted' not found");
    return { avoidConflicts: [], previousConflicts: [] };
  }

  // --- Find the round column ---
  const headers = teamsSheet.getRange(1, 1, 1, teamsSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);
  if (roundColIndex === -1) {
    log(`❌ Round header not found: ${roundHeader}`);
    return { avoidConflicts: [], previousConflicts: [] };
  }

  // --- Read round values ---
  const lastRow = Math.max(teamsSheet.getLastRow(), 1);
  const numRows = Math.max(lastRow - 1, 0);
  const roundValues = numRows > 0
    ? teamsSheet.getRange(2, roundColIndex + 1, numRows, 1).getValues().flat()
    : [];

  log(`Raw roundValues (${roundValues.length} rows): ${JSON.stringify(roundValues)}`);

  // --- Parse teams and normalize player names ---
  function stripRegion(raw) {
    if (raw == null) return "";
    return String(raw).replace(/\s*\(.*?\)\s*$/, "").trim();
  }
  function norm(name) {
    return String(name).trim().toLowerCase();
  }

  const teams = [];
  let currentTeam = [];
  roundValues.forEach((cell) => {
    if (!cell || String(cell).trim() === "") {
      // skip empty rows
      return;
    }
    const cellStr = String(cell);
    if (/^Team [A-Z]/.test(cellStr)) {
      if (currentTeam.length > 0) teams.push(currentTeam);
      currentTeam = [];
    } else {
      const displayName = stripRegion(cellStr);           // e.g. "Zen"
      const normName = norm(displayName);                // e.g. "zen"
      currentTeam.push({ displayName, normName });
    }
  });
  if (currentTeam.length > 0) teams.push(currentTeam);

  log(`Parsed ${teams.length} teams from Round #${round}`);
  teams.forEach((t, i) => log(`Team ${i+1}: ${t.map(p => p.displayName).join(", ")}`));

  // --- Helper to load pairs from columns C (3) and D (4) of a sheet ---
  function loadPairsFromCD(sheet, sheetName) {
    const set = new Set();
    if (!sheet) {
      log(`⚠️ Sheet not found: ${sheetName}`);
      return set;
    }

    // --- Find the true last row based on C or D column content ---
    function getTrueLastRow(sheet) {
      const colC = sheet.getRange("C:C").getValues().flat();
      const colD = sheet.getRange("D:D").getValues().flat();
      const lastC = colC.map(v => v ? 1 : 0).lastIndexOf(1) + 1;
      const lastD = colD.map(v => v ? 1 : 0).lastIndexOf(1) + 1;
      return Math.max(lastC, lastD);
    }

    const last = getTrueLastRow(sheet);
    log(`✅ ${sheetName} trueLastRow = ${last}`);

    if (last < 1) {
      log(`⚠️ Sheet ${sheetName} has no data rows`);
      return set;
    }

    // --- Get all rows from row 1 down to the last non-empty row ---
    const rows = sheet.getRange(1, 3, last, 2).getValues(); // columns C & D
    log(`Reading ${rows.length} rows from ${sheetName} (C:D)`);

    rows.forEach((r, idx) => {
      const rawA = r[0];
      const rawB = r[1];
      if (!rawA || !rawB) {
        if (rawA || rawB) log(`Skipping partial row in ${sheetName} row ${idx + 1}: ${JSON.stringify(r)}`);
        return;
      }
      const aClean = stripRegion(rawA);
      const bClean = stripRegion(rawB);
      const key = [norm(aClean), norm(bClean)].sort().join("|");
      set.add(key);
      log(`Loaded ${sheetName} row ${idx + 1}: "${rawA}" / "${rawB}" → normalized key=${key}`);
    });

    log(`✅ Loaded ${set.size} valid pairs from ${sheetName}`);
    return set;
  }


  // --- Load avoid and previous pair keys from C/D ---
  const avoidSet = loadPairsFromCD(avoidSheet, "Avoid Pairings");
  const previousSet = loadPairsFromCD(previousSheet, "Previous Pairings");

  log(`Total Avoid keys loaded: ${avoidSet.size}`);
  log(`Total Previous keys loaded: ${previousSet.size}`);

  // --- Compare teams ---
  const avoidConflictsSet = new Set();    // use set of "a|b" to keep unique
  const previousConflictsSet = new Set();

  teams.forEach((team, tIndex) => {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const p1 = team[i];
        const p2 = team[j];
        const key = [p1.normName, p2.normName].sort().join("|");
        log(`Checking pair (Team ${tIndex+1}): ${p1.displayName} × ${p2.displayName} → key=${key}`);
        if (avoidSet.has(key)) {
          const readable = `${p1.displayName} and ${p2.displayName}`;
          avoidConflictsSet.add(key); // unique key
          log(`🔴 Avoid conflict detected: ${readable}`);
        }
        if (previousSet.has(key)) {
          const readable = `${p1.displayName} and ${p2.displayName}`;
          previousConflictsSet.add(key);
          log(`⚠️ Previous conflict detected: ${readable}`);
        }
      }
    }
  });

  // --- Convert sets back to readable arrays (we'll reconstruct display names from teams) ---
  function expandConflictsFromKeys(conflictKeys) {
    const results = [];
    // We need to map normalized names back to display names — we'll search teams
    const normToDisplay = {};
    teams.forEach(team => {
      team.forEach(p => { if (!normToDisplay[p.normName]) normToDisplay[p.normName] = p.displayName; });
    });
    conflictKeys.forEach(k => {
      const parts = k.split("|");
      const aNorm = parts[0], bNorm = parts[1];
      const aDisp = normToDisplay[aNorm] || parts[0];
      const bDisp = normToDisplay[bNorm] || parts[1];
      results.push({ a: aDisp, b: bDisp });
    });
    return results;
  }

  const avoidConflicts = expandConflictsFromKeys(avoidConflictsSet);
  const previousConflicts = expandConflictsFromKeys(previousConflictsSet);

  log(`Found ${avoidConflicts.length} avoid conflicts, ${previousConflicts.length} previous conflicts`);
  if (avoidConflicts.length > 0) avoidConflicts.forEach(p => log(`Avoid: ${p.a} × ${p.b}`));
  if (previousConflicts.length > 0) previousConflicts.forEach(p => log(`Previous: ${p.a} × ${p.b}`));

  return {
    avoidConflicts,
    previousConflicts
  };
}

/**
 * Posts final teams to the configured final channel.
 * Name-only in Discord, but logs + JSON include Steam/Stream links.
 */
function postRoundFinal({ round }) {
  const SCRIPT_VERSION = "postRoundFinal v3.0.0";
  const LOG_ENABLED = false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Players That Reacted");
  const membersSheet = ss.getSheetByName("Discord Member List");
  const logSheet = ss.getSheetByName("Logs");

  function safeLog(message) {
    if (!LOG_ENABLED) return;
    if (logSheet && typeof logSheet.appendRow === "function") {
      logSheet.appendRow([`[${new Date()}] ${message}`]);
    } else {
      console.warn(`[${SCRIPT_VERSION}] ${message}`);
    }
  }

  function log(msg) {
    if (LOG_ENABLED) safeLog(`[${SCRIPT_VERSION}] ${msg}`);
  }

  log(`Starting postRoundFinal for Round #${round}`);

  // --- Validate sheets ---
  if (!teamsSheet || !membersSheet) {
    const missing = !teamsSheet ? "Teams sheet" : "Discord Members List";
    log(`❌ ${missing} not found`);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      reason: "missing_sheet",
      message: `${missing} not found`
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // --- Build Discord member map ---
  // Expecting: Name | DiscordID | (unused) | SteamID | (extra) | StreamLink
  const membersData = membersSheet.getRange(2, 1, membersSheet.getLastRow() - 1, 6).getValues();
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

  // --- Find round column ---
  const headers = teamsSheet.getRange(1, 1, 1, teamsSheet.getLastColumn()).getValues()[0];
  const roundHeader = `Round #${round}`;
  const roundColIndex = headers.indexOf(roundHeader);

  if (roundColIndex === -1) {
    log(`❌ Round header not found: ${roundHeader}`);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      reason: "not_found",
      message: `Round "${round}" not found`
    })).setMimeType(ContentService.MimeType.JSON);
  }

  log(`Found round column at index ${roundColIndex} (1-based: ${roundColIndex + 1})`);

  // --- Grab round values ---
  const lastRow = teamsSheet.getLastRow();
  if (lastRow <= 1) {
    log("❌ No team data found for this round");
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      reason: "no_data",
      message: "No team data found"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const roundValues = teamsSheet.getRange(2, roundColIndex + 1, lastRow - 1, 1).getValues().flat();

  // --- Build enriched structure ---
  const teams = {};
  let currentTeam = null;
  let discordMessage = `**Round #${round} – Final Teams**\n\n`;

  roundValues.forEach(val => {
    if (!val) {
      discordMessage += "\n";
      return;
    }

    const cleanVal = String(val).replace(/\s*\(.*\)$/, ""); // strip region
    if (/^Team [A-Z]+$/.test(cleanVal)) {
      currentTeam = cleanVal.replace("Team ", "");
      teams[currentTeam] = [];
      discordMessage += `__**${cleanVal}**__\n`;
    } else {
      const member = memberMap[cleanVal.toLowerCase()] || {};
      if (member.discordId) {
        discordMessage += `<@${member.discordId}>\n`;
      } else {
        discordMessage += `${cleanVal}\n`;
        log(`⚠️ No Discord ID found for player: "${cleanVal}"`);
      }

      const playerData = {
        name: cleanVal,
        discordId: member.discordId || null,
        steamId: member.steamId || null,
        streamLink: member.streamLink || null
      };
      teams[currentTeam]?.push(playerData);

      // 🔍 Log enriched player info
      log(`   Player: ${playerData.name} | DiscordID: ${playerData.discordId || "N/A"} | SteamID: ${playerData.steamId || "N/A"} | Stream: ${playerData.streamLink || "N/A"}`);
    }
  });

  // --- Determine Discord channel ---
  const props = PropertiesService.getScriptProperties();
  const roundChannelKey = `Round_${round}_ChannelID`;
  let channelId = props.getProperty(roundChannelKey);

  if (!channelId) {
    log(`⚠️ No channel ID for ${roundChannelKey}, falling back to TeamCheckChannelID`);
    channelId = props.getProperty("TeamCheckChannelID");
    if (!channelId) {
      log("❌ No fallback channel ID found");
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        reason: "discord_error",
        message: "No channel ID available to post round"
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Save new pairings
  saveNewPairings(round, safeLog);
  safeLog(`Finished saveNewPairings`);

  // --- Post to Discord safely ---
  try {
    const MAX_LENGTH = 1900; // keep under 2000 char limit
    const sections = discordMessage.split(/(?=__\*\*Team [A-Z]+\*\*__)/);
    const messages = [];
    let currentMsg = "";

    for (const section of sections) {
      if ((currentMsg + section).length > MAX_LENGTH) {
        messages.push(currentMsg);
        currentMsg = section;
      } else {
        currentMsg += section;
      }
    }
    if (currentMsg) messages.push(currentMsg);

    for (let i = 0; i < messages.length; i++) {
      postToDiscord(channelId, messages[i], safeLog);
      Utilities.sleep(1000); // avoid rate limit
    }

    log(`✅ postRoundFinal posted ${messages.length} message(s) to ${roundChannelKey} (${channelId}) successfully`);

    // Mark only the first row of the last column green if it matches this round header
    try {
      const lastCol = teamsSheet.getLastColumn();
      const cell = teamsSheet.getRange(1, lastCol);
      if (String(cell.getValue()) === roundHeader) {
        cell.setBackground('#00ff00');
        cell.setFontColor('#000000');
        cell.setHorizontalAlignment('center');
      }
    } catch (e) {
      log(`Failed to mark last-column header approved: ${e.message}`);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      round,
      teams,
      messagesSent: messages.length
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    log(`❌ Error posting to Discord: ${e.message}`);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      reason: "discord_error",
      message: e.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
