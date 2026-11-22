const { SlashCommandBuilder } = require('@discordjs/builders');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');
const { connectHoedownInfo } = require('../database/hoedownInfo');
const { getBotSettings } = require('../database/botSettings');
const {
  createCurrentTeamDraft,
  formatTeamCheckPreview,
  splitDiscordMessage
} = require('../database/teamDrafts');

let commandRunning = false;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grab-reactions')
    .setDescription('Grabs people that reacted to the message to form teams out of them.')
    .setDefaultMemberPermissions(0)
    .addStringOption(option =>
      option
        .setName('messageid')
        .setDescription('The ID of the message to check reactions for')
        .setRequired(true)
    ),

  async execute(interaction) {
    let replyMessage;
    let botSettings;
    let botSettingsPromise;
    const loadBotSettings = () => {
      if (!botSettingsPromise) botSettingsPromise = getBotSettings();
      return botSettingsPromise;
    };

    async function logUsage(extra = '') {
      try {
        const settings = botSettings || await loadBotSettings();
        const logChannelId = settings.channels.LOG_CHANNEL_ID || config.LOG_CHANNEL_ID;
        const logChannel = await interaction.client.channels.fetch(logChannelId);
        if (logChannel) {
          await logChannel.send(
            `📝 **/grab-reactions** used by **${interaction.user.tag}** in **#${interaction.channel?.name || 'Unknown'}** ${extra}`
          );
        }
      } catch (error) {
        console.error('Failed to log /grab-reactions:', error);
      }
    }

    if (commandRunning) {
      return interaction.reply({
        content: '❌ A team generation is already running. Please wait for it to finish.',
        ephemeral: true
      });
    }

    commandRunning = true;
    try {
      const hasPermission = await checkPermissions(interaction);
      const messageId = interaction.options.getString('messageid');
      await logUsage(`(messageId: ${messageId})`);

      if (!hasPermission) {
        await logUsage('❌ Permission denied');
        return interaction.reply({
          content: '❌ You do not have permission to use this command!',
          ephemeral: true
        });
      }

      botSettings = await loadBotSettings();
      replyMessage = await interaction.reply({
        content: '🔄 Collecting reactions and generating the Team Check draft...',
        fetchReply: true
      });

      const channelId = botSettings.channels.OptInChannelID || config.OptInChannelID;
      if (!channelId) throw new Error('OptInChannelID is not defined in config.json.');
      const channel = await interaction.guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) throw new Error(`Invalid or non-text Opt-In channel: ${channelId}`);

      const message = await channel.messages.fetch(messageId);
      if (!message) throw new Error('Message not found in the configured Opt-In channel.');

      const uniquePlayers = new Map();
      for (const reaction of message.reactions.cache.values()) {
        let lastId;
        while (true) {
          const users = await reaction.users.fetch({ limit: 100, ...(lastId ? { after: lastId } : {}) });
          if (users.size === 0) break;
          users.forEach((user) => {
            if (!user.bot && !uniquePlayers.has(user.id)) {
              uniquePlayers.set(user.id, { id: user.id, name: user.username });
            }
          });
          if (users.size < 100) break;
          lastId = users.last().id;
        }
      }

      const teamCheckChannelId = botSettings.channels.TeamCheckChannelID ||
        config.TeamCheckChannelID ||
        process.env.TEAM_CHECK_CHANNEL_ID;
      if (botSettings.grabReactions.ENABLE_TEAM_CHECK_POSTING && !teamCheckChannelId) {
        throw new Error('Set channels.TeamCheckChannelID in bot settings or TeamCheckChannelID in config.json before posting Team Check previews.');
      }

      const { collections, databases } = await connectHoedownInfo();
      const draft = await createCurrentTeamDraft({
        reactedPlayers: [...uniquePlayers.values()],
        sourceMessageId: messageId,
        membersCollection: collections.members,
        avoidsCollection: collections.avoids,
        previousPairingsCollection: collections.previousPairings,
        playersThatReactedCollection: collections.playersThatReacted,
        teamCheckCollection: collections.teamCheck,
        roundsDatabase: databases.rounds
      });

      let postingStatus = 'disabled';
      if (botSettings.grabReactions.ENABLE_TEAM_CHECK_POSTING) {
        try {
          const teamCheckChannel = await interaction.client.channels.fetch(teamCheckChannelId);
          if (!teamCheckChannel || !teamCheckChannel.isTextBased()) {
            throw new Error(`Team Check channel is not a text channel: ${teamCheckChannelId}`);
          }

          const messageIds = [];
          for (const content of splitDiscordMessage(formatTeamCheckPreview(draft))) {
            const posted = await teamCheckChannel.send(content);
            messageIds.push(posted.id);
            const update = await collections.teamCheck.updateOne({
              _id: 'current',
              generationId: draft.generationId
            }, {
              $set: { previewMessageIds: messageIds, previewStatus: 'posting' }
            });
            if (!update.matchedCount) throw new Error('The saved Team Check draft changed while posting its preview.');
          }
          postingStatus = 'posted';
          const update = await collections.teamCheck.updateOne({
            _id: 'current',
            generationId: draft.generationId
          }, {
            $set: { previewStatus: postingStatus }
          });
          if (!update.matchedCount) throw new Error('The saved Team Check draft changed after posting its preview.');
        } catch (error) {
          try {
            const update = await collections.teamCheck.updateOne({
              _id: 'current',
              generationId: draft.generationId
            }, {
              $set: {
                previewStatus: 'failed',
                previewError: String(error.message).slice(0, 1000)
              }
            });
            if (!update.matchedCount) {
              throw new Error('The current draft no longer matches this preview generation.');
            }
          } catch (statusError) {
            throw new Error(`Draft for Round #${draft.round} was saved, but preview posting failed (${error.message}) and the failure status could not be recorded (${statusError.message}).`);
          }
          throw new Error(`Draft for Round #${draft.round} was saved, but Team Check preview posting failed: ${error.message}`);
        }
      } else {
        const update = await collections.teamCheck.updateOne({
          _id: 'current',
          generationId: draft.generationId
        }, {
          $set: { previewStatus: postingStatus }
        });
        if (!update.matchedCount) throw new Error('The saved Team Check draft changed before its posting status was recorded.');
      }

      const excludedCount = draft.excludedPlayers.length;
      const resultMessage = [
        `✅ Team Check draft for Round #${draft.round} saved in MongoDB.`,
        postingStatus === 'posted'
          ? 'The preview was posted to Team Check.'
          : 'Team Check posting is disabled; the draft and player snapshot were still saved.',
        excludedCount > 0 ? `${excludedCount} reacted user(s) were excluded because they lack a valid registered region/profile.` : ''
      ].filter(Boolean).join('\n');
      await replyMessage.edit(resultMessage);
      await logUsage(`✅ Round #${draft.round} draft generated; ${postingStatus} Team Check preview.`);
      setTimeout(async () => {
        try { await replyMessage.delete(); } catch {}
      }, 10000);
    } catch (error) {
      console.error('❌ Error in /grab-reactions:', error);
      await logUsage(`❌ Error: ${error.message}`);
      if (replyMessage) {
        try {
          await replyMessage.edit(`❌ Could not complete team generation: ${error.message}`);
        } catch (notifyError) {
          console.error('Failed to notify /grab-reactions caller:', notifyError);
        }
      } else if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Could not generate teams: ${error.message}`, ephemeral: true });
      }
    } finally {
      commandRunning = false;
    }
  }
};
