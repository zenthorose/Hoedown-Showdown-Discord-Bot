const assert = require('node:assert/strict');
const test = require('node:test');
const { findLatestRoundOptInMessage } = require('./optInReactions');

function collection(messages) {
  const result = new Map(messages.map((message) => [message.id, message]));
  Object.defineProperty(result, 'last', {
    value: () => messages[messages.length - 1]
  });
  return result;
}

test('round opt-in lookup matches the requested embed title and selects the newest bot post', async () => {
  const olderMatch = {
    id: '100',
    author: { id: 'bot' },
    embeds: [{ title: 'Round 2!' }],
    createdTimestamp: 100
  };
  const newestMatch = {
    id: '200',
    author: { id: 'bot' },
    embeds: [{ title: 'Round 2!' }],
    createdTimestamp: 200
  };
  const channel = {
    guildId: 'guild',
    isTextBased: () => true,
    messages: {
      fetch: async () => collection([
        {
          id: '300',
          author: { id: 'bot' },
          embeds: [{ title: 'Round 1!' }],
          createdTimestamp: 300
        },
        olderMatch,
        newestMatch,
        {
          id: '400',
          author: { id: 'someone-else' },
          embeds: [{ title: 'Round 2!' }],
          createdTimestamp: 400
        }
      ])
    }
  };

  const result = await findLatestRoundOptInMessage({
    client: {
      user: { id: 'bot' },
      channels: { fetch: async () => channel }
    },
    channelId: 'opt-in',
    guildId: 'guild',
    roundNumber: 2
  });

  assert.equal(result, newestMatch);
});
