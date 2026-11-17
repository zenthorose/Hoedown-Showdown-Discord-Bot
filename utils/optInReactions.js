const { PermissionsBitField } = require('discord.js');
const config = require('../config.json');

async function removeOptInReactions(client, guild, target) {
  if (!config.OptInChannelID) {
    throw new Error('OptInChannelID is not configured.');
  }

  const optInChannel = await client.channels.fetch(config.OptInChannelID);
  if (!optInChannel || !optInChannel.isTextBased()) {
    throw new Error('The configured Opt-In channel is unavailable or is not a text channel.');
  }
  if (optInChannel.guildId !== guild.id) {
    throw new Error('The configured Opt-In channel is not in this server.');
  }

  const botMember = guild.members.me;
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageMessages
  ];
  const channelPermissions = botMember && optInChannel.permissionsFor(botMember);
  if (!channelPermissions || !channelPermissions.has(requiredPermissions)) {
    throw new Error('Bot needs View Channel, Read Message History, and Manage Messages in the Opt-In channel.');
  }

  const slotMessages = [];
  let before;
  while (true) {
    const batch = await optInChannel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });
    if (batch.size === 0) break;

    for (const message of batch.values()) {
      const isTimeSlot = message.author.id === client.user.id &&
        message.embeds.some(embed => /^Round \d+!$/.test(embed.title || ''));
      if (isTimeSlot) slotMessages.push(message);
    }

    const oldestMessage = batch.last();
    if (!oldestMessage || oldestMessage.id === before || batch.size < 100) break;
    before = oldestMessage.id;
  }

  let removedCount = 0;
  let failedCount = 0;

  for (const message of slotMessages) {
    for (const reaction of message.reactions.cache.values()) {
      try {
        let after;
        let targetReacted = false;
        while (true) {
          const users = await reaction.users.fetch({
            limit: 100,
            ...(after ? { after } : {})
          });
          if (users.has(target.id)) {
            targetReacted = true;
            break;
          }
          if (users.size < 100) break;

          const lastUser = users.last();
          if (!lastUser || lastUser.id === after) break;
          after = lastUser.id;
        }

        if (targetReacted) {
          await reaction.users.remove(target.id);
          removedCount++;
        }
      } catch (reactionError) {
        failedCount++;
        console.error(
          `❌ Failed to remove ${target.id}'s reaction from message ${message.id}:`,
          reactionError
        );
      }
    }
  }

  return { removedCount, failedCount, slotCount: slotMessages.length };
}

module.exports = { removeOptInReactions };
