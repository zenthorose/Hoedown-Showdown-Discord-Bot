const config = require('./config.json'); // Import the config file

// Function to check if the user has permission
async function checkPermissions(interaction) {
    const allowedRoles = config.allowedRoles || [];

    // Check if the command is run inside a guild (server)
    if (!interaction.guild) {
        return false;
    }

    try {
        // Fetch the member data
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Check if the user has any of the allowed roles
        const hasRequiredRole = member.roles.cache.some(role => allowedRoles.includes(role.id));

        console.log("User ID:", interaction.user.id);
        console.log("User Roles:", member.roles.cache.map(r => r.id));
        console.log("Allowed Roles:", allowedRoles);
        console.log("Matched Role?", hasRequiredRole);

        // For testing, ignore user ID and only check role
        return hasRequiredRole;

    } catch (error) {
        console.error("❌ Error checking permissions:", error);
        return false;
    }
}

module.exports = { checkPermissions };
