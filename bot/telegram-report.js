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
// Output mode: 'text' (legacy text report — default/rollback), 'png' (image report),
// 'dry-run' (build the image but DO NOT send). Defaults to text so the live report is
// preserved until the PNG path is validated + the Telegram token is fixed.
const REPORT_MODE = (process.env.DAILY_REPORT_MODE || 'text').trim().toLowerCase();
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const T_NAME = process.env.SHEET_TRANSACTIONS || 'Transactions';
const E_NAME = process.env.SHEET_EXPENSES || 'Expenses';
const S_NAME = process.env.SHEET_SETTINGS || 'Settings';
const RAWAN_URL = (process.env.RAWAN_GVIZ_URL || process.env.ROWAN_GVIZ_URL || '').trim();
const TZ = 'Asia/Dubai';

/* ---------- clock (override-able for tests: BOT_NOW_OVERRIDE=ISO) ---------- */
const NOW_OVERRIDE = process.env.BOT_NOW_OVERRIDE ? Date.parse(process.env.BOT_NOW_OVERRIDE) : null;
function nowMs() { return (NOW_OVERRIDE != null && !isNaN(NOW_OVERRIDE)) ? NOW_OVERRIDE : Date.now(); }
function nowISO() { return new Date(nowMs()).toISOString(); }

/* ---------- logging (console + bot/bot.log human log + bot/events.log JSON) ---------- */
const LOG_FILE = path.join(__dirname, 'bot.log');
const EVENTS_FILE = path.join(__dirname, 'events.log');
let LOG_WRITE_FAILED = false;
function log(msg) {
  const line = '[' + nowISO() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); LOG_WRITE_FAILED = false; }
  catch (e) { if (!LOG_WRITE_FAILED) { LOG_WRITE_FAILED = true; console.error('LOG WRITE FAILED (' + LOG_FILE + '): ' + e.message); } }
}
/* Structured, machine-readable event log — one JSON object per line. Never silent: any write
 * failure is surfaced on stderr. Every reporting event goes through here (requirement #6). */
function logEvent(evt, fields) {
  const rec = Object.assign({ ts: nowISO(), evt: evt, pid: process.pid }, fields || {});
  let json; try { json = JSON.stringify(rec); } catch (_) { json = JSON.stringify({ ts: nowISO(), evt: evt, pid: process.pid, note: 'unserializable fields' }); }
  try { fs.appendFileSync(EVENTS_FILE, json + '\n'); } catch (e) { console.error('EVENT WRITE FAILED: ' + e.message); }
  log(evt + (fields ? ' ' + json : ''));   // mirror into the human log so nothing is hidden
}

/* ---------- durable state (state.json) — the queue + the monitor (requirements #3,#4,#5) ----------
 * Atomic write (temp file + rename). Fields:
 *   lastSuccess : { date, at, messageIds, sherryN, rawanN }   last confirmed Telegram delivery
 *   pending     : { date, attempts, firstTriedAt, lastTriedAt, lastError }   report owed, not yet delivered
 *   lastFailure : { date, at, attempts, error }   a day we permanently gave up on (already alerted)
 *   lastTelegram: { at, ok, description }          most recent Telegram API response
 *   lastTickAt  : ISO of the most recent tick
 *   startedAt   : ISO the current persistent process booted (uptime) */
const STATE_FILE = path.join(__dirname, 'state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; }
  catch (e) { if (e.code !== 'ENOENT') log('STATE READ WARN: ' + e.message + ' (starting from empty state)'); return {}; }
}
function writeState(st) {
  const tmp = STATE_FILE + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(st, null, 2)); fs.renameSync(tmp, STATE_FILE); }
  catch (e) { log('STATE WRITE FAILED: ' + e.message); try { fs.unlinkSync(tmp); } catch (_) {} }
}

