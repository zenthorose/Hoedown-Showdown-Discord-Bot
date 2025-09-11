const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissions } = require('../permissions'); // Import the permissions check function

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Create or update a message with an embed.')
        .setDefaultMemberPermissions(0) // Requires Manage Messages permission
        .addStringOption(option =>
            option.setName('channelid')
                .setDescription('The ID of the channel where the message will be sent/edited')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to update (leave blank to create new)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The embed title')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('The embed description')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Choose an embed color')
                .setRequired(true)
                .addChoices(
                    { name: 'Red', value: 'Red' },
                    { name: 'Blue', value: 'Blue' },
                    { name: 'Green', value: 'Green' },
                    { name: 'Yellow', value: 'Yellow' },
                    { name: 'Purple', value: 'Purple' },
                    { name: 'Orange', value: 'Orange' },
                    { name: 'Gray', value: 'Gray' }
                ))
        .addStringOption(option =>
            option.setName('pingeveryone')
                .setDescription('Should I @everyone outside the embed?')
                .setRequired(true)
                .addChoices(
                    { name: 'Yes', value: 'yes' },
                    { name: 'No', value: 'no' }
                )),

    async execute(interaction) {
        console.log(`[message] Command triggered by ${interaction.user.tag}`);

        // Check permissions
        const hasPermission = await checkPermissions(interaction);
        if (!hasPermission) {
            console.log(`[message] Permission denied for ${interaction.user.tag}`);
            return interaction.reply({
                content: '❌ You do not have permission to use this command!',
                ephemeral: true
            });
        }

        const channelId = interaction.options.getString('channelid');
        const messageId = interaction.options.getString('messageid'); // optional
        const title = interaction.options.getString('title') || null;
        const description = interaction.options.getString('description');
        const colorChoice = interaction.options.getString('color');
        const pingEveryone = interaction.options.getString('pingeveryone');

        console.log(`[message] Options: channelId=${channelId}, messageId=${messageId || "NEW"}, title=${title}, color=${colorChoice}, pingEveryone=${pingEveryone}`);

        // Map color choices to hex codes
        const colorMap = {
            Red: '#FF0000',
            Blue: '#0000FF',
            Green: '#00FF00',
            Yellow: '#FFFF00',
            Purple: '#800080',
            Orange: '#FFA500',
            Gray: '#808080'
        };
        const embedColor = colorMap[colorChoice] || '#444444';

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.log(`[message] Invalid channel ID: ${channelId}`);
            return interaction.reply({ content: "❌ Invalid channel ID.", ephemeral: true });
        }

        // Build the embed
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);

        const content = pingEveryone === 'yes' ? '@everyone' : '';

        if (messageId) {
            // --- UPDATE EXISTING MESSAGE ---
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                console.log(`[message] Message not found: ${messageId}`);
                return interaction.reply({ content: "❌ Message not found.", ephemeral: true });
            }

            if (!message.editable) {
                console.log(`[message] Message not editable: ${messageId}`);
                return interaction.reply({ content: "❌ I can't edit this message.", ephemeral: true });
            }

            await message.edit({ content, embeds: [embed] });
            console.log(`[message] Message ${messageId} updated successfully in channel ${channelId}`);
            interaction.reply({ content: "✅ Message updated successfully!", ephemeral: true });

        } else {
            // --- CREATE NEW MESSAGE ---
            const sentMessage = await channel.send({ content, embeds: [embed] });
            console.log(`[message] New message ${sentMessage.id} sent successfully in channel ${channelId}`);
            interaction.reply({ content: `✅ Message sent successfully! (ID: ${sentMessage.id})`, ephemeral: true });
        }
    }
};
