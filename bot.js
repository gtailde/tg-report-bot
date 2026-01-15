const { Telegraf } = require('telegraf');
const config = require('./config');

if (!config.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not defined!');
}

const bot = new Telegraf(config.BOT_TOKEN);

module.exports = bot;
