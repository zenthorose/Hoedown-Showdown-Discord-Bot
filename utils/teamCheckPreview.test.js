const assert = require('node:assert/strict');
const test = require('node:test');
const {
  refreshTeamCheckPreview,
  registerTeamCheckPreviewSync
} = require('./teamCheckPreview');

test('refreshes the Team Check preview through the registered Discord client', async () => {
  const client = {};
  const draft = { generationId: 'generation-1' };
  let receivedDraft;
  const unregister = registerTeamCheckPreviewSync(client, async (updatedDraft) => {
    receivedDraft = updatedDraft;
    return { ...updatedDraft, previewStatus: 'posted' };
  });

  const result = await refreshTeamCheckPreview(client, draft);

  assert.equal(receivedDraft, draft);
  assert.equal(result.previewStatus, 'posted');
  unregister();
  await assert.rejects(refreshTeamCheckPreview(client, draft), /not available/);
});
