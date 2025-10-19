const { SlashCommandBuilder } = require('@discordjs/builders');
const config = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-command')
    .setDescription('Developer-only command to sync all voice channels in specific categories.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Permission check
    if (interaction.user.id !== config.devID) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    try {
      const guild = interaction.guild;
      const categoriesToSync = ["Voice Channels Teams A-Z", "Voice Channels Teams AA-ZZ"];
      let syncedCount = 0;

      for (const categoryName of categoriesToSync) {
        const category = guild.channels.cache.find(c => c.name === categoryName && c.type === 4); // 4 = GUILD_CATEGORY
        if (!category) continue;

        // Find all voice channels under this category
        const voiceChannels = guild.channels.cache.filter(
          c => c.parentId === category.id && c.type === 2 // 2 = GUILD_VOICE
        );

        for (const channel of voiceChannels.values()) {
          await channel.lockPermissions(); // Sync permissions with parent category
          syncedCount++;
        }
      }

      await interaction.editReply(`✅ Synced ${syncedCount} voice channels with their parent categories.`);
    } catch (err) {
      console.error('❌ Error syncing voice channels:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};
