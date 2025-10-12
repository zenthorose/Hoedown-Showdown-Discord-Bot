const { ChannelType, PermissionFlagsBits } = require('discord.js');

// CONFIGURATION
const GUILD_ID = process.env.GUILD_ID; // Stored in your Render environment variables
const SUPPORT_CATEGORY_NAME = 'support-tickets';
const STAFF_ROLE_IDS = [
  "1069716885467312188",
  "1253964506317586453",
  "1069083357100642316",
  "1416904399208321164"
]; // Add or remove as needed
const REPLY_PREFIX = '!reply';

module.exports = async (client, message) => {
  try {
    // Ignore any messages from bots
    if (message.author.bot) return;

    // -------------------------
    // 📨 Handle DM to the Bot
    // -------------------------
    if (message.channel.type === ChannelType.DM) {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        console.error('❌ Guild not found. Make sure GUILD_ID is correct.');
        return;
      }

      // Find or create the support ticket category
      let category = guild.channels.cache.find(
        (c) => c.name === SUPPORT_CATEGORY_NAME && c.type === ChannelType.GuildCategory
      );

      if (!category) {
        console.log('📁 Creating support-tickets category...');
        category = await guild.channels.create({
          name: SUPPORT_CATEGORY_NAME,
          type: ChannelType.GuildCategory,
        });
      }

      // Normalize channel name from username
      const channelName = message.author.username
        .toLowerCase()
        .replace(/[^a-z0-9-_]/gi, '-');

      // Check if user already has a ticket
      let ticketChannel = guild.channels.cache.find(
        (c) => c.name === channelName && c.parentId === category.id
      );

      // Create a new ticket channel if needed
      if (!ticketChannel) {
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

        await ticketChannel.send(`🎟️ **New Modmail Ticket**\nFrom: **${message.author.tag}**\nID: ${message.author.id}`);
      }

      // Send the DM content to the ticket channel
      await ticketChannel.send(`💬 **${message.author.username}:** ${message.content}`);

      // Confirm message sent to user
      await message.reply('✅ Your message has been sent to the support team!');
      console.log(`📨 Ticket message received from ${message.author.tag}`);
    }

    // -------------------------
    // 💬 Handle Replies from Staff
    // -------------------------
    else if (message.guild && message.content.startsWith(REPLY_PREFIX)) {
      // Must be inside a support ticket channel
      if (message.channel.parent?.name !== SUPPORT_CATEGORY_NAME) return;

      const replyText = message.content.slice(REPLY_PREFIX.length).trim();
      if (!replyText) {
        await message.reply('⚠️ Please include a message after `!reply`.');
        return;
      }

      // Extract user ID from the topic
      const userIdMatch = message.channel.topic?.match(/\((\d+)\)$/);
      if (!userIdMatch) {
        await message.reply('❌ Could not find the user ID for this ticket.');
        return;
      }

      const userId = userIdMatch[1];
      const user = await client.users.fetch(userId).catch(() => null);

      if (!user) {
        await message.reply('❌ Could not DM the user (may have blocked the bot or left Discord).');
        return;
      }

      // Send DM reply
      await user.send(`📩 **Support Reply:** ${replyText}`).catch(() => {
        message.reply('❌ Failed to send DM.');
      });

      // Confirm in ticket channel
      await message.channel.send(`✅ **Reply sent to ${user.tag}:** ${replyText}`);
      console.log(`📤 Reply sent to ${user.tag}: ${replyText}`);
    }
  } catch (err) {
    console.error('❗ Modmail Error:', err);
  }
};