/* ---------- helpers ---------- */
const AED = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function dayKeyDubai(offsetDays = 0) {
  const d = new Date(nowMs() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
}

/* Sunday exclusion (Asia/Dubai). Built at Dubai noon so the fixed +04:00 offset never crosses a UTC day boundary. */
function isSundayDubai(dateKey) {
  return new Date(dateKey + 'T12:00:00+04:00').getUTCDay() === 0;
}
/* Dubai wall-clock parts for a given ms (default: now). Used by the scheduler to know the
 * local hour/minute and today's date key without ambiguity. */
function dubaiParts(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms == null ? nowMs() : ms));
  const o = {}; for (const p of parts) o[p.type] = p.value;
  const h = o.hour === '24' ? 0 : +o.hour;
  return { key: o.year + '-' + o.month + '-' + o.day, h: h, mi: +o.minute, minutes: h * 60 + +o.minute };
}
function reportMinutes() { const [H, M] = REPORT_TIME.split(':').map(Number); return (H || 20) * 60 + (M || 0); }
/* Next occurrence of REPORT_TIME in Asia/Dubai from now — for the monitor's "next scheduled". */
function nextReportISO() {
  const dueMin = reportMinutes();
  for (let off = 0; off <= 1; off++) {
    const p = dubaiParts(nowMs() + off * 86400000);
    if (off === 0 && p.minutes >= dueMin) continue;           // today's slot already passed
    // Build the Dubai-local target time as a UTC instant. Dubai has no DST (fixed +04:00).
    return new Date(p.key + 'T' + REPORT_TIME.padStart(5, '0') + ':00+04:00').toISOString();
  }
  return null;
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
    status: r.payment || '', fileStatus: r.delivery || '', method: r.method || '', lead: r.lead || '', notes: r.notes || '', phone: r.phone || '',
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
    else if (/payment method/.test(k)) idx.method = n; else if (/lead source/.test(k)) idx.lead = n;
    else if (/lead outcome/.test(k)) idx.outcome = n; else if (/note/.test(k)) idx.notes = n;
  });
  const g = (row, f) => idx[f] != null ? String(row[idx[f]] == null ? '' : row[idx[f]]).trim() : '';
  const rows = grid.slice(1)
    .filter(row => rawanDateKey(g(row, 'date')) === dateKey)
    .map(row => ({
      ref: g(row, 'ref'), client: g(row, 'client'), service: g(row, 'service'), amount: rawanAmount(g(row, 'amount')),
      status: g(row, 'status'), fileStatus: g(row, 'fileStatus'), method: g(row, 'method'), lead: g(row, 'lead'), outcome: g(row, 'outcome'), notes: g(row, 'notes'), phone: g(row, 'phone'),
    }))
    .filter(o => o.client || (o.ref && o.ref !== '0') || o.service || o.amount || o.phone); // drop blank placeholder rows
  return { rows, connected: true };
}

