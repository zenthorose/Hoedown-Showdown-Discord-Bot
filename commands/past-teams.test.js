const assert = require('node:assert/strict');
const test = require('node:test');
const { formatPastTeamsMessages } = require('./past-teams');

test('splits long past-team histories into Discord-safe messages', () => {
  const teams = Array.from({ length: 60 }, (_, index) => ({
    round: index + 1,
    team: 'A',
    members: ['Player One', 'Player Two', 'Player Three']
  }));
  const messages = formatPastTeamsMessages('Test Hoedown', teams);

  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 1900));
  assert.equal(messages.join('\n').match(/\*\*Round #/g).length, teams.length);
});
