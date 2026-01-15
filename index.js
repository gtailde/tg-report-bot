const bot = require('./bot');
const { initScheduler } = require('./scheduler/reminders');
const adminCommands = require('./commands/admin');
const userCommands = require('./commands/user');
const { markSeen, getUserByTelegramId, removeUser, getAllUsers, addUser, setAdminStatus } = require('./db/users');
const { Markup } = require('telegraf');
const { isAdmin } = require('./utils/isAdmin');
const { cleanupOldReports } = require('./db/reports');
const cron = require('node-cron');

// State for wizard-like flow
const userStates = {};
const userMetaData = {}; // Store temporary data like which reminder is being edited

const seenCache = {};

// Middleware to mark user as seen (optimized)
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.username) {
        const userId = ctx.from.id.toString();
        const now = Date.now();
        
        // Update DB only every 5 minutes
        if (!seenCache[userId] || (now - seenCache[userId]) > 5 * 60 * 1000) {
             markSeen(ctx.from.id.toString(), ctx.from.username).catch(err => console.error('Seen Error', err));
             seenCache[userId] = now;
        }
    }
    return next();
});

// Register commands and get handlers
const { 
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
    getRemindersKeyboard,
    promptReminderMenu,
    promptReminderTime,
    promptReminderDay,
    updateReminderTime,
    updateReminderDay,
    sendBroadcastLogic,
    scheduleBroadcast
} = adminCommands(bot);
const { getAllSettings } = require('./db/settings');

const { handleReportSubmission } = userCommands(bot);

// /start command
bot.start(async (ctx) => {
    let user = await getUserByTelegramId(ctx.from.id.toString());
    const isUserAdmin = await isAdmin(ctx);
    
    // Ensure Super Admin is synced to DB
    if (isUserAdmin && ctx.from.id.toString() === require('./config').ADMIN_ID) {
         if (!user) {
             await addUser(ctx.from.id.toString(), ctx.from.username || 'admin', ctx.from.first_name || 'Super Admin');
             await setAdminStatus(ctx.from.id.toString(), true);
             user = await getUserByTelegramId(ctx.from.id.toString());
         } else if (user.is_admin !== 1) {
             await setAdminStatus(ctx.from.id.toString(), true);
         }
    }
// Custom Keyboard
    let buttons = [['📝 Здати звіт']];
    if (isUserAdmin) {
        buttons = [['📝 Здати звіт'], ['👥 Користувачі', '📊 Статус'], ['⚙️ Налаштування']];
    }
    const keyboard = Markup.keyboard(buttons).resize();

    if (user) {
        ctx.reply(`👋 Привіт, ${user.full_name || ctx.from.first_name}!
Я готовий до роботи. Якщо хочеш здати звіт, тисни кнопку внизу.`, keyboard);
    } else {
        ctx.reply('Привіт! Я бот для звітів. Ти поки не доданий до системи. Попроси адміна додати тебе, використовуючи твій юзернейм.', Markup.removeKeyboard());
    }
});

