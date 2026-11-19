const assert = require('node:assert/strict');
const test = require('node:test');
const command = require('./dev-command');

test('exposes each Hoedown import as a subcommand with its own required CSV file', () => {
  const commandData = command.data.toJSON();
  assert.deepEqual(commandData.options.map((option) => option.name), [
    'members',
    'avoids',
    'previous-pairings',
    'past-hoedown-teams'
  ]);
  for (const subcommand of commandData.options) {
    assert.equal(subcommand.type, 1);
    assert.deepEqual(subcommand.options.map((option) => option.name), ['file']);
    assert.equal(subcommand.options[0].type, 11);
    assert.equal(subcommand.options[0].required, true);
  }
});
