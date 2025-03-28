const { ButtonBuilder, ButtonStyle } = require('discord.js'); // Import the ButtonBuilder class

module.exports = {
    data: {
        name: 'muffin-button',
        description: 'Send a muffin button',
    },
    async execute(interaction) {
        // Create the muffin button using ButtonBuilder
        const button = new ButtonBuilder()
            .setCustomId('muffin')
            .setLabel('Click me!')
            .setStyle(ButtonStyle.Primary); // You can change the style here

        // Send the message with the button
        await interaction.reply({
            content: 'Here is your muffin button!',
            components: [
                {
                    type: 1, // Action row type
                    components: [button], // Attach the button to the action row
                },
            ],
        });
    },
};
