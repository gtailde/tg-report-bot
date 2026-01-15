const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let dbInstance = null;

async function getDB() {
    if (dbInstance) return dbInstance;

    dbInstance = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    // Performance optimizations
    await dbInstance.exec('PRAGMA journal_mode = WAL;');
    await dbInstance.exec('PRAGMA synchronous = NORMAL;');
    await dbInstance.exec('PRAGMA temp_store = MEMORY;');
    await dbInstance.exec('PRAGMA cache_size = -2000;'); // ~2MB cache

    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT UNIQUE,
            username TEXT,
            full_name TEXT,
            is_admin INTEGER DEFAULT 0,
            reminders_enabled INTEGER DEFAULT 1
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
        await dbInstance.exec("ALTER TABLE users ADD COLUMN reminders_enabled INTEGER DEFAULT 1;");
    } catch (e) {
        // Ignore if column already exists
    }

    try {
        await dbInstance.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;");
    } catch (e) {
        // Column likely exists
    }

    return dbInstance;
}

module.exports = { getDB };
