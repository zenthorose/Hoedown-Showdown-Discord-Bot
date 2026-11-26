const assert = require('node:assert/strict');
const test = require('node:test');
const { formatAvoidListMessages, getAvoidPairs } = require('./avoid-list');

test('avoid-list formats directional database relationships and filters by either player', () => {
  const documents = [
    {
      _id: '10000000000000001',
      name: 'Player One',
      avoids: [{ discordId: '10000000000000002', name: 'Player Two' }]
    },
    {
      _id: '10000000000000003',
      name: 'Player Three',
      avoids: [{ discordId: '10000000000000001', name: 'Player One' }]
    }
  ];

  assert.deepEqual(getAvoidPairs(documents), [
    ['Player One', 'Player Two'],
    ['Player Three', 'Player One']
  ]);
  assert.deepEqual(getAvoidPairs(documents, '10000000000000001'), [
    ['Player One', 'Player Two'],
    ['Player Three', 'Player One']
  ]);
  assert.deepEqual(getAvoidPairs(documents, '10000000000000002'), [
    ['Player One', 'Player Two']
  ]);
});

test('avoid-list splits long output into Discord-safe messages', () => {
  const pairs = Array.from({ length: 80 }, (_, index) => [
    `Player ${index + 1} ${'A'.repeat(48)}`,
    `Player ${index + 101} ${'B'.repeat(48)}`
  ]);

  const messages = formatAvoidListMessages(pairs);

  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 2000));
  assert.equal(messages.join('\n').match(/ =\/ /g).length, pairs.length);
});