/* ---------- report building (returns array of message chunks ≤ Telegram limit) ---------- */
function fileLine(i, r, withOutcome, tag) {
  const ref = r.ref && r.ref !== '0' ? '#' + esc(r.ref) : '—';
  let s = `${i}) 🕐— · <b>${ref}</b>\n`;
  s += `   ${esc(r.client || '—')}${r.service ? ' · ' + esc(r.service) : ''}\n`;
  s += `   <b>${AED(r.amount)}</b> · ${esc(cap(r.status))} · ${esc(cap(r.fileStatus))}`;
  if (withOutcome && r.outcome) s += ` · ${esc(cap(r.outcome))}`;
  if (tag) s += `  ${tag}`;
  if (r.notes) s += `\n   📝 ${esc(r.notes)}`;
  return s + '\n';
}
function empStats(list) {
  const clients = new Set(list.map(r => (r.client || '').trim().toLowerCase()).filter(Boolean)).size;
  const completed = list.filter(r => /deliver|complete|done|ready|closed|collected/i.test(r.fileStatus)).length;
  const pending = list.filter(r => /pending|progress|await|\bnew\b|process/i.test(r.fileStatus)).length;
  const revenue = list.reduce((a, r) => a + (isCancelled(r.status) ? 0 : r.amount), 0);
  return { files: list.length, clients, completed, pending, revenue };
}
function empStatusLine(m) { return !m.files ? 'No activity' : ('Active' + (m.pending ? ` · ${m.pending} pending` : ' · all done')); }
// Which Rawan files match a confirmed Sherry file (same ATS ref, client name, or phone) → "confirmed".
function rawanMatchesSherry(sherry) {
  const norm = x => String(x || '').trim().toLowerCase();
  const refKey = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const phoneKey = x => { const d = String(x || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; };
  const refs = new Set(), names = new Set(), phones = new Set();
  sherry.forEach(s => { const rf = refKey(s.ref); if (rf && rf !== '0') refs.add(rf); if (norm(s.client)) names.add(norm(s.client)); const ph = phoneKey(s.phone); if (ph) phones.add(ph); });
  return r => {
    const rf = refKey(r.ref); if (rf && rf !== '0' && refs.has(rf)) return true;
    if (norm(r.client) && names.has(norm(r.client))) return true;
    const ph = phoneKey(r.phone); if (ph && phones.has(ph)) return true;
    return false;
  };
}
function buildReport(dateKey, label, sherry, rawan, rawanConnected) {
  const SEP = '━━━━━━━━━━━━━━━━━━';
  const s = empStats(sherry), r = empStats(rawan);
  // office totals (clients de-duplicated across both staff so the same person isn't counted twice)
  const allClients = new Set([...sherry, ...rawan].map(x => (x.client || '').trim().toLowerCase()).filter(Boolean)).size;
  const tFiles = s.files + r.files, tCompleted = s.completed + r.completed, tPending = s.pending + r.pending, tRevenue = s.revenue + r.revenue;
  const hasActivity = tFiles > 0;
  // Rawan split: files matching a Sherry (confirmed) file vs the rest (inquiries / not agreed)
  const isMatched = rawanMatchesSherry(sherry);
  const rawanConfirmed = rawan.filter(isMatched), rawanPending = rawan.filter(x => !isMatched(x));
  // day + status (top summary reflects SHERRY only)
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey) || [];
  const d = dm.length ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : new Date();
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  const sherryStatus = s.files ? 'Working day' : (isWeekend ? 'Weekend — no Sherry activity' : 'No Sherry activity');
  // best performer by files (tiebreak revenue); N/A when idle
  const best = !hasActivity ? 'N/A' : (s.files > r.files ? 'Sherry' : r.files > s.files ? 'Rawan' : (s.revenue >= r.revenue ? 'Sherry' : 'Rawan'));
  // missing/incomplete records across both staff
  const both = [...sherry, ...rawan], miss = [];
  const nClient = both.filter(x => !(x.client || '').trim()).length;
  const nLead   = both.filter(x => !(x.lead || '').trim()).length;
  const nMethod = both.filter(x => !(x.method || '').trim() && !isCancelled(x.status)).length;
  if (nClient) miss.push(`${nClient} missing client name`);
  if (nLead)   miss.push(`${nLead} missing lead source`);
  if (nMethod) miss.push(`${nMethod} missing payment method`);
  const missSummary = miss.length ? miss.join(', ') : 'None';

  const fileList = (list, withOutcome, tag) => list.length
    ? list.map((x, i) => fileLine(i + 1, x, withOutcome, tag)).join('')
    : '<i>None.</i>\n';

  const report =
    `📅 <b>DAILY OFFICE REPORT</b>\n${esc(dayName)} • ${esc(dateStr)}\n${REPORT_TIME} Asia/Dubai\n` +
    // B) DAILY SUMMARY — SHERRY ONLY
    `${SEP}\n📌 <b>DAILY SUMMARY (Sherry)</b>\n` +
    `Status: ${esc(sherryStatus)}\nClients: ${s.clients}\nFiles: ${s.files}\nCompleted: ${s.completed}\nPending: ${s.pending}\nRevenue: ${AED(s.revenue)}\n` +
    // C) SHERRY confirmed/accepted files
    `${SEP}\n👩‍💼 <b>SHERRY — Confirmed / Accepted</b>  (${s.files} files · ${AED(s.revenue)})\n` +
    fileList(sherry, false, '') +
    // D) RAWAN — confirmed (matched in Sherry) first, then pending / not agreed
    `${SEP}\n👩‍💼 <b>RAWAN</b>\n` +
    (!rawanConnected ? '<i>Rawan feed not connected.</i>\n' :
      `\n✅ <b>Confirmed / Accepted</b> — matched in Sherry (${rawanConfirmed.length})\n` +
      fileList(rawanConfirmed, true, '✅ <i>Confirmed / Accepted</i>') +
      `\n🟡 <b>Pending / Not Agreed</b> — inquiries, not confirmed business (${rawanPending.length})\n` +
      fileList(rawanPending, true, '🟡 <i>Pending / Not Agreed</i>')
    ) +
    // E) TOTAL DAILY OFFICE — full combined
    `${SEP}\n🏢 <b>TOTAL DAILY OFFICE</b>\n` +
    `Total Clients: ${allClients}\nTotal Files: ${tFiles}\nCompleted: ${tCompleted}\nPending: ${tPending}\nRevenue: ${AED(tRevenue)}\n` +
    `Rawan confirmed: ${rawanConfirmed.length} · Rawan pending/not agreed: ${rawanPending.length}\n` +
    `Best Performer: ${esc(best)}\nMissing Data: ${esc(missSummary)}\n` +
    // Reminders
    `${SEP}\n🔔 <b>IMPORTANT REMINDERS</b>\n` +
    `• Check pending payments\n• Follow up unfinished files\n• Make sure Lead Source is filled\n• Make sure Payment Method is filled\n• Review tomorrow's work\n` +
    (hasActivity ? `✅ Scheduler running — report delivered automatically at ${REPORT_TIME}.`
                 : `✅ No business activity recorded today — scheduler test successful.`);

  if (report.length <= 4000) return [report];
  const chunks = []; let cur = '';
  for (const line of report.split('\n')) {
    if ((cur + line + '\n').length > 4000) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/* ---------- Telegram API ----------
 * BOT_FAKE_SEND (test-only, never set in production):
 *   'ok'   → simulate a successful send (returns a fake message_id) without touching Telegram
 *   'fail' → simulate a transient Telegram error, to exercise retry/backoff/queue/cutoff
 * When unset, the real Telegram HTTP API is called. */
const FAKE_SEND = (process.env.BOT_FAKE_SEND || '').trim().toLowerCase();
let _fakeMsgId = 1000;
async function tg(method, params) {
  if (FAKE_SEND) {
    if (FAKE_SEND === 'fail' && method === 'sendMessage') throw new Error('sendMessage → [FAKE] 429: Too Many Requests');
    return { ok: true, result: { message_id: ++_fakeMsgId } };
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await res.json().catch(() => ({ ok: false, description: 'non-JSON response' }));
  if (!j.ok) { const err = new Error(method + ' → ' + (j.description || res.status)); err.telegram = j; err.httpStatus = res.status; throw err; }
  return j;
}
/* Sends every chunk; a report is "delivered" only when Telegram confirms ok + a message_id for
 * each chunk (requirement #3). Returns the message_ids as proof of delivery. */
async function sendChunks(chatId, chunks) {
  const ids = [];
  for (const c of chunks) {
    const j = await tg('sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true });
    const id = j && j.result && j.result.message_id;
    if (!id) throw new Error('sendMessage returned ok but no message_id — delivery unconfirmed');
    ids.push(id);
  }
  return ids;
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
    const out = await deliverReport(dateKey, label, target);
    const detail = out.mode === 'text' ? ` · ${out.chunks} msg(s)` : out.pages ? ' · ' + out.pages.map(p => 'p' + p.page + ' ' + p.width + 'x' + p.height).join(', ') : '';
    log(`SENT ${label} (${dateKey}) → chat ${target} · mode ${out.mode}${detail}`);
  } catch (e) {
    log(`SEND FAILED ${label} (${dateKey}) → chat ${target}: ${e.message}`);
    try { if (TOKEN && target) await tg('sendMessage', { chat_id: target, text: '⚠️ Daily report failed: ' + e.message }); } catch (_) {}
  }
}

/* ---------- image report path (DAILY_REPORT_MODE = png | dry-run) ---------- */
const ARCHIVE_DIR = path.join(__dirname, 'archive');
async function makeReportImage(dateKey) {
  const ri = require('./report-image');                        // lazy — text mode never loads sharp
  let sherry = [], rawanRes = { rows: [] };
  try { sherry = await getSherry(dateKey); } catch (e) { log('SHEET ERROR (Sherry/' + dateKey + '): ' + e.message); throw e; }
  try { rawanRes = await getRawan(dateKey); } catch (e) { log('SHEET ERROR (Rawan/' + dateKey + '): ' + e.message); }
  const model = ri.computeModel(dateKey, sherry, rawanRes.rows);
  try { fs.mkdirSync(ARCHIVE_DIR, { recursive: true }); } catch (_) {}
  const pages = await ri.renderReportPages(model, ARCHIVE_DIR, dateKey);   // [{page,path,width,height,size,renderer,logoOk}, ...]
  return { sherry, rawan: rawanRes.rows, model, pages };
}
// Upload a PNG via multipart. sendPhoto by default; sendDocument when it exceeds Telegram's
// photo limits (or on a photo-side rejection) — content is NEVER trimmed to fit.
async function tgUpload(method, chatId, buf, caption) {
  if (FAKE_SEND) { if (FAKE_SEND === 'fail') throw new Error(method + ' → [FAKE] 429: Too Many Requests'); return { messageId: ++_fakeMsgId, method }; }
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption) fd.append('caption', caption);
  fd.append(method === 'sendPhoto' ? 'photo' : 'document', new Blob([buf], { type: 'image/png' }), 'Daily_Report.png');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({ ok: false, description: 'non-JSON response' }));
  if (!j.ok) { const err = new Error(method + ' → ' + (j.description || res.status)); err.telegram = j; throw err; }
  const id = j.result && j.result.message_id; if (!id) throw new Error(method + ' returned ok but no message_id');
  return { messageId: id, method };
}
async function sendImage(chatId, png, caption) {
  const buf = fs.readFileSync(png.path);
  const ratio = Math.max(png.width, png.height) / Math.max(1, Math.min(png.width, png.height));
  // Telegram photo limits: ≤10 MB, width+height ≤10000, ratio ≤20 → otherwise document.
  const mustDoc = (png.width + png.height > 10000) || (buf.length > 10 * 1024 * 1024) || (ratio > 20);
  const first = mustDoc ? 'sendDocument' : 'sendPhoto';
  try { const r = await tgUpload(first, chatId, buf, caption); return { messageIds: [r.messageId], method: r.method }; }
  catch (e) {
    if (first === 'sendPhoto') { logEvent('photo_fallback_document', { reason: e.message }); const r = await tgUpload('sendDocument', chatId, buf, caption); return { messageIds: [r.messageId], method: r.method }; }
    throw e;
  }
}
// Single delivery entry-point honouring DAILY_REPORT_MODE. Returns { mode, messageIds, ... }.
async function deliverReport(dateKey, label, chatId) {
  if (REPORT_MODE === 'text') {
    const { chunks, sherryN, rawanN } = await makeReport(dateKey, label);
    const messageIds = await sendChunks(chatId, chunks);
    return { mode: 'text', messageIds, sherryN, rawanN, chunks: chunks.length };
  }
  const { model, pages } = await makeReportImage(dateKey);
  if (REPORT_MODE === 'dry-run') {
    pages.forEach(p => logEvent('dry_run_image', { day: dateKey, page: p.page, path: p.path, width: p.width, height: p.height, size: p.size, renderer: p.renderer }));
    return { mode: 'dry-run', messageIds: [], pages, model };
  }
  // png mode: send BOTH pages (Operations, then Follow-up). Content is never merged/trimmed.
  const titles = { 1: 'Daily Operations', 2: 'Follow-up & Sales' };
  const messageIds = [], methods = [];
  for (const p of pages) {
    const caption = 'Daily Office Report — ' + model.dateStr + ' · Page ' + p.page + '/' + pages.length + ' · ' + (titles[p.page] || '');
    const sent = await sendImage(chatId, p, caption);
    messageIds.push(...sent.messageIds); methods.push(sent.method);
    logEvent('image_sent', { day: dateKey, page: p.page, method: sent.method, messageIds: sent.messageIds, width: p.width, height: p.height, size: p.size });
  }
  return { mode: 'png', messageIds, pages, model, method: methods.join('+') };
}

/* ============================================================================
 * PRODUCTION RELIABILITY ENGINE
 * ----------------------------------------------------------------------------
 * Timing is driven by an EXTERNAL cPanel cron job (`--tick` every 5 min), so it
 * survives Passenger reaping the Node worker. The persistent app runs the SAME
 * tick on a short interval as a redundant backup. Every tick is idempotent and
 * self-healing; the durable state.json is the queue + the monitor.
 * ========================================================================== */

const MAX_RETRY_MIN = Math.max(30, +(process.env.BOT_MAX_RETRY_MIN || 210)); // keep retrying a failing send for this long (from first attempt) before giving up + alerting
const CATCHUP_MAX_LATE_MIN = Math.max(60, +(process.env.BOT_CATCHUP_MAX_LATE_MIN || 300)); // don't START a report more than this late (avoids stale/fresh-install retroactive sends)
const STALE_LOCK_MS = Math.max(60000, +(process.env.BOT_STALE_LOCK_MS || 600000)); // reclaim a lock from a crashed tick after 10 min
const RETRY_BACKOFF_MS = [0, 3000, 9000]; // in-tick exponential backoff between attempts

/* ---------- per-day lock (O_EXCL) — one sender per day across cron + all Passenger workers ---------- */
function markerPath(dateKey) { return path.join(__dirname, '.sent-' + dateKey); }
function acquireLock(dateKey) {
  try { const fd = fs.openSync(markerPath(dateKey), 'wx'); fs.writeSync(fd, nowISO() + ' pid=' + process.pid + '\n'); fs.closeSync(fd); return true; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Lock exists. If it's stale (a previous tick crashed mid-send), reclaim it; else another tick owns it now.
    try {
      const ageMs = nowMs() - fs.statSync(markerPath(dateKey)).mtimeMs;
      if (ageMs > STALE_LOCK_MS) { fs.unlinkSync(markerPath(dateKey)); logEvent('lock_reclaimed', { day: dateKey, ageMs: Math.round(ageMs) }); return acquireLock(dateKey); }
    } catch (_) {}
    return false;
  }
}
function releaseLock(dateKey) { try { fs.unlinkSync(markerPath(dateKey)); } catch (_) {} }
function cleanOldMarkers() {
  const cutoff = dayKeyDubai(-10);
  try { for (const f of fs.readdirSync(__dirname)) { const m = /^\.sent-(\d{4}-\d{2}-\d{2})$/.exec(f); if (m && m[1] < cutoff) { try { fs.unlinkSync(path.join(__dirname, f)); } catch (_) {} } } } catch (_) {}
}

/* ---------- operator alert (best-effort, but never silent — always logged) ---------- */
async function alertOperator(text) {
  logEvent('operator_alert', { text: text });
  try { if ((TOKEN || FAKE_SEND) && CHAT_ID) await tg('sendMessage', { chat_id: CHAT_ID, text: '⚠️ ' + text, disable_web_page_preview: true }); }
  catch (e) { log('OPERATOR ALERT SEND FAILED: ' + e.message); }
}

/* ---------- send with in-tick exponential backoff + delivery verification ---------- */
async function sendWithRetry(dateKey, label) {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt++) {
    if (RETRY_BACKOFF_MS[attempt]) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    try {
      logEvent('generate_start', { day: dateKey, attempt: attempt + 1, mode: REPORT_MODE });
      logEvent('send_start', { day: dateKey, attempt: attempt + 1, chat: String(CHAT_ID), mode: REPORT_MODE });
      const out = await deliverReport(dateKey, label, CHAT_ID);
      logEvent('telegram_response', { day: dateKey, ok: true, mode: out.mode, messageIds: out.messageIds });
      return { messageIds: out.messageIds, mode: out.mode, pages: out.pages };
    } catch (e) {
      lastErr = e;
      logEvent('retry', { day: dateKey, attempt: attempt + 1, of: RETRY_BACKOFF_MS.length, error: e.message });
    }
  }
  throw lastErr;
}

