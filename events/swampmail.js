const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// CONFIGURATION
const GUILD_ID = process.env.GUILD_ID;
const SUPPORT_CATEGORY_NAME = 'support-tickets';
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

module.exports = (client) => {

  // -------------------------
  // 📨 Handle DM -> Ticket
  // -------------------------
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;

      // -------------------------
      // DM messages → ticket
      // -------------------------
      if (message.channel.type === ChannelType.DM) {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return console.error('❌ Guild not found. Make sure GUILD_ID is correct.');

        // Ensure support category exists
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
            content: `🎟️ **New Modmail Ticket**\nFrom: **${message.author.tag}**\nID: ${message.author.id}`,
            embeds: [userEmbed]
          });

          await message.reply(
            '✅ I have opened a support ticket with the Admin team and notified them. They will respond as soon as they are available to help you.'
          );
          console.log(`📨 New ticket opened for ${message.author.tag}`);
        } else {
          await ticketChannel.send({ embeds: [userEmbed] });
          await message.react('✅');
          console.log(`📨 DM added to existing ticket for ${message.author.tag}`);
        }
      }

      // -------------------------
      // Staff messages in ticket
      // -------------------------
      else if (message.guild && message.channel.parent?.name === SUPPORT_CATEGORY_NAME) {
        handleStaffMessage(client, message);
      }

    } catch (err) {
      console.error('❗ Modmail Error (messageCreate):', err);
    }
  });

  // -------------------------
  // ✏️ Sync DM edits
  // -------------------------
  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (newMessage.author.bot || newMessage.channel.type !== ChannelType.DM) return;

      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const channelName = newMessage.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
      const ticketChannel = guild.channels.cache.find(
        c => c.name === channelName && c.parent?.name === SUPPORT_CATEGORY_NAME
      );
      if (!ticketChannel) return;

      const embed = new EmbedBuilder()
        .setColor('Red')
        .setAuthor({ name: newMessage.author.tag, iconURL: newMessage.author.displayAvatarURL() })
        .setDescription(`${newMessage.content} (Edited)`)
        .setFooter({ text: `DM Message ID: ${newMessage.id}` })
        .setTimestamp();

      const msgs = await ticketChannel.messages.fetch({ limit: 50 });
      const targetMsg = msgs.find(m => m.embeds[0]?.footer?.text?.includes(newMessage.id));
      if (targetMsg) await targetMsg.edit({ embeds: [embed] });

    } catch (err) {
      console.error('❌ Modmail edit sync failed:', err);
    }
  });

  // -------------------------
  // 🗑 Sync DM deletes (keep ticket channel)
  // -------------------------
  client.on('messageDelete', async (deletedMessage) => {
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

      const embed = EmbedBuilder.from(targetMsg.embeds[0])
        .setDescription(`${targetMsg.embeds[0].description} (Deleted by user)`);
      await targetMsg.edit({ embeds: [embed] });

      // Optional: notify staff
      await ticketChannel.send({ content: `⚠️ A message was deleted by ${deletedMessage.author.tag}` });

    } catch (err) {
      console.error('❌ Modmail delete sync failed:', err);
    }
  });

};

// -------------------------
// Staff message handler
// -------------------------
async function handleStaffMessage(client, message) {
  const REPLY_PREFIX = '!reply';
  const EDIT_PREFIX = '!edit';
  const DELETE_PREFIX = '!delete';
  const CLOSE_PREFIX = '!close';
  const SILENT_CLOSE_PREFIX = '!silentclose';
  const CLEAR_PREFIX = '!clear';

  const userIdMatch = message.channel.topic?.match(/\((\d+)\)$/);
  if (!userIdMatch) return;
  const userId = userIdMatch[1];
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  // ---- Reply to user ----
  if (message.content.startsWith(REPLY_PREFIX)) {
    const replyText = message.content.slice(REPLY_PREFIX.length).trim();
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

  // ---- Edit message ----
  if (message.content.startsWith(EDIT_PREFIX)) {
    const args = message.content.split(' ').slice(1);
    const channelMessageId = args.shift();
    const newContent = args.join(' ');
    if (!channelMessageId || !newContent) return;

    try {
      const targetMsg = await message.channel.messages.fetch(channelMessageId).catch(() => null);
      if (!targetMsg) return await message.channel.send('❌ Message not found.');

      const embed = targetMsg.embeds[0];
      const footerText = embed?.footer?.text || '';
      const dmMessageIdMatch = footerText.match(/Sent DM Message ID:\s*(\d+)/);
      const dmMessageId = dmMessageIdMatch ? dmMessageIdMatch[1] : null;

      const newEmbed = EmbedBuilder.from(embed)
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(newContent)
        .setTimestamp();

      await targetMsg.edit({ embeds: [newEmbed] });

      if (dmMessageId) {
        const dmChannel = await user.createDM();
        const dmMsg = await dmChannel.messages.fetch(dmMessageId).catch(() => null);
        if (dmMsg) await dmMsg.edit(`📩 **Support Reply:** ${newContent}`);
      }
    } catch (err) {
      console.error('❌ Edit failed:', err);
      await message.channel.send('❌ Failed to edit message.');
    }

    await message.delete().catch(() => {});
    return;
  }

  // ---- Delete staff message (sync with DM) ----
  if (message.content.startsWith(DELETE_PREFIX)) {
    const args = message.content.split(' ').slice(1);
    const channelMessageId = args.shift();
    if (!channelMessageId) return;

    try {
      const targetMsg = await message.channel.messages.fetch(channelMessageId).catch(() => null);
      if (!targetMsg) return await message.channel.send('❌ Message not found.');

      const embed = targetMsg.embeds[0];
      const footerText = embed?.footer?.text || '';
      const dmMessageIdMatch = footerText.match(/Sent DM Message ID:\s*(\d+)/);
      const dmMessageId = dmMessageIdMatch ? dmMessageIdMatch[1] : null;

      if (dmMessageId) {
        const dmChannel = await user.createDM();
        const dmMsg = await dmChannel.messages.fetch(dmMessageId).catch(() => null);
        if (dmMsg) await dmMsg.delete().catch(() => {});
      }

      await targetMsg.delete().catch(() => {});
    } catch (err) {
      console.error('❌ Delete failed:', err);
      await message.channel.send('❌ Failed to delete message.');
    }

    await message.delete().catch(() => {});
    return;
  }

  // ---- Close ticket ----
  if (message.content.startsWith(CLOSE_PREFIX)) {
    if (user) await user.send('📩 Your support ticket has been closed.').catch(() => {});
    await message.channel.delete();
    console.log(`❌ Ticket for ${user?.tag || userId} closed by staff.`);
    return;
  }

  // ---- Silent close ----
  if (message.content.startsWith(SILENT_CLOSE_PREFIX)) {
    await message.channel.delete();
    console.log(`❌ Ticket silently closed (no DM).`);
    return;
  }

  // ---- Clear bot messages ----
  if (message.content.startsWith(CLEAR_PREFIX)) {
    try {
      const dmChannel = await user.createDM();
      const messages = await dmChannel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(m => m.author.id === client.user.id);
      for (const [id, msg] of botMessages) await msg.delete().catch(() => {});
      await message.react('✅');
    } catch {
      await message.react('✅');
    }
    return;
  }
}