// Handle text messages for buttons and state
bot.on(['text', 'document', 'photo'], async (ctx, next) => {
    const message = ctx.message;
    const text = message.text || message.caption || ''; // Grab text/caption
    const userId = ctx.from.id;
    const isUserAdmin = await isAdmin(ctx);

    // 1. STATE HANDLERS (High priority)
    if (userStates[userId] === 'WAITING_FOR_REPORT') {
        if (text === '🚫 Скасувати') {
             userStates[userId] = null;
             let buttons = [['📝 Здати звіт']];
             if (isUserAdmin) buttons = [['📝 Здати звіт'], ['👥 Користувачі', '📊 Статус'], ['⚙️ Налаштування']];
             return ctx.reply('Відправку звіту скасовано.', Markup.keyboard(buttons).resize());
        }

        if (text && text.startsWith('/')) {
            userStates[userId] = null; // Stop waiting for report so command executes
            return next(); 
        }
        
        await handleReportSubmission(ctx);
        userStates[userId] = null; 
        
        let buttons = [['📝 Здати звіт']];
        if (isUserAdmin) buttons = [['📝 Здати звіт'], ['👥 Користувачі', '📊 Статус'], ['⚙️ Налаштування']];
        return ctx.reply('Що робимо далі?', Markup.keyboard(buttons).resize());
    }

    if (userStates[userId] === 'WAITING_FOR_USER_ADD') {
        if (text === '🔙 Назад') {
             userStates[userId] = null;
             return manageUsersHandler(ctx);
        }
        const parts = text.split(' ');
        const username = parts[0];
        const fullName = parts.slice(1).join(' ') || username.replace('@', '');

        if (!username.startsWith('@')) {
             return ctx.reply('Юзернейм має починатись з @. Спробуй ще раз або натисни "🔙 Назад".');
        }

        await addUserLogic(ctx, username, fullName);
        userStates[userId] = null;
        return manageUsersHandler(ctx);
    }

    if (userStates[userId] === 'WAITING_FOR_USER_REMOVE') {
        if (text === '🔙 Назад') {
             userStates[userId] = null;
             return manageUsersHandler(ctx);
        }
        const username = text.trim();
        await removeUserLogic(ctx, username);
        userStates[userId] = null;
        return manageUsersHandler(ctx);
    }

    if (userStates[userId] === 'WAITING_FOR_BROADCAST_MESSAGE') {
        if (text === '🔙 Назад') {
             userStates[userId] = null;
             return manageUsersHandler(ctx);
        }
        
        // Save text and ask for action
        userMetaData[userId] = text; 
        userStates[userId] = 'WAITING_FOR_BROADCAST_ACTION';
        
        return ctx.reply('Текст прийнято. Що робимо далі?', Markup.keyboard([
            ['🚀 Надіслати зараз', '⏰ Запланувати'],
            ['🔙 Назад']
        ]).resize());
    }

    if (userStates[userId] === 'WAITING_FOR_BROADCAST_ACTION') {
         if (text === '🔙 Назад') {
             userStates[userId] = null;
             userMetaData[userId] = null;
             return manageUsersHandler(ctx);
         }
         
         const broadcastText = userMetaData[userId];
         
         if (text === '🚀 Надіслати зараз') {
             await sendBroadcastLogic(ctx, broadcastText);
             userStates[userId] = null;
             userMetaData[userId] = null;
             return manageUsersHandler(ctx); // Or back to main
         }
         
         if (text === '⏰ Запланувати') {
             userStates[userId] = 'WAITING_FOR_BROADCAST_TIME';
             return ctx.reply('Введи час для розсилки (HH:MM). Наприклад: 18:00.', Markup.keyboard([['🔙 Назад']]).resize());
         }
    }

    if (userStates[userId] === 'WAITING_FOR_BROADCAST_TIME') {
         if (text === '🔙 Назад') {
             userStates[userId] = 'WAITING_FOR_BROADCAST_ACTION';
             return ctx.reply('Обери дію:', Markup.keyboard([
                ['🚀 Надіслати зараз', '⏰ Запланувати'],
                ['🔙 Назад']
            ]).resize());
         }
         
         try {
             const broadcastText = userMetaData[userId];
             await scheduleBroadcast(ctx, broadcastText, text.trim());
             
             // Success
             userStates[userId] = null;
             userMetaData[userId] = null;
             return manageUsersHandler(ctx);
         } catch (e) {
             return ctx.reply(`${e.message}. Спробуй ще раз.`);
         }
    }

    if (userStates[userId] === 'WAITING_FOR_ADMIN_ADD') {
        if (text === '🔙 Назад') {
             userStates[userId] = null;
             return manageAdminsHandler(ctx);
        }
        await addAdminLogic(ctx, text.trim());
        userStates[userId] = null;
        return manageAdminsHandler(ctx);
    }

    if (userStates[userId] === 'WAITING_FOR_ADMIN_REMOVE') {
        if (text === '🔙 Назад') {
             userStates[userId] = null;
             return manageAdminsHandler(ctx);
        }
        await removeAdminLogic(ctx, text.trim());
        userStates[userId] = null;
        return manageAdminsHandler(ctx);
    }

    if (userStates[userId] === 'WAITING_FOR_REMINDER_MENU') {
         if (text === '🔙 Назад') {
             userStates[userId] = null;
             userMetaData[userId] = null;
             return remindersHandler(ctx);
         }
         if (text === '🕒 Змінити час') {
             userStates[userId] = 'WAITING_FOR_REMINDER_TIME';
             return promptReminderTime(ctx);
         }
         if (text === '📅 Змінити день') {
             userStates[userId] = 'WAITING_FOR_REMINDER_DAY';
             return promptReminderDay(ctx);
         }
         return ctx.reply('Обери дію з меню.');
    }

    if (userStates[userId] === 'WAITING_FOR_REMINDER_TIME') {
        if (text === '🔙 Назад') {
             // Go back to menu
             userStates[userId] = 'WAITING_FOR_REMINDER_MENU';
             // We need to re-render the menu to show updated state or just the same menu
             const key = userMetaData[userId];
             const settings = await getAllSettings();
             return promptReminderMenu(ctx, key, settings);
        }
        
        try {
            const key = userMetaData[userId];
            const newTime = await updateReminderTime(ctx, key, text.trim());
            ctx.reply(`✅ Час оновлено на ${newTime}!`);
            
            // Go back to Reminder Menu to see changes
            userStates[userId] = 'WAITING_FOR_REMINDER_MENU';
            const settings = await getAllSettings();
            return promptReminderMenu(ctx, key, settings);
        } catch (e) {
            return ctx.reply(`❌ Помилка: ${e.message}.`);
        }
    }

    if (userStates[userId] === 'WAITING_FOR_REMINDER_DAY') {
        if (text === '🔙 Назад') {
             userStates[userId] = 'WAITING_FOR_REMINDER_MENU';
             const key = userMetaData[userId];
             const settings = await getAllSettings();
             return promptReminderMenu(ctx, key, settings);
        }

        try {
             const key = userMetaData[userId];
             const newDay = await updateReminderDay(ctx, key, text);
             ctx.reply(`✅ День оновлено на ${newDay}!`);
             
             userStates[userId] = 'WAITING_FOR_REMINDER_MENU';
             const settings = await getAllSettings();
             return promptReminderMenu(ctx, key, settings);
        } catch (e) {
             return ctx.reply(`❌ Помилка: ${e.message}`);
        }
    }


    // 2. BUTTON HANDLERS
    if (text === '📝 Здати звіт') {
        userStates[userId] = 'WAITING_FOR_REPORT';
        return ctx.reply('Будь ласка, надішли посилання на звіт (Google Docs, Jira, etc.)', Markup.keyboard([['🚫 Скасувати']]).resize());
    }
    
    // Admin only buttons
    if (isUserAdmin) {
        // Top Level
        if (text === '👥 Користувачі') return manageUsersHandler(ctx);
        if (text === '📊 Статус') return statusHandler(ctx);
        if (text === '⚙️ Налаштування') return settingsHandler(ctx);
        
        // Settings Sub-menu
        if (text === '⏰ Нагадування') return remindersHandler(ctx);
        if (text === '👮 Адміни') return manageAdminsHandler(ctx);

        // Reminder Selection (Regex match for "1. ", "2. ", etc)
        const reminderMatch = text.match(/^([1-4])\./);
        if (reminderMatch) {
            const id = reminderMatch[1];
            const keyMap = {
                '1': 'reminder_standard',
                '2': 'reminder_deadline',
                '3': 'reminder_late',
                '4': 'reminder_final'
            };
            const key = keyMap[id];
            
            userStates[userId] = 'WAITING_FOR_REMINDER_MENU';
            userMetaData[userId] = key;
            
            const settings = await getAllSettings();
            return promptReminderMenu(ctx, key, settings);
        }
        
        // Users Sub-menu
        if (text === '📋 Список юзерів') return listUsersHandler(ctx);
        if (text === '➕ Додати юзера') {
             userStates[userId] = 'WAITING_FOR_USER_ADD';
             return ctx.reply('Введи @username користувача (і через пробіл ім\'я, за бажанням).', Markup.keyboard([['🔙 Назад']]).resize());
        }
        if (text === '➖ Видалити юзера') {
             userStates[userId] = 'WAITING_FOR_USER_REMOVE';
             return ctx.reply('Введи @username користувача, якого треба видалити.', Markup.keyboard([['🔙 Назад']]).resize());
        }
        if (text === '📢 Розсилка') {
             userStates[userId] = 'WAITING_FOR_BROADCAST_MESSAGE';
             return ctx.reply('Введи текст оголошення, який отримають ВСІ користувачі зі списку.', Markup.keyboard([['🔙 Назад']]).resize());
        }

        // Admins Sub-menu
        if (text === '📋 Список адмінів') return listAdminsHandler(ctx);
        if (text === '➕ Додати адміна') {
             userStates[userId] = 'WAITING_FOR_ADMIN_ADD';
             return ctx.reply('Введи @username, кого зробити адміном.', Markup.keyboard([['🔙 Назад']]).resize());
        }
        if (text === '➖ Видалити адміна') {
            userStates[userId] = 'WAITING_FOR_ADMIN_REMOVE';
            return ctx.reply('Введи @username, у кого забрати права.', Markup.keyboard([['🔙 Назад']]).resize());
        }

        // Common Back
        if (text === '🔙 Назад') {
             // We don't know exactly where we came from, but usually Back goes to Main Menu from Settings or Users
             // Let's reset to Main Menu
            userStates[userId] = null;
            let buttons = [['📝 Здати звіт']];
            if (isUserAdmin) {
                 buttons = [['📝 Здати звіт'], ['👥 Користувачі', '📊 Статус'], ['⚙️ Налаштування']];
            }
            // If we are in sub menus, maybe we want to go up one level? 
            // But since we don't track depth, Main Menu is safest.
            return ctx.reply('Головне меню', Markup.keyboard(buttons).resize());
        }
    }

    return next();
});
// Initialize Scheduler
initScheduler(bot);

// Schedule Daily Database Cleanup (at 04:00 AM)
cron.schedule('0 4 * * *', async () => {
    console.log('Running daily cleanup...');
    try {
        await cleanupOldReports();
    } catch (e) {
        console.error('Cleanup failed:', e);
    }
}, { timezone: "Europe/Kiev" });

// Error handling
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    ctx.reply('Сталася помилка...');
});

// Launch
bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
