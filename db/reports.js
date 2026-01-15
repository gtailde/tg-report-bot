const { getDB } = require('./db');

async function addReport(user_id, week_number, year, link) {
    const db = await getDB();
    const existing = await db.get(
        'SELECT * FROM reports WHERE user_id = ? AND week_number = ? AND year = ?',
        [user_id, week_number, year]
    );

    if (existing) {
        await db.run(
            'UPDATE reports SET link = ?, submitted_at = ? WHERE id = ?',
            [link, new Date().toISOString(), existing.id]
        );
    } else {
        await db.run(
            'INSERT INTO reports (user_id, week_number, year, link, submitted_at) VALUES (?, ?, ?, ?, ?)',
            [user_id, week_number, year, link, new Date().toISOString()]
        );
    }
}

async function getReport(user_id, week_number, year) {
    const db = await getDB();
    return await db.get(
        'SELECT * FROM reports WHERE user_id = ? AND week_number = ? AND year = ?',
        [user_id, week_number, year]
    );
}

async function getReportsForWeek(week_number, year) {
     const db = await getDB();
     // Join with users to know who submitted
     return await db.all(`
        SELECT reports.*, users.username, users.full_name 
        FROM reports 
        JOIN users ON reports.user_id = users.id 
        WHERE week_number = ? AND year = ?
     `, [week_number, year]);
}

async function deleteReport(user_id, week_number, year) {
    const db = await getDB();
    await db.run(
        'DELETE FROM reports WHERE user_id = ? AND week_number = ? AND year = ?',
        [user_id, week_number, year]
    );
}

async function cleanupOldReports() {
    const db = await getDB();
    // Calculate date 1 month ago
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const isoCutoff = cutoff.toISOString();
    
    const result = await db.run('DELETE FROM reports WHERE submitted_at < ?', [isoCutoff]);
    if (result.changes > 0) {
        console.log(`Cleaned up ${result.changes} old reports.`);
    }
}

module.exports = { addReport, getReport, getReportsForWeek, deleteReport, cleanupOldReports };
