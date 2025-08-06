const config = require('./config.json'); // Import the config file

// Function to check if the user has permission
async function checkPermissions(interaction) {
    const allowedRoles = config.allowedRoles;
    const allowedUserIds = config.allowedUserIds;

    // Check if the command is run inside a guild (server)
    if (!interaction.guild) {
        return false;
    }

    try {
        // Fetch the member data
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

        // Check if the user's Discord ID is in the allowed list
        const isAllowedUser = allowedUserIds.includes(interaction.user.id);

        // If the user has the required role or is in the allowed list, they have permission
        return hasRequiredRole || isAllowedUser;

    } catch (error) {
        console.error("❌ Error checking permissions:", error);
        return false;
    }
}

module.exports = { checkPermissions };
