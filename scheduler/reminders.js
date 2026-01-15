const cron = require('node-cron');
const { getAllUsers } = require('../db/users');
const { getReportsForWeek } = require('../db/reports');
const { getCurrentWeekAndYear } = require('../utils/date');
const { getAllSettings } = require('../db/settings');

let tasks = [];

async function initScheduler(bot) {
    // Clear existing tasks
    tasks.forEach(task => task.stop());
    tasks = [];

    const timezone = "Europe/Kiev";
    const settings = await getAllSettings();

    // Helper to get HH:MM from cron
    const getTimeFromCron = (cronExpr) => {
        if (!cronExpr) return '??:??';
        const parts = cronExpr.split(' ');
        let h, m;
        // 5 parts: min hour ... | 6 parts: sec min hour ...
        if (parts.length === 5) {
            m = parts[0];
            h = parts[1];
        } else {
            m = parts[1];
            h = parts[2];
        }
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    // Helper to schedule
    const schedule = (cronTime, taskFn) => {
        if (cron.validate(cronTime)) {
             const task = cron.schedule(cronTime, taskFn, { timezone });
             tasks.push(task);
        } else {
             console.error(`Invalid cron time: ${cronTime}`);
        }
    };

    // Friday 12:00 - General Reminder (Now strictly for those who haven't sent yet)
    schedule(settings.reminder_friday_1, async () => {
        const deadlineTime = getTimeFromCron(settings.reminder_friday_2);
        // Also check missing like others to avoid duplicate/spam if already sent
        await remindMissing(bot, `🔔 Привіт! Не забудь скинути тижневий звіт до ${deadlineTime}.`);
    });

    // Friday 17:00 - Missing Report Reminder
    schedule(settings.reminder_friday_2, async () => {
        const timeNow = getTimeFromCron(settings.reminder_friday_2);
        await remindMissing(bot, `⚠️ Ти ще не скинув звіт! Вже ${timeNow}.`);
    });

    // Saturday 10:00
    schedule(settings.reminder_saturday, async () => {
        await remindMissing(bot, '⚠️ Ти пропустив дедлайн у п\'ятницю. Скинь звіт якнайшвидше!');
    });

    // Sunday 10:00
    schedule(settings.reminder_sunday, async () => {
        await remindMissing(bot, '⚠️ Останній шанс скинути звіт за цей тиждень!');
    });
}

async function remindMissing(bot, message) {
    const { week, year } = getCurrentWeekAndYear();
    const users = await getAllUsers();
    const reports = await getReportsForWeek(week, year);

    for (const user of users) {
        const hasReport = reports.some(r => r.user_id === user.id);
        if (!hasReport) {
             try {
                await bot.telegram.sendMessage(user.telegram_id, message);
             } catch (e) {
                 console.error(`Failed to send reminder to ${user.username}`, e.message);
             }
        }
    }
}

module.exports = { initScheduler };
