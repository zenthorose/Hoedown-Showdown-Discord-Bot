const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// CONFIGURATION
const GUILD_ID = process.env.GUILD_ID;
const SUPPORT_CATEGORY_NAME = 'support-tickets';
const config = require('../config.json');
const STAFF_ROLE_IDS = [
  "1069716885467312188",
  "1253964506317586453",
  "1069083357100642316",
  "1416904399208321164"
];

// Command prefixes
const REPLY_PREFIX = '!reply';
const CLOSE_PREFIX = '!close';
const SILENT_CLOSE_PREFIX = '!silentclose';
const CLEAR_PREFIX = '!clear';
const EDIT_PREFIX = '!edit';
const DELETE_PREFIX = '!delete';
const CONTACT_PREFIX = '!contact';


// -------------------------
// Helper: Build stacked description
// -------------------------
function buildStackedDescription(latestContent, previousDesc, isDeleted = false) {
  const lines = previousDesc.split('\n--------------\n');

  let original = '';
  const edits = [];

  for (const line of lines) {
    if (line.startsWith('(Original)')) {
      original = line.replace('(Original)', '').trim();
    } else if (line.includes('(Current)')) {
      edits.push(line.replace(' (Current)', '').trim());
    } else if (line.match(/^\(Edit \d+\)/)) {
      edits.push(line.replace(/^\(Edit \d+\)\s*/, '').trim());
    }
  }

  // Ensure we have the original message preserved
  if (!original) original = edits.shift() || '';

  // Rebuild numbered edits (Edit 1 = first edit)
  const numberedEdits = edits.map((text, i) => `(Edit ${i + 1}) ${text}`);

  const topLine = latestContent + (isDeleted ? ' (Deleted by user)' : ' (Current)');
  return [topLine, ...numberedEdits, `(Original) ${original}`].join('\n--------------\n');
}

// -------------------------
// Helper: Update Bot Status
// -------------------------
async function updateBotStatus(client) {
  try {
    const supporttickets = config.supporttickets;
    const statusText = supporttickets
      ? '✅ Hoedown October 25th!'
      : '❌ Hoedown October 25th!';

    await client.user.setPresence({
      activities: [{ name: statusText, type: 0 }], // 0 = PLAYING
      status: supporttickets ? 'online' : 'dnd', // optional: red dot if closed
    });

    console.log(`✅ Bot status updated: ${statusText}`);
  } catch (err) {
    console.error('❌ Failed to update bot status:', err);
  }
}

