const assert = require('node:assert/strict');
const test = require('node:test');
const { UPDATE_PREFIXES, updateObjectPrefix } = require('../update-prefixes.cjs');

test('uses app names for Cloudflare update object prefixes', () => {
  assert.deepEqual(UPDATE_PREFIXES, {
    desktop: 'Hoedown Showdown Team App',
    'account-manager': 'Hoedown Showdown Admin App'
  });
  assert.equal(updateObjectPrefix('desktop', 'beta'), 'Hoedown Showdown Team App/beta/');
  assert.equal(updateObjectPrefix('account-manager', 'stable'), 'Hoedown Showdown Admin App/stable/');
});

test('rejects unknown Cloudflare update prefix inputs', () => {
  assert.throws(() => updateObjectPrefix('other', 'beta'), /desktop or account-manager/);
  assert.throws(() => updateObjectPrefix('desktop', 'preview'), /beta or stable/);
});
