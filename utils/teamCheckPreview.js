const previewSyncHandlers = new WeakMap();

function registerTeamCheckPreviewSync(client, handler) {
  if (!client || (typeof client !== 'object' && typeof client !== 'function') ||
      typeof handler !== 'function') {
    throw new TypeError('A Discord client and Team Check preview handler are required.');
  }
  previewSyncHandlers.set(client, handler);
  return () => {
    if (previewSyncHandlers.get(client) === handler) previewSyncHandlers.delete(client);
  };
}

async function refreshTeamCheckPreview(client, draft) {
  const handler = client && previewSyncHandlers.get(client);
  if (!handler) throw new Error('Team Check preview synchronization is not available.');
  return handler(draft);
}

module.exports = { refreshTeamCheckPreview, registerTeamCheckPreviewSync };
