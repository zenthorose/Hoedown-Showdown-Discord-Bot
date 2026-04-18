const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkPermissions } = require('../permissions');
const config = require('../config.json');

// Top-level toggles: set to `true` to perform that action, `false` to skip it.
const ENABLE_WIPE_OPTIN = true;                    // Wipe the Opt-In text channel's messages
const ENABLE_SET_EVERYONE_VIEW_DENY = true;         // Set @everyone ViewChannel to false on the Opt-In channel
const ENABLE_WIPE_ROUND_CHANNELS = true;            // Wipe each channel listed in config.roundChannels
const ENABLE_SET_EVERYONE_VIEW_DENY_ROUNDS = true;  // Set @everyone ViewChannel = false for each round channel
const ENABLE_WIPE_TEAM_CHANNELS = true;             // Wipe each channel listed in config.teamChannels
const ENABLE_SET_EVERYONE_VIEW_DENY_TEAMS = true;   // Set @everyone ViewChannel = false for each team channel
const ENABLE_LOGGING = true;                        // Post an audit message to LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hoedown-reset')
    .setDescription('Performs Hoedown reset actions (wipes opt-in and updates perms).')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    async function logUsage(msg = '') {
      if (!ENABLE_LOGGING) return;
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) await logChannel.send(`📝 **/hoedown-reset** used by **${interaction.user.tag}** ${msg}`);
      } catch (e) {
        console.error('Failed to send hoedown-reset log:', e);
      }
    }

    try {
      // Permission gate
      const hasPermission = await checkPermissions(interaction);
      await logUsage('(attempt)');
      if (!hasPermission) {
        await logUsage('(denied)');
        return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      }

      // Send confirmation buttons (ephemeral)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hoedown_reset_confirm').setLabel('Confirm').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('hoedown_reset_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ content: '⚠️ Are you sure you want to perform the Hoedown reset? This is irreversible.', components: [row], ephemeral: true });

      const replyMsg = await interaction.fetchReply();

      const filter = (i) => i.user.id === interaction.user.id && ['hoedown_reset_confirm', 'hoedown_reset_cancel'].includes(i.customId);
      const collector = replyMsg.createMessageComponentCollector({ filter, time: 30000, max: 1 });

      collector.on('collect', async (btnInt) => {
        try {
          if (btnInt.customId === 'hoedown_reset_cancel') {
            await btnInt.update({ content: '❌ Hoedown reset cancelled.', components: [] });
            await logUsage('(cancelled by user)');
            return;
          }

          // User confirmed
          await btnInt.update({ content: '⏳ Performing Hoedown reset...', components: [] });

          const channelId = config.OptInChannelID;
          if (!channelId) {
            await logUsage('(failed: OptInChannelID missing in config)');
            return interaction.editReply({ content: '❌ OptInChannelID not configured.' });
          }

          // Fetch channel
          let optInChannel;
          try {
            optInChannel = await interaction.client.channels.fetch(channelId);
          } catch (e) {
            console.error('Failed to fetch OptIn channel:', e);
            await logUsage('(failed: could not fetch OptIn channel)');
            return interaction.editReply({ content: '❌ Could not fetch the Opt-In channel.' });
          }

          // Action 1: Wipe messages
          if (ENABLE_WIPE_OPTIN) {
            try {
              if (optInChannel && optInChannel.isTextBased && optInChannel.isTextBased()) {
                let fetched;
                do {
                  fetched = await optInChannel.messages.fetch({ limit: 100 });
                  if (fetched.size === 0) break;
                  // bulkDelete will ignore messages older than 14 days; it's acceptable here
                  await optInChannel.bulkDelete(fetched, true).catch(err => console.warn('bulkDelete partial failure:', err));
                } while (fetched.size >= 2);
                console.log(`✅ Wiped messages in Opt-In channel (${channelId})`);
                await logUsage('(wiped Opt-In channel)');
              } else {
                console.warn('Opt-In channel is not text based. Skipping wipe.');
                await logUsage('(skip wipe: not a text channel)');
              }
            } catch (wipeErr) {
              console.error('Error wiping Opt-In channel:', wipeErr);
              await logUsage(`(wipe error: ${wipeErr.message})`);
            }
          } else {
            console.log('ℹ️ Skipped wiping Opt-In channel (toggle disabled).');
            await logUsage('(skip wipe: toggle disabled)');
          }

          // Action 2: Set @everyone ViewChannel = false
          if (ENABLE_SET_EVERYONE_VIEW_DENY) {
            try {
              if (!interaction.guild) throw new Error('Not in a guild');
              await optInChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
              console.log('🔒 Set everyone ViewChannel = false on Opt-In channel');
              await logUsage('(set everyone ViewChannel to false)');
            } catch (permErr) {
              console.error('Error setting everyone perm on Opt-In channel:', permErr);
              await logUsage(`(perm error: ${permErr.message})`);
            }
          } else {
            console.log('ℹ️ Skipped setting everyone view deny (toggle disabled).');
            await logUsage('(skip perm set: toggle disabled)');
          }

          // Action 3: Process all roundChannels from config
          if (config.roundChannels && typeof config.roundChannels === 'object') {
            for (const [roundKey, roundChannelId] of Object.entries(config.roundChannels)) {
              try {
                const roundChannel = await interaction.client.channels.fetch(roundChannelId);

                if (ENABLE_WIPE_ROUND_CHANNELS) {
                  try {
                    if (roundChannel && roundChannel.isTextBased && roundChannel.isTextBased()) {
                      let fetched;
                      do {
                        fetched = await roundChannel.messages.fetch({ limit: 100 });
                        if (fetched.size === 0) break;
                        await roundChannel.bulkDelete(fetched, true).catch(err => console.warn(`bulkDelete partial failure in round ${roundKey}:`, err));
                      } while (fetched.size >= 2);
                      console.log(`✅ Wiped messages in Round ${roundKey} channel (${roundChannelId})`);
                      await logUsage(`(wiped round channel ${roundKey})`);
                    } else {
                      console.warn(`Round ${roundKey} channel is not text based. Skipping wipe.`);
                      await logUsage(`(skip wipe round ${roundKey}: not a text channel)`);
                    }
                  } catch (wipeErr) {
                    console.error(`Error wiping Round ${roundKey} channel:`, wipeErr);
                    await logUsage(`(wipe error round ${roundKey}: ${wipeErr.message})`);
                  }
                } else {
                  console.log(`ℹ️ Skipped wiping Round ${roundKey} channel (toggle disabled).`);
                  await logUsage(`(skip wipe round ${roundKey}: toggle disabled)`);
                }

                if (ENABLE_SET_EVERYONE_VIEW_DENY_ROUNDS) {
                  try {
                    if (!interaction.guild) throw new Error('Not in a guild');
                    await roundChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
                    console.log(`🔒 Set everyone ViewChannel = false on Round ${roundKey} channel`);
                    await logUsage(`(set everyone ViewChannel false on round ${roundKey})`);
                  } catch (permErr) {
                    console.error(`Error setting everyone perm on Round ${roundKey} channel:`, permErr);
                    await logUsage(`(perm error round ${roundKey}: ${permErr.message})`);
                  }
                } else {
                  console.log(`ℹ️ Skipped setting everyone view deny for Round ${roundKey} (toggle disabled).`);
                }

              } catch (err) {
                console.error(`❌ Failed to process Round ${roundKey} (${roundChannelId}):`, err);
                await logUsage(`(error processing round ${roundKey}: ${err.message})`);
              }
            }
          } else {
            console.log('ℹ️ No roundChannels found in config to process.');
            await logUsage('(no roundChannels configured)');
          }

          // Action 4: Process all teamChannels from config
          if (config.teamChannels && typeof config.teamChannels === 'object') {
            for (const [teamKey, teamChannelId] of Object.entries(config.teamChannels)) {
              try {
                const teamChannel = await interaction.client.channels.fetch(teamChannelId);

                if (ENABLE_WIPE_TEAM_CHANNELS) {
                  try {
                    if (teamChannel && teamChannel.isTextBased && teamChannel.isTextBased()) {
                      let fetched;
                      do {
                        fetched = await teamChannel.messages.fetch({ limit: 100 });
                        if (fetched.size === 0) break;
                        await teamChannel.bulkDelete(fetched, true).catch(err => console.warn(`bulkDelete partial failure in team ${teamKey}:`, err));
                      } while (fetched.size >= 2);
                      console.log(`✅ Wiped messages in ${teamKey} channel (${teamChannelId})`);
                      await logUsage(`(wiped team channel ${teamKey})`);
                    } else {
                      console.warn(`${teamKey} channel is not text based. Skipping wipe.`);
                      await logUsage(`(skip wipe team ${teamKey}: not a text channel)`);
                    }
                  } catch (wipeErr) {
                    console.error(`Error wiping ${teamKey} channel:`, wipeErr);
                    await logUsage(`(wipe error team ${teamKey}: ${wipeErr.message})`);
                  }
                } else {
                  console.log(`ℹ️ Skipped wiping ${teamKey} channel (toggle disabled).`);
                  await logUsage(`(skip wipe team ${teamKey}: toggle disabled)`);
                }

                if (ENABLE_SET_EVERYONE_VIEW_DENY_TEAMS) {
                  try {
                    if (!interaction.guild) throw new Error('Not in a guild');
                    await teamChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
                    console.log(`🔒 Set everyone ViewChannel = false on ${teamKey} channel`);
                    await logUsage(`(set everyone ViewChannel false on team ${teamKey})`);
                  } catch (permErr) {
                    console.error(`Error setting everyone perm on ${teamKey} channel:`, permErr);
                    await logUsage(`(perm error team ${teamKey}: ${permErr.message})`);
                  }
                } else {
                  console.log(`ℹ️ Skipped setting everyone view deny for ${teamKey} (toggle disabled).`);
                }

              } catch (err) {
                console.error(`❌ Failed to process ${teamKey} (${teamChannelId}):`, err);
                await logUsage(`(error processing team ${teamKey}: ${err.message})`);
              }
            }
          } else {
            console.log('ℹ️ No teamChannels found in config to process.');
            await logUsage('(no teamChannels configured)');
          }

          // Final feedback
          try {
            await interaction.editReply({ content: '✅ Hoedown reset completed.', components: [] });
          } catch (e) {
            console.warn('Failed to edit reply after actions:', e);
          }

        } catch (err) {
          console.error('Error handling hoedown-reset collect:', err);
          try { await interaction.editReply({ content: '❌ An error occurred while performing the reset.' }); } catch (e) { }
          await logUsage(`(error during execution: ${err.message})`);
        }
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          try { await interaction.editReply({ content: '⌛ Hoedown reset timed out (no confirmation).', components: [] }); } catch (e) { }
          await logUsage('(timed out)');
        }
      });

    } catch (error) {
      console.error('Unexpected error in /hoedown-reset:', error);
      await logUsage(`(unexpected error: ${error.message})`);
      try { await interaction.reply({ content: '❌ Unexpected error occurred.', ephemeral: true }); } catch (e) { }
    }
  }
};