// -------------------------
// MAIN MODULE EXPORT
// -------------------------
module.exports = {
  handleMessageCreate: async (client, message) => {
    try {
      if (message.author.bot) return;

      // ======================
      // STAFF: !contact command
      // ======================
      if (message.guild && STAFF_ROLE_IDS.some(r => message.member.roles.cache.has(r))) {
        const content = message.content.trim();
        if (content.startsWith(CONTACT_PREFIX)) {
          const args = content.split(' ').slice(1);
          const targetId = args[0];

          if (!targetId || !/^\d+$/.test(targetId)) {
            await message.reply('⚠️ Please provide a valid Discord user ID. Example: `!contact 123456789012345678`');
            return;
          }

          const guild = client.guilds.cache.get(GUILD_ID);
          if (!guild) return console.error('❌ Guild not found.');

          let user;
          try {
            user = await client.users.fetch(targetId);
          } catch {
            await message.reply('❌ Could not find that user.');
            return;
          }

          let category = guild.channels.cache.find(
            c => c.name === SUPPORT_CATEGORY_NAME && c.type === ChannelType.GuildCategory
          );
          if (!category) {
            category = await guild.channels.create({
              name: SUPPORT_CATEGORY_NAME,
              type: ChannelType.GuildCategory,
            });
          }

          const channelName = user.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
          let ticketChannel = guild.channels.cache.find(
            c => c.name === channelName && c.parentId === category.id
          );

          if (!ticketChannel) {
            ticketChannel = await guild.channels.create({
              name: channelName,
              type: ChannelType.GuildText,
              parent: category.id,
              topic: `Ticket for ${user.tag} (${user.id})`,
              permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                ...STAFF_ROLE_IDS.map(roleId => ({
                  id: roleId,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                  ],
                })),
              ],
            });

            const embed = new EmbedBuilder()
              .setColor('Green')
              .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
              .setDescription(`Ticket manually created for **${user.tag}** by staff.`)
              .setTimestamp();

            await ticketChannel.send({
              content: `🎟️ **New Support Ticket (Created by Staff)**\nFor: **${user.tag}**\nID: ${user.id}`,
              embeds: [embed],
            });

            await user.send(`📩 A support ticket has been created for you by staff. You can reply here to communicate with them.`)
              .catch(() => { console.warn(`⚠️ Could not DM user ${user.tag}`); });

            await message.reply(`✅ Ticket created for **${user.tag}**.`);
            console.log(`📨 Staff manually created ticket for ${user.tag}`);
          } else {
            await message.reply(`⚠️ A ticket already exists for **${user.tag}**.`);
          }

          return;
        }
      }

      // ======================
      // USER: DM → Ticket
      // ======================
      if (message.channel.type === ChannelType.DM) {
        const supporttickets = config.supporttickets;
        if (!supporttickets) {
          await message.reply('❌ Sorry the support team is currently not accepting any new tickets. Check the bot status ocassionally for ✅ to know support tickets are open.');
          console.log(`⚠️ Ignored DM from ${message.author.tag} because support tickets are disabled.`);
          return;
        }

        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return console.error('❌ Guild not found.');

        let category = guild.channels.cache.find(
          c => c.name === SUPPORT_CATEGORY_NAME && c.type === ChannelType.GuildCategory
        );
        if (!category) {
          category = await guild.channels.create({
            name: SUPPORT_CATEGORY_NAME,
            type: ChannelType.GuildCategory,
          });
        }

        const channelName = message.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
        let ticketChannel = guild.channels.cache.find(
          c => c.name === channelName && c.parentId === category.id
        );

        const userEmbed = new EmbedBuilder()
          .setColor('Red')
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
          .setDescription(message.content || '*No content*')
          .setFooter({ text: `DM Message ID: ${message.id}` })
          .setTimestamp();

        if (!ticketChannel) {
          ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Ticket for ${message.author.tag} (${message.author.id})`,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              ...STAFF_ROLE_IDS.map(roleId => ({
                id: roleId,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              })),
            ],
          });

          await ticketChannel.send({
            content: `🎟️ **New Support Ticket**\nFrom: **${message.author.tag}**\nID: ${message.author.id}`,
            embeds: [userEmbed],
          });

          await message.reply('✅ A support ticket has been opened. The admin team will respond shortly.');
          console.log(`📨 New ticket opened for ${message.author.tag}`);
        } else {
          await ticketChannel.send({ embeds: [userEmbed] });
          await message.react('✅');
          console.log(`📨 DM added to existing ticket for ${message.author.tag}`);
        }
      }

      // ======================
      // STAFF: Ticket channel messages
      // ======================
      else if (message.guild && message.channel.parent?.name === SUPPORT_CATEGORY_NAME) {
        await handleStaffMessage(client, message);
      }

    } catch (err) {
      console.error('❗ Support Ticket Error (messageCreate):', err);
    }
  },

  // -------------------------
  // Sync DM edits
  // -------------------------
  handleMessageUpdate: async (client, oldMessage, newMessage) => {
    try {
      if (newMessage.author.bot || newMessage.channel.type !== ChannelType.DM) return;
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const channelName = newMessage.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
      const ticketChannel = guild.channels.cache.find(
        c => c.name === channelName && c.parent?.name === SUPPORT_CATEGORY_NAME
      );
      if (!ticketChannel) return;

      const msgs = await ticketChannel.messages.fetch({ limit: 50 });
      const targetMsg = msgs.find(m => m.embeds[0]?.footer?.text?.includes(newMessage.id));
      if (!targetMsg) return;

      const previousDesc = targetMsg.embeds[0].description || '';
      const newDescription = buildStackedDescription(newMessage.content, previousDesc);

      const embed = EmbedBuilder.from(targetMsg.embeds[0])
        .setAuthor({ name: newMessage.author.tag, iconURL: newMessage.author.displayAvatarURL() })
        .setDescription(newDescription)
        .setTimestamp();

      await targetMsg.edit({ embeds: [embed] });

    } catch (err) {
      console.error('❌ Support Ticket edit sync failed:', err);
    }
  },

  // -------------------------
  // Sync DM deletes
  // -------------------------
  handleMessageDelete: async (client, deletedMessage) => {
    try {
      if (deletedMessage.author.bot || deletedMessage.channel.type !== ChannelType.DM) return;
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const channelName = deletedMessage.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
      const ticketChannel = guild.channels.cache.find(
        c => c.name === channelName && c.parent?.name === SUPPORT_CATEGORY_NAME
      );
      if (!ticketChannel) return;

      const msgs = await ticketChannel.messages.fetch({ limit: 50 });
      const targetMsg = msgs.find(m => m.embeds[0]?.footer?.text?.includes(deletedMessage.id));
      if (!targetMsg) return;

      const previousDesc = targetMsg.embeds[0].description || '';
      const newDescription = buildStackedDescription(
        deletedMessage.content || '*Message deleted*',
        previousDesc,
        true
      );

      const embed = EmbedBuilder.from(targetMsg.embeds[0]).setDescription(newDescription);
      await targetMsg.edit({ embeds: [embed] });

      await ticketChannel.send({ content: `⚠️ A message was deleted by ${deletedMessage.author.tag}` });

    } catch (err) {
      console.error('❌ Support Ticket delete sync failed:', err);
    }
  },
};

// -------------------------
// STAFF MESSAGE HANDLER
// -------------------------
async function handleStaffMessage(client, message) {
  const userIdMatch = message.channel.topic?.match(/\((\d+)\)$/);
  if (!userIdMatch) return;
  const userId = userIdMatch[1];
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  const content = message.content.trim();

  // ---- Reply ----
  if (content.startsWith(REPLY_PREFIX)) {
    const replyText = content.slice(REPLY_PREFIX.length).trim();
    if (!replyText) return await message.react('✅');
    await message.delete().catch(() => {});

    try {
      const dmMsg = await user.send(`📩 **Support Reply:** ${replyText}`);
      const staffEmbed = new EmbedBuilder()
        .setColor('Blue')
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(replyText)
        .setFooter({ text: `Sent DM Message ID: ${dmMsg.id}` })
        .setTimestamp();
      await message.channel.send({ embeds: [staffEmbed] });
    } catch (err) {
      console.error('❌ Failed to send DM:', err);
      await message.channel.send('❌ Could not DM the user.');
    }

    await message.react('✅');
    return;
  }

  // ---- Edit / Delete / Close / etc. ----
  await handleStaffSubcommands(client, message, user);
}

// Extracted subcommands to keep main logic clean
async function handleStaffSubcommands(client, message, user) {
  const content = message.content.trim();

  // ---- Edit ----
  if (content.startsWith(EDIT_PREFIX)) {
    const args = content.split(' ').slice(1);
    const msgId = args.shift();
    const newText = args.join(' ');
    if (!msgId || !newText) return;

    try {
      const targetMsg = await message.channel.messages.fetch(msgId).catch(() => null);
      if (!targetMsg) return await message.channel.send('❌ Message not found.');

      const embed = targetMsg.embeds[0];
      const footerText = embed?.footer?.text || '';
      const dmMessageIdMatch = footerText.match(/Sent DM Message ID:\s*(\d+)/);
      const dmMessageId = dmMessageIdMatch ? dmMessageIdMatch[1] : null;

      const previousDesc = embed?.description || '';
      const newDescription = buildStackedDescription(newText, previousDesc);

      const newEmbed = EmbedBuilder.from(embed)
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(newDescription)
        .setTimestamp();

      await targetMsg.edit({ embeds: [newEmbed] });

      if (dmMessageId) {
        const dmMsg = await user.createDM().then(dm => dm.messages.fetch(dmMessageId).catch(() => null));
        if (dmMsg) await dmMsg.edit(`📩 **Support Reply:** ${newText}`);
      }
    } catch (err) {
      console.error('❌ Edit failed:', err);
      await message.channel.send('❌ Failed to edit message.');
    }
    await message.delete().catch(() => {});
    return;
  }

  // ---- Delete ----
  if (content.startsWith(DELETE_PREFIX)) {
    const args = content.split(' ').slice(1);
    const msgId = args.shift();
    if (!msgId) return;

    try {
      const targetMsg = await message.channel.messages.fetch(msgId).catch(() => null);
      if (!targetMsg) return await message.channel.send('❌ Message not found.');

      const embed = targetMsg.embeds[0];
      const footerText = embed?.footer?.text || '';
      const dmMessageIdMatch = footerText.match(/Sent DM Message ID:\s*(\d+)/);
      const dmMessageId = dmMessageIdMatch ? dmMessageIdMatch[1] : null;

      const previousDesc = embed?.description || '';
      const newDescription = buildStackedDescription('(Deleted by staff)', previousDesc, true);

      await targetMsg.edit({ embeds: [EmbedBuilder.from(embed).setDescription(newDescription)] });

      if (dmMessageId) {
        const dmMsg = await user.createDM().then(dm => dm.messages.fetch(dmMessageId).catch(() => null));
        if (dmMsg) await dmMsg.delete().catch(() => {});
      }
    } catch (err) {
      console.error('❌ Delete failed:', err);
      await message.channel.send('❌ Failed to delete message.');
    }
    await message.delete().catch(() => {});
    return;
  }

  // ---- Close ----
  if (content.startsWith(CLOSE_PREFIX)) {
    await user.send('📩 Your support ticket has been closed.').catch(() => {});
    await message.channel.delete();
    console.log(`❌ Ticket for ${user.tag} closed by staff.`);
    return;
  }

  // ---- Silent Close ----
  if (content.startsWith(SILENT_CLOSE_PREFIX)) {
    await message.channel.delete();
    console.log(`❌ Ticket silently closed.`);
    return;
  }

  // ---- Clear ----
  if (content.startsWith(CLEAR_PREFIX)) {
    try {
      const dmChannel = await user.createDM();
      const msgs = await dmChannel.messages.fetch({ limit: 100 });
      const botMsgs = msgs.filter(m => m.author.id === client.user.id);
      for (const [id, m] of botMsgs) await m.delete().catch(() => {});
      await message.react('✅');
    } catch {
      await message.react('✅');
    }
  }
}

module.exports.updateBotStatus = updateBotStatus;