/* ---------- the idempotent, self-healing daily tick (the heart of the system) ----------
 * Called by cron (--tick), by the persistent backup interval, and once at process start.
 * "Due" day = today once now ≥ REPORT_TIME, otherwise yesterday (so a server that was down at
 * 20:00 and returns later still sends the missed report — requirement #5). A day already in
 * lastSuccess (delivered) or lastFailure (permanently given up + alerted) is skipped. */
async function tickOnce(reason) {
  logEvent('tick_start', { reason: reason || 'manual' });
  cleanOldMarkers();
  const st = readState();
  st.lastTickAt = nowISO();

  const p = dubaiParts();
  const dueMin = reportMinutes();
  const candidate = (p.minutes >= dueMin) ? p.key : dayKeyDubai(-1);
  // minutes elapsed since the candidate day's REPORT_TIME (handles the "yesterday" wrap)
  const minsSinceDue = (candidate === p.key) ? (p.minutes - dueMin) : (p.minutes + (1440 - dueMin));
  const hasPending = !!(st.pending && st.pending.date === candidate);

  if (st.lastSuccess && st.lastSuccess.date === candidate) { logEvent('skip_already_sent', { day: candidate }); writeState(st); return { status: 'already_sent', day: candidate }; }
  if (st.lastFailure && st.lastFailure.date === candidate) { logEvent('skip_given_up', { day: candidate }); writeState(st); return { status: 'given_up', day: candidate }; }
  if (isSundayDubai(candidate)) { log('Sunday holiday — daily office report skipped.'); logEvent('skip_sunday', { day: candidate }); writeState(st); return { status: 'skipped_sunday', day: candidate }; }
  if (minsSinceDue < 0)                                    { logEvent('skip_not_due', { day: candidate, nextAt: nextReportISO() }); writeState(st); return { status: 'not_due', day: candidate }; }
  // Stale guard: never START a report far past its slot unless we're already mid-retry on it.
  // Prevents a fresh install (empty state) or a next-morning restart from sending a stale report.
  if (!hasPending && minsSinceDue > CATCHUP_MAX_LATE_MIN) { logEvent('skip_too_late', { day: candidate, minsSinceDue: Math.round(minsSinceDue), nextAt: nextReportISO() }); writeState(st); return { status: 'too_late', day: candidate }; }

  const isCatchUp = candidate !== p.key || minsSinceDue > 6; // late relative to the exact slot → recovery of a missed run
  if (isCatchUp) logEvent('recovery', { day: candidate, minsSinceDue: Math.round(minsSinceDue), reason: reason || 'manual' });
  else           logEvent('due_detected', { day: candidate, minsSinceDue: Math.round(minsSinceDue) });

  if (!acquireLock(candidate)) { logEvent('skip_locked', { day: candidate }); writeState(st); return { status: 'locked', day: candidate }; }

  const firstTriedAt = (hasPending && st.pending.firstTriedAt) || nowISO();
  const attemptWindowMin = (nowMs() - Date.parse(firstTriedAt)) / 60000;
  const attempts = ((hasPending && st.pending.attempts) || 0) + 1;
  try {
    const r = await sendWithRetry(candidate, isCatchUp ? 'Missed report' : 'Today');
    st.lastSuccess = { date: candidate, at: nowISO(), messageIds: r.messageIds, sherryN: r.sherryN, rawanN: r.rawanN };
    st.lastTelegram = { at: nowISO(), ok: true, description: 'delivered ' + r.messageIds.length + ' message(s)' };
    st.pending = null;
    writeState(st);
    logEvent('delivered', { day: candidate, messageIds: r.messageIds, attempts, catchUp: isCatchUp });
    return { status: 'delivered', day: candidate, messageIds: r.messageIds };
  } catch (e) {
    releaseLock(candidate); // let the next tick retry
    st.lastTelegram = { at: nowISO(), ok: false, description: e.message };
    st.pending = { date: candidate, attempts, firstTriedAt: firstTriedAt, lastTriedAt: nowISO(), lastError: e.message };
    if (attemptWindowMin > MAX_RETRY_MIN) {
      // We've been retrying since firstTriedAt for longer than the give-up window — stop, record the
      // permanent failure, and alert the operator (once). Retrying restarts fresh only on a new day.
      st.lastFailure = { date: candidate, at: nowISO(), attempts, error: e.message };
      st.pending = null;
      writeState(st);
      logEvent('permanent_failure', { day: candidate, attempts, error: e.message, retriedForMin: Math.round(attemptWindowMin) });
      await alertOperator(`Daily report ${candidate} FAILED permanently after ${attempts} attempts over ${Math.round(attemptWindowMin)} min. Last error: ${e.message}`);
      return { status: 'permanent_failure', day: candidate };
    }
    writeState(st);
    logEvent('queued', { day: candidate, attempts, error: e.message, willRetry: true });
    return { status: 'queued', day: candidate, attempts, error: e.message };
  }
}

