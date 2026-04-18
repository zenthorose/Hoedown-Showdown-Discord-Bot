const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const config = require('../config.json'); // for LOG_CHANNEL_ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Frequently asked questions about the community, event, and the bot.'),

  async execute(interaction) {
    async function logUsage(extra = "") {
      try {
        const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
        if (logChannel) {
          const userTag = interaction.user.tag;
          const channelName = interaction.channel?.name || "DM/Unknown";
          await logChannel.send(
            `📝 **/faq** used by **${userTag}** in **#${channelName}** ${extra}`
          );
        }
      } catch (err) {
        console.error("❌ Failed to log usage:", err);
      }
    }

    const faqs = [
      {
        q: 'Can I invite others?',
        a: 'Yes you can. This is a streamer based event and anyone you invite in you must vouch for them and their behavior or you will not be allowed to invite others.'
      },
      {
        q: 'How often is there a Hoedown?',
        a: 'Generally there is one every 6 months so twice a year normally.'
      },
      {
        q: 'How do I sign up for rounds? (There are 16 rounds total and last 1.5 hours each)',
        a: 'You are able to sign up for rounds through the opt-in channel by reacting to the emote linked with the timeslot you wish to join. You can sign up for as few or as many as you want. Please be signed up or remove yourself from the sign up 15 minutes prior to the start of the next round.'
      },
      {
        q: 'How do I register?',
        a: 'Use /register and provide your region, Steam ID, and stream link.'
      },
      {
        q: 'How do I update my info?',
        a: 'Use /update-info to change any info you previously submitted.'
      },
      {
        q: 'How do I check my submitted info?',
        a: 'Use /info-check to view the information you submitted.'
      },
      {
        q: 'Where can I find information about the bounty board?',
        a: 'All information about the bounty board can be found here https://discord.com/channels/1052393263644037200/1429633917098393661.'
      },
      {
        q: 'What if there is someone I don’t want to be paired with?',
        a: 'Notify a member of the event team directly or you can message the bot to open a ticket.'
      },
      {
        q: 'Who do I contact for help?',
        a: 'Reach out to a member of the event team or you can message the bot to open a ticket.'
      }
    ];

    try {
      try {
        await interaction.reply({
          content: '🔎 Fetching FAQs...',
          flags: MessageFlags.Ephemeral
        });
      } catch {
        // ignore if already acknowledged
      }

      const faqText = faqs.map((f, i) => `**Q${i + 1}:** ${f.q}\n**A:** ${f.a}`).join('\n\n');
      const msg = `**Frequently Asked Questions**\n\n${faqText}`;

      await safeEdit(interaction, msg);
      await logUsage("✅ FAQs returned");

    } catch (error) {
      console.error('❌ Error in /faq command:', error);
      await safeEdit(interaction, '⚠️ Error fetching FAQs. Please try again later.');
      await logUsage(`❌ Error: ${error.message}`);
    }

    async function safeEdit(interaction, content) {
      try {
        await interaction.editReply({ content });
      } catch {
        try {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } catch {}
      }
    }
  }
};
