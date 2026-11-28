const UPDATE_PREFIXES = Object.freeze({
  desktop: 'Hoedown Showdown Team App',
  'account-manager': 'Hoedown Showdown Admin App'
});

function updateObjectPrefix(application, channel) {
  const prefix = UPDATE_PREFIXES[application];
  if (!prefix) throw new TypeError('Choose desktop or account-manager as the application.');
  if (!['beta', 'stable'].includes(channel)) throw new TypeError('Choose beta or stable.');
  return `${prefix}/${channel}/`;
}

module.exports = { UPDATE_PREFIXES, updateObjectPrefix };
