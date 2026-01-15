const { getDB } = require('./db');

async function addUser(telegram_id, username, full_name) {
    const db = await getDB();
    await db.run(
        'INSERT OR IGNORE INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)',
        [telegram_id, username, full_name]
    );
    // If user exists but details changed, update them? For now, IGNORE is fine for uniqueness.
    // Or we can UPSERT. Let's stick to simple logic: if exists, maybe update username.
    const user = await getUserByTelegramId(telegram_id);
    if (user && user.username !== username) {
        await db.run('UPDATE users SET username = ? WHERE telegram_id = ?', [username, telegram_id]);
    }
}

async function removeUser(username) {
    const db = await getDB();
    // remove @ from username if present
    const cleanUsername = username.replace('@', '');
    const result = await db.run('DELETE FROM users WHERE username = ?', [cleanUsername]);
    return result.changes > 0;
}

async function getAllUsers() {
    const db = await getDB();
    return await db.all('SELECT * FROM users');
}

async function getUserByTelegramId(telegram_id) {
    const db = await getDB();
    return await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id]);
}

async function getUserByUsername(username) {
    const db = await getDB();
    const cleanUsername = username.replace('@', '');
    return await db.get('SELECT * FROM users WHERE username = ?', [cleanUsername]);
}

async function markSeen(telegram_id, username) {
    const db = await getDB();
    await db.run(
        'INSERT OR REPLACE INTO seen_users (telegram_id, username) VALUES (?, ?)',
        [telegram_id, username.replace('@', '')]
    );
}

async function getSeenUserByUsername(username) {
    const db = await getDB();
    return await db.get('SELECT * FROM seen_users WHERE username = ?', [username.replace('@', '')]);
}

async function setAdminStatus(telegram_id, isAdmin) {
    const db = await getDB();
    await db.run('UPDATE users SET is_admin = ? WHERE telegram_id = ?', [isAdmin ? 1 : 0, telegram_id]);
}

module.exports = { addUser, removeUser, getAllUsers, getUserByTelegramId, getUserByUsername, markSeen, getSeenUserByUsername, setAdminStatus };
