const { getDB } = require('./db');

// Default settings
const DEFAULTS = {
    'reminder_standard': '0 12 * * 5',
    'reminder_deadline': '0 17 * * 5',
    'reminder_late': '0 10 * * 6',
    'reminder_final': '0 10 * * 0'
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
