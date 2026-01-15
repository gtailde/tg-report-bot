const { DateTime, Settings } = require('luxon');

// Set default timezone to Kyiv
Settings.defaultZone = 'Europe/Kiev';

function getCurrentWeekAndYear() {
    const now = DateTime.now();
    return {
        week: now.weekNumber,
        year: now.weekYear
    };
}

function getFormattedDate(isoDate) {
    if (isoDate) {
        return DateTime.fromISO(isoDate).toFormat('dd.MM');
    }
    return DateTime.now().toFormat('dd.MM.yyyy');
}

function getWeekDateRange(week, year) {
    const dt = DateTime.fromObject({ weekYear: year, weekNumber: week });
    const start = dt.startOf('week');
    const end = dt.endOf('week');
    return `${start.toFormat('dd.MM')} — ${end.toFormat('dd.MM')}`;
}

module.exports = { getCurrentWeekAndYear, getFormattedDate, getWeekDateRange };
