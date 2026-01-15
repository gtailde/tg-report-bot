const { getDB } = require('./db');

// Default settings
const DEFAULTS = {
    'reminder_friday_1': '0 12 * * 5',
    'reminder_friday_2': '0 17 * * 5',
    'reminder_saturday': '0 10 * * 6',
    'reminder_sunday': '0 10 * * 0'
};

async function getSetting(key) {
    const db = await getDB();
    const result = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : DEFAULTS[key];
}

async function setSetting(key, value) {
    const db = await getDB();
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

async function getAllSettings() {
    const db = await getDB();
    const rows = await db.all('SELECT * FROM settings');
    const settings = { ...DEFAULTS };
    rows.forEach(row => {
        settings[row.key] = row.value;
    });
    return settings;
}

module.exports = { getSetting, setSetting, getAllSettings, DEFAULTS };
