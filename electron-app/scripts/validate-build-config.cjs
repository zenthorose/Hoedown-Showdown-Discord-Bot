const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'desktop', 'auth-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
if (!['beta', 'stable'].includes(config.updateChannel)) {
  throw new Error('Set updateChannel to beta or stable in desktop/auth-config.json.');
}
let serviceUrl;
try {
  serviceUrl = new URL(config.apiBaseUrl);
} catch {
  throw new Error('Set apiBaseUrl to the deployed Render HTTPS URL before building.');
}
if (serviceUrl.protocol !== 'https:' || serviceUrl.username || serviceUrl.password ||
    serviceUrl.search || serviceUrl.hash) {
  throw new Error('Set apiBaseUrl to an HTTPS Render base URL without credentials or query parameters.');
}
const updatePublisher = appPackage.build && appPackage.build.publish;
if (!updatePublisher || updatePublisher.provider !== 'generic' || updatePublisher.channel !== 'latest') {
  throw new Error('Configure a generic latest-channel publisher in electron-app/package.json to generate latest.yml.');
}
let updateFeedUrl;
try {
  updateFeedUrl = new URL(updatePublisher.url);
} catch {
  throw new Error('Configure a valid HTTPS generic update publisher URL in electron-app/package.json.');
}
if (updateFeedUrl.protocol !== 'https:' || updateFeedUrl.username || updateFeedUrl.password ||
    updateFeedUrl.search || updateFeedUrl.hash) {
  throw new Error('The generic update publisher URL must use HTTPS and contain no credentials or query parameters.');
}
