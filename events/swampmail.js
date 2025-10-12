const { ChannelType, PermissionFlagsBits } = require('discord.js');

// CONFIGURE THESE:
const GUILD_ID = 'YOUR_GUILD_ID';
const SUPPORT_CATEGORY_NAME = 'support-tickets';
const STAFF_ROLE_IDS = ["1069716885467312188", "1253964506317586453", "1069083357100642316", "1416904399208321164"]; // Add multiple if needed
const REPLY_PREFIX = '!reply';

module.exports = async (client, message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // If the message is a DM to the bot
  if (message.channel.type === ChannelType.DM) {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found.');

    // Find or create the ticket category
    let category = guild.channels.cache.find(
      (c) => c.name === SUPPORT_CATEGORY_NAME && c.type === ChannelType.GuildCategory
    );

    if (!category) {
      category = await guild.channels.create({
        name: SUPPORT_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    // Check if user already has a ticket
    let existing = guild.channels.cache.find(
      (c) => c.name === message.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-')
    );

    // Create ticket channel if not existing
    if (!existing) {
      existing = await guild.channels.create({
        name: message.author.username.toLowerCase().replace(/[^a-z0-9-_]/gi, '-'),
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Ticket for ${message.author.tag} (${message.author.id})`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          ...STAFF_ROLE_IDS.map((roleId) => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          })),
        ],
      });

      await existing.send(`🎟️ **New Modmail Ticket**\nFrom: **${message.author.tag}**\nID: ${message.author.id}`);
    }

    // Post the DM message to the ticket channel
    await existing.send(`💬 **${message.author.username}:** ${message.content}`);

    await message.reply('✅ Your message has been sent to the support team!');
  }

  // If message is in a guild ticket channel and starts with !reply
  else if (message.guild && message.content.startsWith(REPLY_PREFIX)) {
    // Only handle messages from inside the support category
    if (message.channel.parent?.name !== SUPPORT_CATEGORY_NAME) return;

    const replyText = message.content.slice(REPLY_PREFIX.length).trim();
    if (!replyText) {
      await message.reply('⚠️ Please include a message after `!reply`.');
      return;
    }

    // Extract user ID from channel topic
    const userIdMatch = message.channel.topic?.match(/\((\d+)\)$/);
    if (!userIdMatch) {
      await message.reply('❌ Could not find the user ID for this ticket.');
      return;
    }

    const userId = userIdMatch[1];
    const user = await client.users.fetch(userId).catch(() => null);

    if (!user) {
      await message.reply('❌ Could not DM the user (possibly left the server or blocked the bot).');
      return;
    }

    // DM the user
    await user.send(`📩 **Support Reply:** ${replyText}`).catch(() => {
      message.reply('❌ Failed to send DM.');
    });

    // Confirm in the ticket channel
    await message.channel.send(`✅ **Reply sent to ${user.tag}:** ${replyText}`);
  }
};
