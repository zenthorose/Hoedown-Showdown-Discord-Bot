const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

// CONFIGURATION
const GUILD_ID = process.env.GUILD_ID; // Stored in Render environment variables
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
const EDIT_PREFIX = '!editmsg';
const DELETE_PREFIX = '!deletemsg';

module.exports = async (client, message) => {
  try {
    if (message.author.bot) return;

    // -------------------------
    // 📨 Handle DM to the Bot
    // -------------------------
    if (message.channel.type === ChannelType.DM) {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return console.error('❌ Guild not found. Make sure GUILD_ID is correct.');

      // Find or create support-tickets category
      let category = guild.channels.cache.find(
        c => c.name === SUPPORT_CATEGORY_NAME && c.type === ChannelType.GuildCategory
      );
      if (!category) {
        console.log('📁 Creating support-tickets category...');
        category = await guild.channels.create({
          name: SUPPORT_CATEGORY_NAME,
          type: ChannelType.GuildCategory,
        });
      }

      // Normalize channel name
      const channelName = message.author.username
        .toLowerCase()
        .replace(/[^a-z0-9-_]/gi, '-');

      // Check if ticket already exists
      let ticketChannel = guild.channels.cache.find(
        c => c.name === channelName && c.parentId === category.id
      );

      // If ticket exists, just add the DM to it and react
      if (ticketChannel) {
        const userEmbed = new EmbedBuilder()
          .setColor('Red')
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
          .setDescription(message.content || '*No content*')
          .setFooter({ text: `DM Message ID: ${message.id}` })
          .setTimestamp();

        await ticketChannel.send({ embeds: [userEmbed] });
        await message.react('✅');
        console.log(`📨 DM added to existing ticket for ${message.author.tag}`);
        return;
      }

      // Otherwise create a new ticket
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Ticket for ${message.author.tag} (${message.author.id})`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
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

      const userEmbed = new EmbedBuilder()
        .setColor('Red')
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(message.content || '*No content*')
        .setFooter({ text: `DM Message ID: ${message.id}` })
        .setTimestamp();

      await ticketChannel.send({
        content: `🎟️ **New Modmail Ticket**\nFrom: **${message.author.tag}**\nID: ${message.author.id}`,
        embeds: [userEmbed]
      });

      await message.reply(
        '✅ I have opened a support ticket with the Admin team and notified them. They will respond as soon as they are available to help you.'
      );

      console.log(`📨 New ticket opened for ${message.author.tag}`);
    }

    // -------------------------
    // 💬 Handle Staff Messages
    // -------------------------
    else if (message.guild && message.channel.parent?.name === SUPPORT_CATEGORY_NAME) {
      const userIdMatch = message.channel.topic?.match(/\((\d+)\)$/);
      if (!userIdMatch) return;

      const userId = userIdMatch[1];
      const user = await client.users.fetch(userId).catch(() => null);

      // ---- Reply to user ----
      if (message.content.startsWith(REPLY_PREFIX)) {
        const replyText = message.content.slice(REPLY_PREFIX.length).trim();
        if (!replyText) return await message.react('✅');

        await message.delete().catch(() => {});

        const staffEmbed = new EmbedBuilder()
          .setColor('Blue')
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
          .setDescription(replyText)
          .setTimestamp();

        await message.channel.send({ embeds: [staffEmbed] });

        if (user) {
        try {
            const dmMsg = await user.send(`📩 **Support Reply:** ${replyText}`);
            
            // Repost to staff channel showing the DM message ID for tracking
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
        }

        await message.react('✅');
      }

      // ---- Edit a DM message ----
      else if (message.content.startsWith(EDIT_PREFIX)) {
        const args = message.content.split(' ').slice(1);
        const dmMessageId = args.shift();
        const newContent = args.join(' ');

        if (!dmMessageId || !newContent) return await message.react('✅');

        try {
          const dmChannel = await user.createDM();
          const targetMsg = await dmChannel.messages.fetch(dmMessageId).catch(() => null);

          if (!targetMsg) {
            await message.channel.send('❌ Could not find a DM message with that ID.');
          } else {
            await targetMsg.edit(newContent);
            await message.channel.send(`✏️ Message \`${dmMessageId}\` updated.`);
          }
        } catch (err) {
          console.error('❌ Edit failed:', err);
          await message.channel.send('❌ Failed to edit message.');
        }

        await message.delete().catch(() => {});
      }

      // ---- Delete a DM message ----
      else if (message.content.startsWith(DELETE_PREFIX)) {
        const dmMessageId = message.content.split(' ')[1];
        if (!dmMessageId) return await message.react('✅');

        try {
          const dmChannel = await user.createDM();
          const targetMsg = await dmChannel.messages.fetch(dmMessageId).catch(() => null);

          if (!targetMsg) {
            await message.channel.send('❌ Could not find a DM message with that ID.');
          } else {
            await targetMsg.delete().catch(() => {});
            await message.channel.send(`🗑️ Message \`${dmMessageId}\` deleted.`);
          }
        } catch (err) {
          console.error('❌ Delete failed:', err);
          await message.channel.send('❌ Failed to delete message.');
        }

        await message.delete().catch(() => {});
      }

      // ---- Close ticket and notify ----
      else if (message.content.startsWith(CLOSE_PREFIX)) {
        if (user) {
          await user.send(
            '📩 The admin team has closed your support ticket. If your issue did not get resolved or you have another issue feel free to send me another DM.'
          ).catch(() => {});
        }

        await message.channel.delete();
        console.log(`❌ Ticket for ${user?.tag || userId} closed by staff.`);
      }

      // ---- Silent close (no DM) ----
      else if (message.content.startsWith(SILENT_CLOSE_PREFIX)) {
        await message.channel.delete();
        console.log(`❌ Ticket silently closed (no DM).`);
      }

      // ---- Clear bot messages from user's DM ----
      else if (message.content.startsWith(CLEAR_PREFIX)) {
        if (!user) return await message.react('✅');

        try {
          const dmChannel = await user.createDM();
          const messages = await dmChannel.messages.fetch({ limit: 100 });
          const botMessages = messages.filter(m => m.author.id === client.user.id);

          for (const [id, msg] of botMessages) {
            await msg.delete().catch(() => {});
          }

          await message.react('✅');
        } catch (err) {
          console.error('❌ Failed to clear messages:', err);
          await message.react('✅');
        }
      }
    }
  } catch (err) {
    console.error('❗ Modmail Error:', err);
  }
};
