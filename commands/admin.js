const { addUser, removeUser, getAllUsers, getSeenUserByUsername, getUserByUsername, setAdminStatus, toggleReminders } = require('../db/users');
const cron = require('node-cron');
const { getReportsForWeek, deleteReport } = require('../db/reports');
const { isAdmin } = require('../utils/isAdmin');
const { getCurrentWeekAndYear, getFormattedDate, getWeekDateRange } = require('../utils/date');
const { getAllSettings, setSetting, DEFAULTS } = require('../db/settings');
const { initScheduler } = require('../scheduler/reminders');
const { Markup } = require('telegraf');

// Helpers for menus
function getSettingsKeyboard() {
    return Markup.keyboard([
        ['⏰ Нагадування', '👮 Адміни'],
        ['🔙 Назад']
    ]).resize();
}

function getManageUsersKeyboard() {
    return Markup.keyboard([
        ['📋 Список юзерів', '➕ Додати юзера'],
        ['➖ Видалити юзера', '📢 Розсилка'],
        ['🔙 Назад']
    ]).resize();
}

function getManageAdminsKeyboard() {
    return Markup.keyboard([
        ['📋 Список адмінів', '➕ Додати адміна'],
        ['➖ Видалити адміна', '🔙 Назад']
    ]).resize();
}

function getRemindersKeyboard(settings) {
    // Parse crons to readable buttons
    const parseCron = (expression, prefix, label) => {
        // Simple parser for "Min Hour * * Day" (5 parts)
        const parts = expression.split(' ');
        if (parts.length < 5) return `${prefix}. ${label}`;
        
        // Check if 5 or 6 fields. 
        // 5 fields: Min Hour Day Month WeakDay
        // 6 fields: Sec Min Hour Day Month WeakDay
        let mm, hh, dow;
        if (parts.length === 5) {
            mm = parts[0].padStart(2, '0');
            hh = parts[1].padStart(2, '0');
            dow = parts[4];
        } else {
            // Assume 6
            mm = parts[1].padStart(2, '0');
            hh = parts[2].padStart(2, '0');
            dow = parts[5];
        }

        const days = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dayName = days[parseInt(dow)] || '??';
        
        return `${prefix}. ${dayName} (${label}): ${hh}:${mm}`;
    };

    return Markup.keyboard([
        [parseCron(settings.reminder_standard, '1', 'Нагадування'), parseCron(settings.reminder_deadline, '2', 'Дедлайн')],
        [parseCron(settings.reminder_late, '3', 'Спізнення'), parseCron(settings.reminder_final, '4', 'Фінал')],
        ['🔙 Назад']
    ]).resize();
}

function getMainMenuKeyboard(isUserAdmin) {
    let buttons = [['📝 Здати звіт'], ['❓ Допомога']];
    if (isUserAdmin) {
        buttons = [['📝 Здати звіт', '❓ Допомога'], ['👥 Користувачі', '📊 Статус'], ['⚙️ Налаштування']];
    }
    return Markup.keyboard(buttons).resize();
}

// Logic to add user (reused by command and UI)
async function addUserLogic(ctx, username, fullName) {
    const cleanUsername = username.replace('@', '');
    const seenUser = await getSeenUserByUsername(cleanUsername);
    
    if (!seenUser) {
        return ctx.reply(`Користувач @${cleanUsername} ще не запустив бота (не натиснув /start). Нехай натисне, і спробуй знову.`);
    }

    try {
        await addUser(seenUser.telegram_id, seenUser.username, fullName);
        ctx.reply(`Користувач @${cleanUsername} доданий успішно.`);
        try {
            await ctx.telegram.sendMessage(seenUser.telegram_id, 'Тебе додано до системи звітів ✅', getMainMenuKeyboard(false));
        } catch (e) {
            console.warn('Could not send message to user', e.message);
        }
    } catch (e) {
         console.error(e);
         ctx.reply('Помилка при додаванні користувача.');
    }
}

async function addAdminLogic(ctx, username) {
    const cleanUsername = username.replace('@', '');
    const user = await getSeenUserByUsername(cleanUsername);
    if (!user) return ctx.reply(`Користувач @${cleanUsername} не знайдений серед тих, хто запускав бота.`);

    // Ensure user is in the main users table so they can submit reports too
    try {
        // We don't have full name in seen_users usually, so fallback to username
        await addUser(user.telegram_id, user.username, user.username);
    } catch (e) {
        console.warn('Auto-add user for admin failed', e);
    }

    await setAdminStatus(user.telegram_id, true);
    ctx.reply(`Користувач @${cleanUsername} тепер адміністратор.`);
    
    try {
        await ctx.telegram.sendMessage(user.telegram_id, '🎉 Ти отримав права адміністратора! Меню оновлено.', getMainMenuKeyboard(true));
    } catch (e) {
        console.warn('Could not notify new admin', e);
    }
}

