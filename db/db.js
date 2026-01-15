const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let dbInstance = null;

async function getDB() {
    if (dbInstance) return dbInstance;

    dbInstance = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE,
            username TEXT,
            full_name TEXT,
            is_admin INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS seen_users (
            telegram_id TEXT UNIQUE,
            username TEXT
        );

        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            week_number INTEGER,
            year INTEGER,
            link TEXT,
            submitted_at DATETIME,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
    
    // Migration for existing databases
    try {
        await dbInstance.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;");
    } catch (e) {
        // Column likely exists
    }

    return dbInstance;
}

module.exports = { getDB };
