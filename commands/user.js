const { getUserByTelegramId } = require('../db/users');
const { addReport } = require('../db/reports');
const { getCurrentWeekAndYear, getFormattedDate } = require('../utils/date');
const config = require('../config');

async function handleReportSubmission(ctx) {
    const user = await getUserByTelegramId(ctx.from.id.toString());
    if (!user) {
        return ctx.reply('Ти не доданий до системи. Звернись до адміна.');
    }

    const message = ctx.message;
    let reportValue = ''; // Stored in DB
    let isFile = false;

    // Determine type
    if (message.document) {
        reportValue = `FILE|${message.document.file_id}|${message.document.file_name || 'doc'}`;
        isFile = true;
    } else if (message.photo) {
        const photo = message.photo[message.photo.length - 1]; // largest
        reportValue = `PHOTO|${photo.file_id}`;
        isFile = true;
    } else if (message.text) {
        reportValue = message.text;
    } else {
        return ctx.reply('Будь ласка, надішли текст, посилання або файл.');
    }

    const { week, year } = getCurrentWeekAndYear();

    // 1. Save to DB
    try {
        await addReport(user.id, week, year, reportValue);
        ctx.reply('Звіт відправлено! ✅');
    } catch (e) {
        console.error('DB Error:', e);
        return ctx.reply('❌ Помилка бази даних при збереженні звіту.');
    }

    // 2. Send to Group (Independent step)
    if (config.GROUP_ID) {
        try {
            // Helper to escape HTML characters
            const escape = (text) => (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            const dateStr = getFormattedDate();
            const userNameDisplay = `${user.full_name} (@${user.username})`;
            
            // Build base caption with HTML
            const caption = `📄 <b>Тижневий звіт</b>\n👤 ${escape(userNameDisplay)}\n📅 ${dateStr}\n`;
            
            if (message.document) {
                await ctx.telegram.sendDocument(config.GROUP_ID, message.document.file_id, {
                    caption: caption + `📎 Документ: ${escape(message.document.file_name || 'Файл')}`,
                    parse_mode: 'HTML'
                });
            } else if (message.photo) {
                const photo = message.photo[message.photo.length - 1];
                await ctx.telegram.sendPhoto(config.GROUP_ID, photo.file_id, {
                    caption: caption + `🖼 Фото-звіт`,
                    parse_mode: 'HTML'
                });
            } else {
                // Text or Link
                const hasLink = /(https?:\/\/[^\s]+)/.test(reportValue);
                const emoji = hasLink ? '🔗 ' : '';
                await ctx.telegram.sendMessage(config.GROUP_ID, caption + `📝 Зміст: ${emoji}${escape(reportValue)}`, { parse_mode: 'HTML' });
            }
        } catch (e) {
            console.error('Group Send Error:', e);
            // Don't spam user with group errors, but maybe notify admin?
            // Or just log it. The report IS saved.
            ctx.reply('⚠️ Звіт збережено, але виникла помилка при відправці в групу моніторингу.');
        }
    } else {
        console.warn('GROUP_ID is not set in .env');
    }
}

module.exports = (bot) => {
    bot.command('report', async (ctx) => {
        // Handle /report command manually if needed, but usually strictly state-based now?
        // If user types /report some text
        const text = ctx.message.text;
        const args = text.split(' ');
        if (args.length > 1) {
             // Treat validation as done
             await handleReportSubmission(ctx); 
        } else {
            ctx.reply('Будь ласка, надішли текст звіту або файл.');
        }
    });

    return { handleReportSubmission };
};
