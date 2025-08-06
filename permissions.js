const config = require('./config.json');

async function checkPermissions(interaction) {
    const allowedRoles = config.allowedRoles;

    if (!interaction.guild) {
        console.log("⚠️ Interaction not from a guild.");
        return false;
    }

    try {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Debug: Log member roles and allowed roles
        const memberRoleIds = member.roles.cache.map(role => role.id);

        const hasRequiredRole = memberRoleIds.some(roleId => allowedRoles.includes(roleId));

        if (!hasRequiredRole) {
            console.log("❌ User does not have a required role.");
        }

        return hasRequiredRole;

    } catch (error) {
        console.error("❌ Error checking permissions:", error);
        return false;
    }
}

module.exports = { checkPermissions };
