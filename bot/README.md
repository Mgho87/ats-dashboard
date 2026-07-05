# ALMUTARJEM — Telegram Daily Report Bot

Standalone, **read-only** bot. Sends one clean daily Telegram message with the files
registered that day, grouped by staff: **Sherry** (main Transactions sheet) vs **Rawan**
(Rawan sheet). It reuses the dashboard's own data layer (`lib/sheets.js` + `lib/compute.js`)
and **does not modify** the dashboard, the server, or the Google Sheets.

## What it sends
- Header (date) + per-file lines: Time (— , not stored in sheet), ATS №/ref, client, service,
  amount, payment status, file status, notes.
- Two sections: 👩‍💼 Sherry, then 👩‍💼 Rawan.
- Totals: files + revenue per staff, plus grand totals.

## 1. Create the Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **token**.
2. Add the bot to the group/channel (or DM it) where reports should go.
3. Get the **chat id**: send any message in that chat, then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and read `message.chat.id`
   (groups are negative, e.g. `-1001234567890`). Or use **@userinfobot** for a personal chat id.

## 2. Configure (env vars — in `.env` locally, or the cPanel Node app's Environment)
```
TELEGRAM_BOT_TOKEN=123456:ABC...       # from BotFather
TELEGRAM_CHAT_ID=-1001234567890         # target chat (also the only chat allowed to command)
REPORT_TIME_UAE=20:00                    # daily send time, Asia/Dubai (default 20:00)
# reused automatically: SPREADSHEET_ID, SHEET_TRANSACTIONS/EXPENSES/SETTINGS, RAWAN_GVIZ_URL
```

## 3. Run
```bash
# Test WITHOUT sending (no token needed) — prints today's report to the console:
node bot/telegram-report.js --dry today
node bot/telegram-report.js --dry yesterday

# Send once and exit (great for cron):
node bot/telegram-report.js --today
node bot/telegram-report.js --yesterday

# Persistent: auto-sends daily at REPORT_TIME_UAE AND answers /today and /yesterday live:
node bot/telegram-report.js
```

### Commands (in Telegram, from the configured chat)
- `/today` — send today's report now
- `/yesterday` — send yesterday's report
- `/help` — usage

## 4. Deployment options (pick one)
- **Persistent process (gives live /today /yesterday commands):** run
  `node bot/telegram-report.js` as its own cPanel *Setup Node.js App* (startup file
  `bot/telegram-report.js`) or via `pm2 start bot/telegram-report.js --name ats-bot`.
- **Cron only (simplest, no live commands):** add a daily cron at 20:00 UAE:
  `cd ~/ats-dashboard && node bot/telegram-report.js --today`

## Notes
- Read-only: it never writes to Telegram-triggered edits, the sheets, or the dashboard.
- Every send result and any Google-Sheet error is logged to `bot/bot.log` and the console.
- The sheets have **no time column**, so "Time" shows `—` (not fabricated).
- Only the configured `TELEGRAM_CHAT_ID` can trigger commands.
