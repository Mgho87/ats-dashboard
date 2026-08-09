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

## 3. Run modes
```bash
cd bot
node telegram-report.js --dry today            # build + PRINT (no token needed) — great for testing
node telegram-report.js --dry --date 2026-07-04  # preview any specific day
node telegram-report.js --tick                 # PRIMARY: one idempotent self-healing tick, then exit (cron)
node telegram-report.js --status               # print the health/monitor JSON (no token needed)
node telegram-report.js --today                # force-send today's report once (manual)
node telegram-report.js --send --date 2026-07-04 # force-send a specific day once (manual)
node telegram-report.js                         # persistent BACKUP scheduler (runs --tick on an interval)
```

## 4. Reliability architecture (how "every day at 20:00" is guaranteed)
Timing is driven by an **external cPanel cron job** — not by the Node process — so it survives Passenger
reaping the worker. Each run is a stateless, **idempotent, self-healing tick**:

- **Primary trigger:** cPanel cron runs `--tick` every ~5 min. Once the Dubai clock passes `REPORT_TIME`
  and today isn't already delivered, it builds + sends the report.
- **Delivery verification:** a report counts as delivered only when Telegram confirms `ok:true` **and**
  returns a `message_id` for every chunk.
- **Retry + backoff:** each tick retries in-process (0s → 3s → 9s). If it still fails, the day is left
  **queued** in `state.json` and the *next* cron tick retries — surviving a multi-hour Telegram outage.
- **Give up + alert:** after `BOT_MAX_RETRY_MIN` (default 3.5h) of failing attempts it records a permanent
  failure and sends an **operator alert** to the chat (never silent).
- **Missed-report recovery:** if the server was down at 20:00 and returns within `BOT_CATCHUP_MAX_LATE_MIN`
  (default 5h), the first tick after it's back sends the missed report. Beyond that window a stale report
  is skipped and the next day proceeds normally.
- **Duplicate prevention:** a per-day `O_EXCL` lock file plus `state.json` (`lastSuccess` + `message_id`s)
  guarantee exactly one delivery per day, even with cron and the backup app running at once.
- **Backup layer:** the persistent app runs the *same* tick on a `BOT_TICK_INTERVAL_MS` interval (default
  5 min) and catches up on start — a redundant safety net if cron is ever misconfigured.

## 5. Deploy as its OWN cPanel Node.js app
1. **Get the code** (Terminal): `git clone -b feature/mobile-daily-leads https://github.com/Mgho87/ats-dashboard.git ~/ats-bot`
   → the bot lives at `~/ats-bot/bot` (fully self-contained).
2. **A URL for it:** create subdomain `bot.mutarjem.ae` (Passenger requires an Application URL).
3. **Setup Node.js App:**
   - Application root: **`ats-bot/bot`**   ← the bot folder itself
   - Application URL: `bot.mutarjem.ae`
   - Startup file: **`telegram-report.js`**
   - Node: 20 → **Create** → **Run NPM Install**.
4. **Environment variables:** token + chat id + report time + sheet vars (see `.env.example`).
5. **Save → Restart.** Check `~/ats-bot/bot/bot.log` for `started (persistent BACKUP scheduler)`.
6. **Add the cron job (the primary trigger)** — cPanel → **Cron Jobs**. Get the Node path with
   `which node` first. Then add, every 5 minutes:
   ```
   */5 * * * * cd ~/ats-bot/bot && /path/to/node telegram-report.js --tick >> cron.log 2>&1
   ```
7. **Update later:** `cd ~/ats-bot && git pull origin feature/mobile-daily-leads` → **Restart**.

## 5b. Daily Office Report IMAGE (PNG) — `DAILY_REPORT_MODE`
The report is delivered as **TWO** professional dashboard PNGs (sent in order) instead of text:
- **Page 1 — Daily Operations Dashboard** ("what happened today"): Sherry KPIs, revenue summary,
  today's files table (Sherry pending = pending *payment/processing*, kept here), confirmed/accepted
  customer replies, and a short daily summary. Archived as `Daily_Report_<date>_p1.png`.
- **Page 2 — Follow-up & Sales Dashboard** ("what to do next"): pending customer confirmation, not
  interested, customer follow-up, high priority (by value), business analysis, data-driven AI
  recommendations, office notes, validation. Archived as `Daily_Report_<date>_p2.png`.

Both pages together hold ALL data (nothing removed, only reorganized). Each page is sent as its own
image with caption `Daily Office Report — <date> · Page N/2 · <title>`.

