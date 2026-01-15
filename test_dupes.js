const { getAllUsers } = require('./db/users');

(async () => {
    try {
        const users = await getAllUsers();
        console.log('Total users:', users.length);
        const map = {};
        users.forEach(u => {
            if (map[u.telegram_id]) {
                console.log('DUPLICATE:', u.telegram_id, u.username);
            }
            map[u.telegram_id] = true;
        });
        console.log('Unique users:', Object.keys(map).length);
    } catch (e) {
        console.error(e);
    }
})();
