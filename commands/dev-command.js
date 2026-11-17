const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only: remove a member’s reactions from all opt-in time slots.')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The person to remove from all opt-in time slots')
        .setRequired(true)),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.warn('⚠️ Defer failed, continuing without defer:', err?.message || err);
    }

    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply('❌ This command must be run in a server.');
    }

    const target = interaction.options.getUser('player', true);
    if (!config.OptInChannelID) {
      return interaction.editReply('❌ OptInChannelID is not configured.');
    }

    try {
      const optInChannel = await interaction.client.channels.fetch(config.OptInChannelID);
      if (!optInChannel || !optInChannel.isTextBased()) {
        return interaction.editReply('❌ The configured Opt-In channel is unavailable or is not a text channel.');
      }
      if (optInChannel.guildId !== guild.id) {
        return interaction.editReply('❌ The configured Opt-In channel is not in this server.');
      }

      const me = guild.members.me;
      const requiredPermissions = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ];
      const channelPermissions = me && optInChannel.permissionsFor(me);
      if (!channelPermissions || !channelPermissions.has(requiredPermissions)) {
        return interaction.editReply('❌ Bot needs View Channel, Read Message History, and Manage Messages in the Opt-In channel.');
      }

      await interaction.editReply(`🔎 Scanning opt-in time slots for ${target.tag}…`);

      const slotMessages = [];
      let before;
      while (true) {
        const batch = await optInChannel.messages.fetch({
          limit: 100,
          ...(before ? { before } : {})
        });
        if (batch.size === 0) break;

        for (const message of batch.values()) {
          const isTimeSlot = message.author.id === interaction.client.user.id &&
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

      const status = failedCount === 0 ? '✅' : removedCount > 0 ? '⚠️' : '❌';
      const result = `${status} Removed ${removedCount} reaction(s) for ${target.tag} across ${slotMessages.length} opt-in time-slot message(s).` +
        (failedCount > 0 ? `\n${failedCount} reaction(s) could not be checked or removed; see bot logs for details.` : '');
      await interaction.editReply(result);

    } catch (err) {
      console.error('❌ Error removing opt-in reactions:', err);
      await interaction.editReply(`❌ Failed to remove reactions: ${err.message}`);
    }
  },
};