# ALMUTARJEM — Telegram Daily Report Bot (standalone app)

A **self-contained, read-only** Node.js app. Sends one clean daily Telegram message with the
files registered that day, grouped by staff: **Sherry** (main Transactions sheet) vs **Rawan**
(Rawan sheet). Totals per staff + grand totals.

**Self-contained:** this folder has everything it needs — its own `package.json`, its own vendored
copy of the read-only data helpers (`lib/sheets.js`, `lib/compute.js`), and its own `.env`. It runs
as its **own Node.js app** with its **own environment variables** and does **not** depend on, run
inside, or modify the dashboard/staging apps or the Google Sheets. No npm dependencies (Node ≥18).

```
bot/
 ├─ telegram-report.js   ← the bot
 ├─ package.json         ← its own project
 ├─ .env.example         ← copy to .env (or use cPanel Environment vars)
 └─ lib/                 ← vendored read-only helpers (sheets.js, compute.js)
```

## 1. Create the Telegram bot
1. Telegram → **@BotFather** → `/newbot` → copy the **token**.
2. Add the bot to the target group/chat; send a message there.
3. Get the **chat id**: open `https://api.telegram.org/bot<TOKEN>/getUpdates` → read `message.chat.id`
   (groups are negative, e.g. `-1001234567890`).

## 2. Configure (env vars)
Set these in the **cPanel app's Environment variables** (preferred — secrets stay off disk),
or copy `.env.example` → `.env` locally. Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`REPORT_TIME_UAE`, `SPREADSHEET_ID`, `SHEET_TRANSACTIONS/EXPENSES/SETTINGS`, `RAWAN_GVIZ_URL`.

## 3. Run locally
```bash
cd bot
node telegram-report.js --dry today       # build + PRINT (no token needed) — great for testing
node telegram-report.js --today           # send once, then exit
node telegram-report.js                    # persistent: 8pm auto-send + live /today /yesterday
```
Telegram commands (only from the configured chat): **/today**, **/yesterday**, **/help**.

## 4. Deploy as its OWN cPanel Node.js app
1. **Get the code** (Terminal): `git clone -b feature/mobile-daily-leads https://github.com/Mgho87/ats-dashboard.git ~/ats-bot`
   → the bot lives at `~/ats-bot/bot` (fully self-contained).
2. **A URL for it:** create subdomain `bot.mutarjem.ae` (Passenger requires an Application URL).
3. **Setup Node.js App:**
   - Application root: **`ats-bot/bot`**   ← the bot folder itself
   - Application URL: `bot.mutarjem.ae`
   - Startup file: **`telegram-report.js`**
   - Node: 20 → **Create** → **Run NPM Install**.
4. **Environment variables:** add the vars from step 2 (token + chat id + report time + sheet vars).
5. **Save → Restart.** Check `~/ats-bot/bot/bot.log` for `bot started (persistent)`.
6. **Stop/Restart:** cPanel → Setup Node.js App → this app → Stop / Restart. Independent of the
   dashboard — stopping it has zero effect on the dashboard or staging.
7. **Update later:** `cd ~/ats-bot && git pull origin feature/mobile-daily-leads` → **Restart**.

## Notes
- The persistent app binds the PORT cPanel gives it (a tiny `ats-bot ok` health page) so Passenger
  keeps the background worker alive.
- Read-only: never writes to the sheets, the dashboard, or anything but Telegram messages it sends.
- Every send result and any Google-Sheet error is logged to `bot.log` (+ console).
- Sheets have no time column → "Time" shows `—` (not fabricated).
- Only the configured `TELEGRAM_CHAT_ID` may trigger commands.
