const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissions } = require('../permissions'); // Import the permissions check function

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Updates a message previously sent by the bot.')
        .setDefaultMemberPermissions(0) // Requires Manage Messages permission
        .addStringOption(option =>
            option.setName('channelid')
                .setDescription('The ID of the channel where the message was sent')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to update')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('newcontent')
                .setDescription('The new embed description')
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
        const messageId = interaction.options.getString('messageid');
        const newContent = interaction.options.getString('newcontent');
        const colorChoice = interaction.options.getString('color');
        const pingEveryone = interaction.options.getString('pingeveryone');

        console.log(`[message] Options received: channelId=${channelId}, messageId=${messageId}, color=${colorChoice}, pingEveryone=${pingEveryone}`);

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
            return interaction.reply({ content: "Invalid channel ID.", ephemeral: true });
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
            console.log(`[message] Message not found: ${messageId}`);
            return interaction.reply({ content: "Message not found.", ephemeral: true });
        }

        if (!message.editable) {
            console.log(`[message] Message not editable: ${messageId}`);
            return interaction.reply({ content: "I can't edit this message.", ephemeral: true });
        }

        // Build the embed
        const newEmbed = new EmbedBuilder()
            .setDescription(newContent)
            .setColor(embedColor)
            .setTimestamp();

        // Check if we need to ping everyone
        const content = pingEveryone === 'yes' ? '@everyone' : '';

        await message.edit({ content, embeds: [newEmbed] });
        console.log(`[message] Message ${messageId} updated successfully in channel ${channelId}`);

        interaction.reply({ content: "✅ Message updated successfully!", ephemeral: true });
    }
};
