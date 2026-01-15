const config = require('../config');
const { getUserByTelegramId } = require('../db/users');

async function isAdmin(ctx) {
    const userId = ctx.from.id.toString();
    if (userId === config.ADMIN_ID) return true;

    try {
        const user = await getUserByTelegramId(userId);
        return user && user.is_admin === 1;
    } catch (e) {
        return false;
    }
}

module.exports = { isAdmin };