async function removeUserLogic(ctx, username) {
    const cleanUsername = username.replace('@', '');
    
    // Check if trying to remove self
    if (cleanUsername === ctx.from.username) {
         return ctx.reply('⚠️ Ти не можеш видалити сам себе.');
    }
    
    // Resolve ID (only from ACTIVE users)
    const user = await getUserByUsername(cleanUsername);
    
    if (!user) {
         return ctx.reply(`Користувач @${cleanUsername} не знайдений у списку активних користувачів.`);
    }

    // Removed the check that prevented deleting admins. 
    // Now admins are deleted directly.

    if (user.telegram_id.toString() === ctx.from.id.toString()) {
         return ctx.reply('⚠️ Ти не можеш видалити сам себе.');
    }

    // Notify BEFORE removing
    let notifSuccess = false;
    try {
        await ctx.telegram.sendMessage(user.telegram_id, '⛔️ Ваш доступ до бота скасовано адміністратором.', Markup.removeKeyboard());
        notifSuccess = true;
    } catch (e) {
         console.error(`Failed to notify user ${cleanUsername} before removal`, e);
    }

    const removed = await removeUser(cleanUsername);
    
    if (removed) {
        let statusMsg = notifSuccess ? 'та повідомлено.' : 'але не вдалося надіслати повідомлення.';
        ctx.reply(`Користувач @${cleanUsername} успішно видалений, ${statusMsg}`);
    } else {
        ctx.reply(`Помилка при видаленні користувача @${cleanUsername}.`);
    }
}

async function removeAdminLogic(ctx, username) {
    const cleanUsername = username.replace('@', '');
    const user = await getSeenUserByUsername(cleanUsername);
    if (!user) return ctx.reply('Користувач не знайдений.');

    if (user.telegram_id.toString() === ctx.from.id.toString()) {
        return ctx.reply('⚠️ Ти не можеш забрати права адміністратора у самого себе.');
    }

    await setAdminStatus(user.telegram_id, false);
    ctx.reply(`Користувач @${cleanUsername} більше не адміністратор.`);

    try {
        await ctx.telegram.sendMessage(user.telegram_id, '❌ Права адміністратора скасовано. Меню оновлено.', getMainMenuKeyboard(false));
    } catch (e) {
        console.warn('Could not notify demoted admin', e);
    }
}



async function listUsersHandler(ctx) {
    if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
    const users = await getAllUsers();
    if (users.length === 0) return ctx.reply('No users.', getManageUsersKeyboard());
    
    const list = users.map(u => `- ${u.full_name} (@${u.username})`).join('\n');
    ctx.reply(`Users:\n${list}`, getManageUsersKeyboard());
}

async function listAdminsHandler(ctx) {
    if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
    const users = await getAllUsers();
    const adminUsers = users.filter(u => u.is_admin === 1);
    
    if (adminUsers.length === 0) return ctx.reply('No admins found (except superadmin).');

    let msg = "Список адмінів:\n";
    msg += adminUsers.map(u => `- ${u.full_name} (@${u.username})`).join('\n');
    ctx.reply(msg);
}

async function statusHandler(ctx) {
    if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
    
    const { week, year } = getCurrentWeekAndYear();
    const dateRange = getWeekDateRange(week, year);
    const users = await getAllUsers();
    const reports = await getReportsForWeek(week, year);
    
    const statusList = users.map(user => {
        const report = reports.find(r => r.user_id === user.id);
        // Clean name to avoid markdown issues if needed, or just use as is
        const nameDisplay = `${user.full_name} (@${user.username})`;
        const muteStatus = (user.reminders_enabled === 0) ? ' 🔕' : '';
        
        if (report) {
             const date = getFormattedDate(report.submitted_at);
             return `✅ ${nameDisplay}${muteStatus} — ${date}`;
        } else {
            return `❌ ${nameDisplay}${muteStatus}`;
        }
    }).join('\n');

    ctx.reply(`📊 Статус звітів за період ${dateRange} (Тиждень ${week}):\n\n${statusList || 'Користувачів не знайдено.'}\n\nЩоб скинути звіт юзера: /resetreport @username`);
}


