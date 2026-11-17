const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'desktop', 'auth-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