**Page 2 = carried-forward Sales Pipeline (audited, `pipeline.js`).** Operations (Page 1) are SAME-DAY
Sherry; the pipeline is CARRIED-FORWARD Rawan (open leads from any prior date whose latest state is
still open). Engine rules:
- **Lead identity:** valid reference, else `phone + service + inquiry-month` (never phone alone).
- **Latest-state:** a lead's newest row decides its status; history collapses.
- **Classes:** WON / LOST / OPEN / NEEDS_REVIEW. "Other"/blank → NEEDS_REVIEW (never silently OPEN).
- **Conversion confidence:** HIGH (same phone + same ref, or same amount + date ≤14d, with a
  paid/delivered Sherry job) auto-closes → WON_CONVERTED; MEDIUM/LOW only flag, never auto-close.
- **Age** buckets only (NEW/FOLLOW-UP/OVERDUE/AGING/STALE/STALE-REVIEW) — it never turns OPEN→LOST.
- **Note↔outcome contradiction** (e.g. "found someone else" on a Price-Issue lead) → NEEDS_REVIEW.
- **Headline = ACTIVE OPEN (0–30 days).** STALE (31–45), STALE-REVIEW (46+), NEEDS_REVIEW, TODAY NEW,
  TODAY WON, and HIGH-VALUE (≥AED 2,000, visible at any age) are separate KPIs — never one inflated total.
- **Source health** (`sourceHealth`): SOURCE_OK / STALE_DATA / SOURCE_UNAVAILABLE / EMPTY_VALID. On
  SOURCE_UNAVAILABLE the pipeline shows a red banner + "—", **never AED 0** (`getRawanAll()` retries and
  detects the flaky publish-to-web HTML error page). Validate: `node test-pipeline.js`.
- **Modes** (env `DAILY_REPORT_MODE`): `text` (default/rollback, unchanged), `png` (build + send the
  image), `dry-run` (build + archive the image, no send, no token needed).
- **Renderer:** the report is generated as an **SVG** and rasterised by **Sharp** (`sharp`, a prebuilt
  libvips binary — cPanel-safe, no Chromium/Puppeteer). If Sharp is ever unavailable, the same SVG is
  rasterised by `@resvg/resvg-js` (optional fallback). Install: `npm install` in `~/ats-bot/bot`.
- **Size:** width fixed at ~2300 px; **height is dynamic** — as tall as needed to show EVERY record.
  No A4 ratio, no clipping, no "…and more", no font shrinking.
- **Telegram:** `png` mode sends ONLY the image via `sendPhoto`, automatically falling back to
  `sendDocument` when the image exceeds Telegram photo limits (width+height > 10000, > 10 MB, or ratio
  > 20). Content is never trimmed to fit. Caption: `Daily Office Report — <date>`.
- **Archive:** each render is saved to `bot/archive/Daily_Report_<date>.png` (gitignored).
- **Test locally:** `node test-report-image.js` renders 10 scenarios (normal, empty, many/tall,
  missing logo, long Arabic, long English, unmatched, duplicate refs, all pending, all completed).

### Logo (`assets/almutarjem-logo.png`) — accurate note
The processed logo was background-removed by **edge flood-fill**. It is visually faithful **on a white
background only**. Some flat white/light *page* pixels became transparent because they were connected to
the outer background, so **not every interior pixel is preserved** — do **not** place this logo over
dark or coloured backgrounds; always keep a white logo-safe area behind it (the report header is white
for this reason). The pristine original is preserved at `assets/almutarjem-logo-original.png`.

## 6. Monitoring
- `node telegram-report.js --status` → JSON: last success, next scheduled, pending/queue, retry count,
  last Telegram response, last exception, uptime.
- The persistent app also serves the same JSON at **`https://bot.mutarjem.ae/health`**.
- `state.json` (durable queue/monitor) and `events.log` (structured JSON, one event per line) live in
  `~/ats-bot/bot/`. Both are gitignored (per-server runtime).

## Notes
- Read-only: never writes to the sheets, the dashboard, or anything but Telegram messages it sends.
- Every reporting event (generate, send, retry, deliver, queue, permanent-failure, recovery) is written
  to `events.log` (JSON) **and** `bot.log` (human) — nothing fails silently.
- Sheets have no time column → "Time" shows `—` (not fabricated).
- Command polling (`/today` etc.) stays disabled by default (Passenger multi-worker safe).