async function broadcastToAll(telegram, text) {
    const users = await getAllUsers();
    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
        try {
            await telegram.sendMessage(user.telegram_id, `📢 **Оголошення:**\n\n${text}`, { parse_mode: 'Markdown' });
            sentCount++;
        } catch (e) {
            console.error(`Failed to send to ${user.username}:`, e.message);
            failedCount++;
        }
    }
    return { sentCount, failedCount };
}

async function sendBroadcastLogic(ctx, text) {
    // Notify admin process started
    const statusMsg = await ctx.reply(`Починаю розсилку...`);
    
    const { sentCount, failedCount } = await broadcastToAll(ctx.telegram, text);
    
    ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, 
        `✅ Розсилка завершена.\nУспішно: ${sentCount}\nПомилок: ${failedCount}`);
}

module.exports = (bot) => {
    // --- BASIC ADMIN COMMANDS ---
    bot.command('add', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');

        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /add @username <Full Name (optional)>');

        const username = args[1];
        const fullName = args.slice(2).join(' ') || username;
        
        await addUserLogic(ctx, username, fullName);
    });

    bot.command('remove', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /remove @username');
        await removeUserLogic(ctx, args[1]);
    });

    bot.command('mute', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /mute @username');
        
        const username = args[1];
        const updated = await toggleReminders(username, false);
        if (updated) ctx.reply(`🔕 Нагадування для ${username} вимкнено.`);
        else ctx.reply(`Користувач ${username} не знайдений.`);
    });

    bot.command('unmute', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /unmute @username');
        
        const username = args[1];
        const updated = await toggleReminders(username, true);
        if (updated) ctx.reply(`🔔 Нагадування для ${username} увімкнено.`);
        else ctx.reply(`Користувач ${username} не знайдений.`);
    });

    async function helpHandler(ctx) {
        let helpText = `📚 **Доступні команди:**\n\n`;
        
        // Common commands
        helpText += `📝 **Користувач:**\n`;
        helpText += `/start - Запустити бота\n`;
        helpText += `(Кнопка "📝 Здати звіт") - Відправити звіт текстом, фото або документом.\n\n`;

        if (await isAdmin(ctx)) {
            helpText += `👮‍♂️ **Адміністратор:**\n`;
            helpText += `/add @username [Ім'я] - Додати користувача\n`;
            helpText += `/remove @username - Видалити користувача (і адміна)\n`;
            helpText += `/makeadmin @username - Зробити адміном\n`;
            helpText += `/demoteadmin @username - Забрати права адміна\n`;
            helpText += `/mute @username - Вимкнути нагадування звіту\n`;
            helpText += `/unmute @username - Увімкнути нагадування звіту\n`;
            helpText += `/resetreport @username - Скинути звіт користувача за поточний тиждень\n`;
            helpText += `/status - Перевірити, хто здав звіти\n`;
            helpText += `/list - Список всіх користувачів\n`;
            helpText += `/setreminder [1-4] [cron] - Налаштування часу (краще через меню)\n`;
            helpText += `\n💡 *Порада:* Більшість функцій доступна через кнопки меню "Налаштування" та "Користувачі".`;
        }
        
        // Mention the manual
        helpText += `\n📖 **Повна інструкція доступна тут:**\n[USER_MANUAL.md](https://github.com/gtailde/tg-report-bot/blob/main/USER_MANUAL.md)`; 

        ctx.reply(helpText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }

    bot.command('help', helpHandler);

    // --- MENU HANDLERS ---
    async function manageUsersHandler(ctx) {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        ctx.reply('Керування користувачами:', getManageUsersKeyboard());
    }

    async function manageAdminsHandler(ctx) {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        ctx.reply('Керування адмінами:', getManageAdminsKeyboard());
    }

    async function settingsHandler(ctx) {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        ctx.reply('Налаштування:', getSettingsKeyboard());
    }

    async function adminsHandler(ctx) {
        // This handler might be obsolete if we use manageAdminsHandler, but keeping it for safety or redirect
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const users = await getAllUsers();
        // Filter those who are admins in DB (note: config.ADMIN_ID might not be in DB with is_admin=1 initially, but effectively is admin)
        // Let's just list from DB where is_admin=1
        const adminUsers = users.filter(u => u.is_admin === 1);
        
        let msg = "Список адмінів:\n";
        msg += adminUsers.map(u => `- ${u.full_name} (@${u.username})`).join('\n');
        msg += "\n\nЩоб додати адміна, введи: /makeadmin @username\nЩоб видалити: /demoteadmin @username";
        
        ctx.reply(msg);
    }

    async function remindersHandler(ctx) {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const settings = await getAllSettings();
        ctx.reply('Обери нагадування, щоб змінити час:', getRemindersKeyboard(settings));
    }

    async function promptReminderMenu(ctx, key, settings) {
        const cronExpr = settings[key];
        // Parse info
        const parts = cronExpr.split(' ');
        let hh, mm, d;
        // 5: Min Hour Day Month WeekDay
        if (parts.length === 5) {
             mm = parts[0].padStart(2, '0');
             hh = parts[1].padStart(2, '0');
             d = parts[4];
        } else { // 6
             mm = parts[1].padStart(2, '0');
             hh = parts[2].padStart(2, '0');
             d = parts[5];
        }
        
        const daysMap = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];
        const dayName = daysMap[parseInt(d)] || 'Невідомо';
        
        ctx.reply(`Налаштування для: ${key}
⏰ Час: ${hh}:${mm}
📅 День: ${dayName}

Що будемо змінювати?`, Markup.keyboard([['🕒 Змінити час', '📅 Змінити день'], ['🔙 Назад']]).resize());
    }

    async function promptReminderTime(ctx) {
        ctx.reply('Введи новий час (HH:MM або HH). Приклад: 14:30 або 14.', Markup.keyboard([['🔙 Назад']]).resize());
    }

    async function promptReminderDay(ctx) {
        ctx.reply('Обери новий день тижня:', Markup.keyboard([
            ['Понеділок', 'Вівторок', 'Середа'],
            ['Четвер', 'Пʼятниця', 'Субота'],
            ['Неділя', '🔙 Назад']
        ]).resize());
    }

    async function updateReminderDay(ctx, key, dayStr) {
        const daysMap = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];
        const dayIndex = daysMap.indexOf(dayStr);
        
        if (dayIndex === -1) throw new Error('Обери день із клавіатури.');
        
        const settings = await getAllSettings();
        const currentCron = settings[key];
        const parts = currentCron.split(' ');
        
        // Update weekday part (last char usually)
        if (parts.length === 5) {
            parts[4] = dayIndex.toString();
        } else {
            parts[5] = dayIndex.toString();
        }
        
        const newCron = parts.join(' ');
        await setSetting(key, newCron);
        await initScheduler(bot);
        return dayStr;
    }

    async function updateReminderTime(ctx, key, timeStr) {
        let hh, mm;
        
        // Support HH:MM or just HH
        if (timeStr.includes(':')) {
            const timeParts = timeStr.split(':');
            if (timeParts.length !== 2) throw new Error('Format must be HH:MM');
            hh = parseInt(timeParts[0]);
            mm = parseInt(timeParts[1]);
        } else {
            // Assume just HH is passed
            hh = parseInt(timeStr);
            mm = 0;
        }
        
        if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
            throw new Error('Невірний формат часу. Спробуй 14:30 або 14');
        }

        const settings = await getAllSettings();
        const currentCron = settings[key]; 
        const parts = currentCron.split(' ');
        
        if (parts.length === 5) {
             parts[0] = mm.toString();
             parts[1] = hh.toString();
        } else if (parts.length >= 6) {
             parts[1] = mm.toString();
             parts[2] = hh.toString();
        } else {
             // Fallback default 5 parts
             parts[0] = mm.toString();
             parts[1] = hh.toString();
        }
        
        const newCron = parts.join(' ');
        
        await setSetting(key, newCron);
        await initScheduler(bot);
        
        // Return clear formatted time instead of cron string
        const mmStr = mm.toString().padStart(2, '0');
        const hhStr = hh.toString().padStart(2, '0');
        return `${hhStr}:${mmStr}`;
    }

    bot.command('makeadmin', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /makeadmin @username');
        await addAdminLogic(ctx, args[1]);
    });

    bot.command('demoteadmin', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        const username = args[1]; // Corrected index from previous potentially risky code
        if (!username) return ctx.reply('Usage: /demoteadmin @username');
        await removeAdminLogic(ctx, username);
    });

    bot.command('resetreport', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        const username = args[1];
        if (!username) return ctx.reply('Usage: /resetreport @username');

        const cleanUsername = username.replace('@', '');
        const user = await getSeenUserByUsername(cleanUsername); // Or find in all users
        // Better to check getAllUsers first as they are the ones with reports
        const allUsers = await getAllUsers();
        const targetUser = allUsers.find(u => u.username === cleanUsername);

        if (!targetUser) return ctx.reply('Такого користувача не знайдено в системі звітів.');

        const { week, year } = getCurrentWeekAndYear();
        await deleteReport(targetUser.id, week, year);
        
        ctx.reply(`✅ Звіт для @${cleanUsername} за тиждень ${week}/${year} скинуто. Тепер йому будуть приходити нагадування.`);
        try {
            await ctx.telegram.sendMessage(targetUser.telegram_id, '⚠️ Твій звіт було відхилено або скинуто адміністратором. Будь ласка, надішли його знову.');
        } catch (e) { console.error(e); }
    });

    bot.command('setreminder', async (ctx) => {
        if (!await isAdmin(ctx)) return ctx.reply('⛔️ У тебе немає прав адміністратора.');
        const args = ctx.message.text.split(' ');
        // /setreminder 1 0 13 * * 5
        if (args.length < 3) return ctx.reply('Usage: /setreminder <1-4> <cron_expression>');
        
        const keyMap = {
            '1': 'reminder_standard',
            '2': 'reminder_deadline',
            '3': 'reminder_late',
            '4': 'reminder_final'
        };
        
        const key = keyMap[args[1]];
        if (!key) return ctx.reply('Invalid key. Use 1-4.');
        
        const cronExpr = args.slice(2).join(' ');
        await setSetting(key, cronExpr);
        await initScheduler(bot); // Restart scheduler
        ctx.reply(`Reminder ${key} updated to: ${cronExpr}`);
    });

    bot.command('list', listUsersHandler);
    bot.command('status', statusHandler);

    async function broadcastToAll(telegram, text) {
        const users = await getAllUsers();
        let sentCount = 0;
        let failedCount = 0;

        for (const user of users) {
            try {
                await telegram.sendMessage(user.telegram_id, `📢 **Оголошення:**\n\n${text}`, { parse_mode: 'Markdown' });
                sentCount++;
            } catch (e) {
                console.error(`Failed to send to ${user.username}:`, e.message);
                failedCount++;
            }
        }
        return { sentCount, failedCount };
    }

    async function sendBroadcastLogic(ctx, text) {
        // Notify admin process started
        const statusMsg = await ctx.reply(`Починаю розсилку...`);
        
        const { sentCount, failedCount } = await broadcastToAll(ctx.telegram, text);
        
        ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, 
            `✅ Розсилка завершена.\nУспішно: ${sentCount}\nПомилок: ${failedCount}`);
    }

    async function scheduleBroadcast(ctx, text, timeStr) {
        const [hh, mm] = timeStr.split(':').map(Number);
        
        if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) {
            throw new Error('Невірний час. Використовуй HH:MM');
        }

        // Schedule one-time task
        const cronExpr = `${mm} ${hh} * * *`;
        const task = cron.schedule(cronExpr, async () => {
             console.log('Running scheduled broadcast...');
             const { sentCount, failedCount } = await broadcastToAll(bot.telegram, text);
             
             // Report back to admin who scheduled it
             try {
                 await bot.telegram.sendMessage(ctx.from.id, 
                     `✅ Запланована розсилка виконана!\nТекст: "${text.substring(0, 20)}..."\nУспішно: ${sentCount}, Помилок: ${failedCount}`);
             } catch (e) {
                 console.error('Failed to notify admin about scheduled broadcast', e);
             }
             
             task.stop(); // Run once
        }, { timezone: "Europe/Kiev" });
        
        ctx.reply(`✅ Розсилка запланована на ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')} (сьогодні/завтра).`);
    }

    return { 
        listUsersHandler, 
        statusHandler, 
        settingsHandler, 
        adminsHandler, 
        remindersHandler,
        manageUsersHandler,
        manageAdminsHandler,
        addUserLogic,
        addAdminLogic,
        removeAdminLogic,
        removeUserLogic,
        listAdminsHandler,
        getManageUsersKeyboard,
        getManageAdminsKeyboard,
        getRemindersKeyboard,
        promptReminderMenu,
        promptReminderTim,
        helpHandlere,
        promptReminderDay,
        updateReminderTime,
        updateReminderDay,
        sendBroadcastLogic,
        scheduleBroadcast
    };
};



