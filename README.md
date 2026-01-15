# Report Bot

## Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configuration**:
    - Open `.env` file.
    - Set `BOT_TOKEN` (from @BotFather).
    - Set `ADMIN_ID` (your Telegram User ID).
    - Set `GROUP_ID` (the ID of the group where reports should be sent).

3.  **Run**:
    ```bash
    npm start
    ```

## Usage

1.  **Start the bot**:
    Send `/start` to the bot. This registers you as a "seen" user.

2.  **Admin**:
    - `/add @username Full Name` - Add a user to the report system.
    - `/remove @username` - Remove a user.
    - `/list` - List active users.
    - `/status` - Check who submitted reports this week.

3.  **User**:
    - `/report <link>` - Submit your weekly report.

## Scheduler
- **Friday 12:00**: General reminder.
- **Friday 17:00**: Reminder if report is missing.
- **Saturday & Sunday 10:00**: Late reminders.