/* ---------- persistent-mode backup: run the same tick on a short interval + once at start ---------- */
function startBackupScheduler() {
  const intervalMs = Math.max(60000, +(process.env.BOT_TICK_INTERVAL_MS || 300000)); // default 5 min
  log(`Backup scheduler active: tick every ${(intervalMs / 60000).toFixed(0)} min. Report time ${REPORT_TIME} ${TZ}. Next slot ${nextReportISO()}.`);
  tickOnce('startup').catch(e => log('startup tick error: ' + e.message));                 // catch-up immediately on (re)start
  setInterval(() => { tickOnce('interval').catch(e => log('interval tick error: ' + e.message)); }, intervalMs);
}

/* ---------- monitoring snapshot (for --status and the dashboard endpoint) ---------- */
function healthSnapshot() {
  const st = readState();
  return {
    now: nowISO(), timezone: TZ, reportTime: REPORT_TIME,
    nextScheduled: nextReportISO(),
    lastSuccess: st.lastSuccess || null,
    pending: st.pending || null,
    lastFailure: st.lastFailure || null,
    lastTelegram: st.lastTelegram || null,
    lastTickAt: st.lastTickAt || null,
    startedAt: st.startedAt || null,
    retryCount: (st.pending && st.pending.attempts) || 0,
    queueLength: st.pending ? 1 : 0,
    lastException: (st.lastTelegram && !st.lastTelegram.ok && st.lastTelegram.description) || (st.pending && st.pending.lastError) || null,
  };
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
  // Optional: --date YYYY-MM-DD to preview any specific day.
  if (has('--dry')) {
    const di = args.indexOf('--date');
    let dk, lbl;
    if (di >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(args[di + 1] || '')) { dk = args[di + 1]; lbl = dk; }
    else { const which = args.includes('--yesterday') || args[args.indexOf('--dry') + 1] === 'yesterday' ? -1 : 0; dk = dayKeyDubai(which); lbl = which ? 'Yesterday' : 'Today'; }
    const { chunks, sherryN, rawanN } = await makeReport(dk, lbl);
    console.log('\n----- DRY REPORT ' + dk + ' (Sherry ' + sherryN + ', Rawan ' + rawanN + ') -----\n');
    console.log(chunks.join('\n----- (next message) -----\n').replace(/<\/?[^>]+>/g, '')); // strip HTML tags for console
    process.exit(0);
  }

  // Monitoring snapshot — prints the health state as JSON (no Telegram token needed).
  if (has('--status')) { console.log(JSON.stringify(healthSnapshot(), null, 2)); process.exit(0); }

  if (REPORT_MODE !== 'dry-run' && (!TOKEN || !CHAT_ID)) { log('FATAL: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or use --dry, or DAILY_REPORT_MODE=dry-run).'); process.exit(1); }

  // PRIMARY TRIGGER — run one idempotent, self-healing tick, then exit. This is what cPanel cron
  // calls every ~5 min. Sends the daily report once REPORT_TIME has passed (and catches up a missed
  // day), verifies delivery, retries with backoff, queues on failure, and never double-sends.
  if (has('--tick')) { const r = await tickOnce('cron'); process.exit(r && (r.status === 'permanent_failure') ? 2 : 0); }

  // One-shot modes (manual / legacy cron): send a specific day's report immediately, no dedup/state.
    if (has('--today')) {
    const dk = dayKeyDubai(0);
    if (isSundayDubai(dk) && !has('--force')) { log('Sunday holiday — daily office report skipped.'); logEvent('skip_sunday', { day: dk, trigger: '--today' }); process.exit(0); }
    await sendReport(dk, 'Today', CHAT_ID); process.exit(0);
  }
  if (has('--yesterday')) { await sendReport(dayKeyDubai(-1), 'Yesterday', CHAT_ID); process.exit(0); }

  // Manual one-shot for a specific day: --send --date YYYY-MM-DD (sends that day's report once).
  if (has('--send')) {
    const si = args.indexOf('--date');
    const sd = args[si + 1] || '';
    if (si < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      log('FATAL: --send requires --date YYYY-MM-DD (e.g. node telegram-report.js --send --date 2026-07-04).');
      process.exit(1);
    }
    await sendReport(sd, sd, CHAT_ID);
    process.exit(0);
  }

  // Persistent mode: BACKUP scheduler. cPanel cron (`--tick`) is the PRIMARY trigger; this always-on
  // app is a redundant safety net that runs the same idempotent tick on a short interval and catches
  // up immediately on (re)start. Running both is safe — the per-day O_EXCL lock + state.json ensure
  // the report is sent exactly once. Passenger keeps a Node app alive only while it holds its PORT,
  // so bind a tiny health endpoint that also exposes the live monitor JSON at /health.
  if (process.env.PORT) {
    try {
      require('http').createServer((req, res) => {
        if (req.url && req.url.indexOf('/health') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(healthSnapshot())); return; }
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ats-bot ok');
      }).listen(process.env.PORT, () => log('health server on port ' + process.env.PORT + ' (JSON at /health)'));
    } catch (e) { log('health server error: ' + e.message); }
  }
  try { const st = readState(); st.startedAt = nowISO(); writeState(st); } catch (_) {}
  log('ALMUTARJEM Telegram bot started (persistent BACKUP scheduler; cron is primary). Report time ' + REPORT_TIME + ' ' + TZ + ' · pid ' + process.pid + '.');
  startBackupScheduler();

  // Command polling is DISABLED by default. Under Passenger (multi-worker), each worker would open
  // its own getUpdates poll and Telegram allows only ONE → "Conflict: terminated by other getUpdates".
  // Send-only needs no polling. Opt-in is available ONLY for a single-instance deployment.
  if (process.env.BOT_ENABLE_COMMANDS === 'true') {
    log('WARNING: BOT_ENABLE_COMMANDS=true — command polling enabled. SAFE ONLY as a single instance, NOT under multi-worker Passenger.');
    pollCommands();
  } else {
    log('Command polling disabled (send-only). No getUpdates — Passenger multi-worker safe.');
  }
})();
