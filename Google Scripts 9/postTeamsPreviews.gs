/**
 * Posts a message via the Render-hosted bot endpoint.
 */
function postToDiscord(channelId, message, safeLog) {
  const SCRIPT_VERSION = "postToDiscord v1.2.0";
  const LOG_ENABLED = true; // set to false to disable logs

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[postToDiscord] ${msg}`);
  }

  log("Starting postToDiscord");

  const props = PropertiesService.getScriptProperties();
  const renderUrl = props.getProperty('DISCORD_BOT_API_URL');

  if (!channelId || !renderUrl) {
    log('❌ Missing channelId or DISCORD_BOT_API_URL in Script Properties');
    return;
  }

  const payload = { channelId, message };

  try {
    const response = UrlFetchApp.fetch(renderUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    log(`✅ Post status: ${response.getResponseCode()}, body: ${response.getContentText()}`);
  } catch (e) {
    log(`❌ Error posting to Discord via Render: ${e.message}`);
  }
}

/**
 * Posts team preview to the configured check channel.
 * Includes username + region and proper formatting.
 */
function postTeamsPreview(teams, teamLetters, roundNumber, safeLog) {
  const SCRIPT_VERSION = "postTeamsPreview v1.2.0";
  const LOG_ENABLED = true;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[postTeamsPreview] ${msg}`);
  }

  log("Starting postTeamsPreview");

  if (!teams || !Array.isArray(teams) || !teamLetters || teams.length !== teamLetters.length) {
    log("❌ Teams or teamLetters invalid for postTeamsPreview");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const channelId = props.getProperty('TeamCheckChannelID');

  let message = `**Round #${roundNumber} – Team Check Preview (with regions)**\n`;
  teams.forEach((team, i) => {
    message += `\n**Team ${teamLetters[i]}:**\n`;
    team.forEach(p => message += `${p.username} (${p.region})\n`);
  });

  postToDiscord(channelId, message, safeLog);
}

/**
 * Posts final teams to the configured final channel.
 * Username-only, no regions, same formatting.
 */
function postTeamsFinal(teams, teamLetters, roundNumber, safeLog) {
  const SCRIPT_VERSION = "postTeamsFinal v1.2.0";
  const LOG_ENABLED = true;

  function log(msg) {
    if (LOG_ENABLED && typeof safeLog === "function") safeLog(`[postTeamsFinal] ${msg}`);
  }

  log("Starting postTeamsFinal");

  if (!teams || !Array.isArray(teams) || !teamLetters || teams.length !== teamLetters.length) {
    log("❌ Teams or teamLetters invalid for postTeamsFinal");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const channelId = props.getProperty('TeamFinalChannelID');

  let message = `**Round #${roundNumber} – Final Teams**\n`;
  teams.forEach((team, i) => {
    message += `\n**Team ${teamLetters[i]}:**\n`;
    team.forEach(p => message += `${p.username}\n`);
  });

  postToDiscord(channelId, message, safeLog);
}
