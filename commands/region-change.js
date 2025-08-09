// const { SlashCommandBuilder } = require('@discordjs/builders');
// const axios = require('axios');

// module.exports = {
//     data: new SlashCommandBuilder()
//         .setName('region-change')
//         .setDescription('Change your region selection')
//         .addStringOption(option =>
//             option.setName('region')
//                 .setDescription('Choose a region: East, West, or Both')
//                 .setRequired(true)
//                 .addChoices(
//                     { name: 'East', value: 'East' },
//                     { name: 'West', value: 'West' },
//                     { name: 'Both', value: 'Both' }
//                 )),
//
//     async execute(interaction) {
//         try {
//             // Get the region and convert it to the proper capitalized format
//             let selectedRegion = interaction.options.getString('region');
//             selectedRegion = selectedRegion.charAt(0).toUpperCase() + selectedRegion.slice(1).toLowerCase();
//
//             const userId = interaction.user.id;
//             const channelId = interaction.channel.id;
//
//             // Validate the region (case insensitive)
//             if (!['East', 'West', 'Both'].includes(selectedRegion)) {
//                 return await interaction.reply({ content: 'Invalid region selected. Please choose from "East", "West", or "Both".', ephemeral: true });
//             }
//
//             // Reply instantly to acknowledge the request
//             await interaction.reply({ content: 'Your region is being updated and confirmation will be sent momentarily.', ephemeral: true });
//
//             // Get the Google Apps Script URL from environment variables
                //const triggerUrl = process.env.Google_Apps_Script_URL;
               // if (!triggerUrl) throw new Error('Google Apps Script URL is not defined.');
//
//             // Make sure the environment variable is defined
//             if (!triggerUrl) {
//                 return await interaction.editReply({ content: 'Error: Google Apps Script URL is not defined.' });
//             }
//
//             // Send the region change request to Google Apps Script
//             await axios.post(triggerUrl, {
//                 command: 'region-change',
//                 userId: userId,
//                 region: selectedRegion, // Send the capitalized region
//                 channelId: channelId
//             });
//
//         } catch (error) {
//             console.error('Error processing region change:', error);
//             await interaction.editReply({ content: 'There was an error updating your region. Please try again later.' });
//         }
//     }
// };
