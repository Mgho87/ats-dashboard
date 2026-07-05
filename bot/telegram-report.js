'use strict';
/* ============================================================================
 * ALMUTARJEM — Telegram Daily Report Bot  (standalone, READ-ONLY)
 * ----------------------------------------------------------------------------
 * Sends one clean daily Telegram message with the files registered TODAY,
 * grouped by staff:  Sherry (main Transactions sheet)  vs  Rawan (Rawan sheet).
 *
 * Reuses the dashboard's own read-only data layer (lib/sheets + lib/compute) —
 * it does NOT modify the dashboard, the server, or the Google Sheets.
 *
 * Run modes:
 *   node bot/telegram-report.js              persistent: 8pm auto-send + /today /yesterday
 *   node bot/telegram-report.js --today      send today's report once, then exit (for cron)
 *   node bot/telegram-report.js --yesterday  send yesterday's report once, then exit
 *   node bot/telegram-report.js --dry today  build + PRINT the report (no Telegram needed)
 *
 * Env vars (read from ../.env or the process environment):
 *   TELEGRAM_BOT_TOKEN   from @BotFather
 *   TELEGRAM_CHAT_ID     the chat/group to post to (also the only chat allowed to command)
 *   REPORT_TIME_UAE      daily send time, "HH:MM" Asia/Dubai (default 20:00)
 *   SPREADSHEET_ID       (reused) main Google Sheet id
 *   SHEET_TRANSACTIONS / SHEET_EXPENSES / SHEET_SETTINGS  (reused, optional)
 *   RAWAN_GVIZ_URL       (reused) Rawan published-CSV url
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { fetchSheet, fetchSheetOptional } = require('./lib/sheets');   // self-contained (vendored) — no dashboard dependency
const compute = require('./lib/compute');

/* ---------- tiny .env loader (never overrides real env; cPanel sets process.env directly) ----------
 * Reads the bot's own .env first, then a repo-root .env as a dev fallback when run inside the repo. */
(function loadEnv() {
  for (const p of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    try {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
    } catch (_) {}
  }
})();

const TOKEN   = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const REPORT_TIME = (process.env.REPORT_TIME_UAE || '20:00').trim();
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const T_NAME = process.env.SHEET_TRANSACTIONS || 'Transactions';
const E_NAME = process.env.SHEET_EXPENSES || 'Expenses';
const S_NAME = process.env.SHEET_SETTINGS || 'Settings';
const RAWAN_URL = (process.env.RAWAN_GVIZ_URL || process.env.ROWAN_GVIZ_URL || '').trim();
const TZ = 'Asia/Dubai';

/* ---------- logging (console + bot/bot.log) ---------- */
const LOG_FILE = path.join(__dirname, 'bot.log');
function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

/* ---------- helpers ---------- */
const AED = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function dayKeyDubai(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
}
function fmtDay(dk) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dk || ''); if (!m) return dk || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
const cap = s => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '—'; };
const isCancelled = st => /cancel/i.test(String(st || ''));

/* ---------- minimal CSV parser + Rawan mapping (ports the dashboard's rawanParse) ---------- */
function parseCSV(text) {
  const rows = []; let i = 0, field = '', row = [], inQ = false; const s = String(text || '');
  while (i < s.length) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const _MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function rawanDateKey(v) {
  v = String(v == null ? '' : v).trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = v.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);            // 17-Jun-2026
  if (m) { const mm = _MON[m[2].slice(0, 3).toLowerCase()]; if (mm) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + mm + '-' + String(m[1]).padStart(2, '0'); } }
  m = v.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);                     // 17/06/2026 (D/M/Y)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); }
  return '';
}
function rawanAmount(s) { const n = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

/* ---------- data fetch for a given day ---------- */
async function getSherry(dateKey) {
  const trans = await fetchSheet(SPREADSHEET_ID, T_NAME);
  const exp = (await fetchSheetOptional(SPREADSHEET_ID, E_NAME)) || { headers: [], rows: [] };
  const settings = await fetchSheetOptional(SPREADSHEET_ID, S_NAME);
  const parsed = compute.parseAll(trans, exp, settings, new Date());
  return parsed.records.filter(r => r.dateKey === dateKey).map(r => ({
    ref: r.ref || '', client: r.client || '', service: r.service || '', amount: +r.amount || 0,
    status: r.payment || '', fileStatus: r.delivery || '', notes: r.notes || '', phone: r.phone || '',
  }));
}
async function getRawan(dateKey) {
  if (!RAWAN_URL) return { rows: [], connected: false };
  const bust = (RAWAN_URL.includes('?') ? '&' : '?') + '_=' + Date.now();
  const r = await fetch(RAWAN_URL + bust, { cache: 'no-store', redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error('Rawan source responded ' + r.status);
  const grid = parseCSV(await r.text()).filter(x => x.some(c => String(c).trim() !== ''));
  if (!grid.length) return { rows: [], connected: true };
  const idx = {};
  grid[0].forEach((h, n) => {
    const k = String(h || '').trim().toLowerCase();
    if (/refr?ence|reference/.test(k)) idx.ref = n; else if (k === 'date') idx.date = n;
    else if (/client/.test(k)) idx.client = n; else if (/phone/.test(k)) idx.phone = n;
    else if (/service/.test(k)) idx.service = n; else if (/amount/.test(k)) idx.amount = n;
    else if (/payment status/.test(k)) idx.status = n; else if (/file status/.test(k)) idx.fileStatus = n;
    else if (/payment method/.test(k)) idx.method = n; else if (/lead outcome/.test(k)) idx.outcome = n;
    else if (/note/.test(k)) idx.notes = n;
  });
  const g = (row, f) => idx[f] != null ? String(row[idx[f]] == null ? '' : row[idx[f]]).trim() : '';
  const rows = grid.slice(1)
    .filter(row => rawanDateKey(g(row, 'date')) === dateKey)
    .map(row => ({
      ref: g(row, 'ref'), client: g(row, 'client'), service: g(row, 'service'), amount: rawanAmount(g(row, 'amount')),
      status: g(row, 'status'), fileStatus: g(row, 'fileStatus'), outcome: g(row, 'outcome'), notes: g(row, 'notes'), phone: g(row, 'phone'),
    }))
    .filter(o => o.client || (o.ref && o.ref !== '0') || o.service || o.amount || o.phone); // drop blank placeholder rows
  return { rows, connected: true };
}

/* ---------- report building (returns array of message chunks ≤ Telegram limit) ---------- */
function fileLine(i, r, withOutcome) {
  const ref = r.ref && r.ref !== '0' ? '#' + esc(r.ref) : '—';
  let s = `${i}) 🕐— · <b>${ref}</b>\n`;
  s += `   ${esc(r.client || '—')}${r.service ? ' · ' + esc(r.service) : ''}\n`;
  s += `   <b>${AED(r.amount)}</b> · ${esc(cap(r.status))} · ${esc(cap(r.fileStatus))}`;
  if (withOutcome && r.outcome) s += ` · ${esc(cap(r.outcome))}`;
  if (r.notes) s += `\n   📝 ${esc(r.notes)}`;
  return s + '\n';
}
function totals(list) {
  return { files: list.length, revenue: list.reduce((a, r) => a + (isCancelled(r.status) ? 0 : r.amount), 0) };
}
function buildReport(dateKey, label, sherry, rawan, rawanConnected) {
  const st = totals(sherry), rt = totals(rawan);
  const header =
    `📋 <b>ALMUTARJEM — Daily Files</b>\n` +
    `🗓 ${esc(fmtDay(dateKey))}${label ? '  <i>(' + esc(label) + ')</i>' : ''}\n` +
    `<i>times not stored in sheet → shown as —</i>\n`;
  const sherrySec =
    `\n━━━━━━━━━━━━━━\n👩‍💼 <b>SHERRY</b> — ${st.files} files · <b>${AED(st.revenue)}</b>\n━━━━━━━━━━━━━━\n` +
    (sherry.length ? sherry.map((r, i) => fileLine(i + 1, r, false)).join('') : '<i>No files.</i>\n');
  const rawanSec =
    `\n━━━━━━━━━━━━━━\n👩‍💼 <b>RAWAN</b> — ${rt.files} files · <b>${AED(rt.revenue)}</b>\n━━━━━━━━━━━━━━\n` +
    (!rawanConnected ? '<i>Rawan feed not connected.</i>\n'
      : rawan.length ? rawan.map((r, i) => fileLine(i + 1, r, true)).join('') : '<i>No files.</i>\n');
  const footer =
    `\n━━━━━━━━━━━━━━\n📊 <b>TOTALS</b>\n` +
    `Sherry: <b>${st.files}</b> files · <b>${AED(st.revenue)}</b>\n` +
    `Rawan:  <b>${rt.files}</b> files · <b>${AED(rt.revenue)}</b>\n` +
    `Grand:  <b>${st.files + rt.files}</b> files · <b>${AED(st.revenue + rt.revenue)}</b>`;

  // Assemble, then split into ≤4000-char chunks on line boundaries (Telegram limit is 4096).
  const full = header + sherrySec + rawanSec + footer;
  if (full.length <= 4000) return [full];
  const chunks = []; let cur = '';
  for (const line of full.split('\n')) {
    if ((cur + line + '\n').length > 4000) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/* ---------- Telegram API ---------- */
async function tg(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await res.json().catch(() => ({ ok: false, description: 'non-JSON response' }));
  if (!j.ok) throw new Error(method + ' → ' + (j.description || res.status));
  return j;
}
async function sendChunks(chatId, chunks) {
  for (const c of chunks) {
    await tg('sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

/* ---------- the main action: build + (optionally) send a report for a day ---------- */
async function makeReport(dateKey, label) {
  let sherry = [], rawanRes = { rows: [], connected: false };
  try { sherry = await getSherry(dateKey); }
  catch (e) { log('SHEET ERROR (Sherry/' + dateKey + '): ' + e.message); throw e; }
  try { rawanRes = await getRawan(dateKey); }
  catch (e) { log('SHEET ERROR (Rawan/' + dateKey + '): ' + e.message); /* Rawan optional — continue */ }
  const chunks = buildReport(dateKey, label, sherry, rawanRes.rows, rawanRes.connected);
  return { chunks, sherryN: sherry.length, rawanN: rawanRes.rows.length };
}
async function sendReport(dateKey, label, chatId) {
  const target = chatId || CHAT_ID;
  try {
    const { chunks, sherryN, rawanN } = await makeReport(dateKey, label);
    await sendChunks(target, chunks);
    log(`SENT ${label} (${dateKey}) → chat ${target} · Sherry ${sherryN} · Rawan ${rawanN} · ${chunks.length} msg(s)`);
  } catch (e) {
    log(`SEND FAILED ${label} (${dateKey}) → chat ${target}: ${e.message}`);
    try { if (TOKEN && target) await tg('sendMessage', { chat_id: target, text: '⚠️ Daily report failed: ' + e.message }); } catch (_) {}
  }
}

/* ---------- scheduler (persistent mode): fire once per day at REPORT_TIME_UAE ---------- */
function msUntilReport() {
  const [H, M] = REPORT_TIME.split(':').map(Number);
  const now = new Date();
  const dubaiNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const target = new Date(dubaiNow); target.setHours(H || 20, M || 0, 0, 0);
  if (target <= dubaiNow) target.setDate(target.getDate() + 1);
  return target - dubaiNow;
}
function scheduleDaily() {
  const wait = msUntilReport();
  log(`Next daily report in ${(wait / 3600000).toFixed(2)}h (at ${REPORT_TIME} ${TZ}).`);
  setTimeout(async () => {
    await sendReport(dayKeyDubai(0), 'Today', CHAT_ID);
    scheduleDaily();
  }, wait);
}

/* ---------- command polling (persistent mode): /today /yesterday /help ---------- */
async function pollCommands() {
  let offset = 0;
  for (;;) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30 });
      for (const u of res.result) {
        offset = u.update_id + 1;
        const msg = u.message || u.channel_post; if (!msg || !msg.text) continue;
        const chatId = msg.chat && msg.chat.id;
        if (String(chatId) !== String(CHAT_ID)) continue; // only the configured chat may command
        const cmd = msg.text.trim().toLowerCase().split(/\s|@/)[0];
        if (cmd === '/today') { log('cmd /today from ' + chatId); await sendReport(dayKeyDubai(0), 'Today', chatId); }
        else if (cmd === '/yesterday') { log('cmd /yesterday from ' + chatId); await sendReport(dayKeyDubai(-1), 'Yesterday', chatId); }
        else if (cmd === '/start' || cmd === '/help') { await tg('sendMessage', { chat_id: chatId, text: 'ALMUTARJEM daily report bot.\nCommands:\n/today — today\'s files\n/yesterday — yesterday\'s files\nAuto-sends daily at ' + REPORT_TIME + ' (UAE).' }); }
      }
    } catch (e) { log('poll error: ' + e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}

/* ---------- entrypoint ---------- */
(async function main() {
  const args = process.argv.slice(2);
  const has = f => args.includes(f);

  if (!SPREADSHEET_ID) { log('FATAL: SPREADSHEET_ID not set.'); process.exit(1); }

  // Dry run — build + print, no Telegram token needed (for testing the data/format)
  if (has('--dry')) {
    const which = args.includes('--yesterday') || args[args.indexOf('--dry') + 1] === 'yesterday' ? -1 : 0;
    const dk = dayKeyDubai(which);
    const { chunks, sherryN, rawanN } = await makeReport(dk, which ? 'Yesterday' : 'Today');
    console.log('\n----- DRY REPORT ' + dk + ' (Sherry ' + sherryN + ', Rawan ' + rawanN + ') -----\n');
    console.log(chunks.join('\n----- (next message) -----\n').replace(/<\/?[^>]+>/g, '')); // strip HTML tags for console
    process.exit(0);
  }

  if (!TOKEN || !CHAT_ID) { log('FATAL: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or use --dry).'); process.exit(1); }

  // One-shot modes (ideal for cron)
  if (has('--today'))     { await sendReport(dayKeyDubai(0), 'Today', CHAT_ID);     process.exit(0); }
  if (has('--yesterday')) { await sendReport(dayKeyDubai(-1), 'Yesterday', CHAT_ID); process.exit(0); }

  // Persistent mode: daily scheduler + live commands.
  // cPanel/Passenger keeps a Node app alive only if it binds the PORT it provides — so bind a tiny
  // health endpoint. The background worker (scheduler + Telegram polling) runs alongside it.
  if (process.env.PORT) {
    try {
      require('http').createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ats-bot ok'); })
        .listen(process.env.PORT, () => log('health server on port ' + process.env.PORT));
    } catch (e) { log('health server error: ' + e.message); }
  }
  log('ALMUTARJEM Telegram bot started (persistent). Report time ' + REPORT_TIME + ' ' + TZ + '.');
  scheduleDaily();
  pollCommands();
})();
