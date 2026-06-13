'use strict';
/**
 * ALMUTARJEM Translation Services — Executive Control Center (standalone server).
 *
 * PRIMARY data source: the live Google Sheet (read via the public gviz endpoint).
 * FALLBACK: the in-project Excel workbook copy (data/source.xlsx), used ONLY when
 * the Google Sheet is unavailable (e.g. not shared publicly). No demo data ever.
 *
 *   GET  /api/data?from&to&service&lead    -> KPIs/charts/tables for that filter
 *   GET  /api/export?from&to&service&lead   -> filtered transactions as CSV
 *   GET  /api/health
 *   POST /api/upload?type=...               -> replace fallback workbook / tab
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { fetchSheet, fetchSheetOptional } = require('./lib/sheets');
const { readUploaded, DATA_DIR } = require('./lib/excel');
const { parseAll, analyze } = require('./lib/compute');
const auditFx = require('./lib/audit');

(function loadEnv() {
  try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  } catch (_) {}
})();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const PORT = +(process.env.PORT || 5050);
const T_NAME = process.env.SHEET_TRANSACTIONS || 'Transactions';
const E_NAME = process.env.SHEET_EXPENSES || 'Expenses';
const S_NAME = process.env.SHEET_SETTINGS || 'Settings';
const TTL = 30 * 1000;
// Excel is EMERGENCY-ONLY backup, never the active dashboard source unless explicitly enabled.
const EXCEL_EMERGENCY = String(process.env.EXCEL_EMERGENCY_FALLBACK || 'false').toLowerCase() === 'true';

let cache = { at: 0, parsed: null, source: null, sourceMeta: null, mtime: null };
let sheetStatus = { state: 'unknown', checkedAt: null, message: 'Not checked yet' };
let lastSuccessfulSync = null;
let lastSig = null;
let forensicSrc = null; // tracks source for forensic connection-transition events
const syncLog = [];

function log() { console.log('[' + new Date().toISOString() + ']', ...arguments); }
function audit(status, event, details) {
  syncLog.unshift({ ts: new Date().toISOString(), status, event, details });
  if (syncLog.length > 100) syncLog.pop();
}
function signature(p) { return p.meta.totalRecords + ':' + p.records.reduce((a, r) => a + r.amount, 0).toFixed(2) + ':' + p.meta.maxDate; }

async function loadParsed(force) {
  if (!force && cache.parsed && (Date.now() - cache.at) < TTL) return cache;

  // PRIMARY AND ONLY ACTIVE SOURCE — live Google Sheet
  let reason = '';
  try {
    const trans = await fetchSheet(SPREADSHEET_ID, T_NAME);
    if (trans && trans.rows.length) {
      const exp = await fetchSheetOptional(SPREADSHEET_ID, E_NAME) || { headers: [], rows: [] };
      const settings = await fetchSheetOptional(SPREADSHEET_ID, S_NAME);
      const parsed = parseAll(trans, exp, settings, new Date());
      const sig = signature(parsed);
      // FORENSIC DIFF: compare persisted previous snapshot vs new dataset → field-level change log
      try {
        const prevSnap = auditFx.loadSnapshot();
        if (prevSnap === null) {
          auditFx.logSystem('INFO', 'Audit baseline captured', `Baseline of ${parsed.meta.totalRecords} transactions recorded; future changes will be tracked field-by-field.`);
          auditFx.saveSnapshot(parsed.records);
        } else {
          // always diff the persisted previous snapshot against the live dataset (no-op if identical)
          const diff = auditFx.diffRecords(prevSnap, parsed.records, new Date().toISOString());
          if (diff.changes.length) {
            auditFx.recordChanges(diff.changes);
            auditFx.logSystem(diff.deleted ? 'CRITICAL' : 'INFO', 'Sheet change detected',
              `${diff.created} added · ${diff.updated} modified · ${diff.deleted} deleted`);
            audit('ok', 'Changes detected', `${diff.created} added, ${diff.updated} modified, ${diff.deleted} deleted`);
            auditFx.saveSnapshot(parsed.records);
          }
        }
      } catch (de) { log('diff error', de.message); }
      if (lastSig && sig !== lastSig) audit('ok', 'Google Sheet updated', `Change detected — now ${parsed.meta.totalRecords} transactions (latest ${parsed.meta.maxDate})`);
      lastSig = sig;
      lastSuccessfulSync = new Date().toISOString();
      sheetStatus = { state: 'live', checkedAt: lastSuccessfulSync, message: `Connected — ${parsed.meta.totalRecords} transactions live from Google Sheet` };
      cache = { at: Date.now(), parsed, source: 'live', sourceMeta: { workbook: 'Google Sheet (live)', tabs: [T_NAME, E_NAME, S_NAME] }, mtime: null, error: null };
      audit('ok', 'Synced from Google Sheet', `${parsed.meta.totalRecords} transactions, ${parsed.meta.expenseRecords} expenses`);
      if (forensicSrc === 'error') auditFx.logSystem('INFO', 'Connection recovered', 'Google Sheet reconnected — LIVE GOOGLE SHEET');
      forensicSrc = 'live';
      log('Source = LIVE Google Sheet', parsed.meta.totalRecords, 'rows');
      return cache;
    }
    reason = 'Google Sheet reachable but returned no rows in tab "' + T_NAME + '".';
    sheetStatus = { state: 'empty', checkedAt: new Date().toISOString(), message: reason };
  } catch (e) {
    reason = 'Cannot connect to the Google Sheet (gviz ' + (e.httpStatus || e.code || 'blocked') + '). It must be shared "Anyone with the link → Viewer". The dashboard is NOT showing data until the Sheet is reachable.';
    sheetStatus = { state: 'private', checkedAt: new Date().toISOString(), message: reason };
  }

  // EMERGENCY-ONLY Excel backup (off by default; never used for normal display)
  if (EXCEL_EMERGENCY) {
    const up = readUploaded();
    if (up && up.transactions && up.transactions.rows.length) {
      const parsed = parseAll(up.transactions, up.expenses, up.settings, new Date());
      lastSuccessfulSync = new Date().toISOString();
      cache = { at: Date.now(), parsed, source: 'file', sourceMeta: up.source, mtime: up.mtime, file: up.file, error: null };
      audit('warning', 'EMERGENCY Excel backup in use', `Google Sheet unavailable — read ${up.source.workbook} (manual emergency mode is ON)`);
      log('Source = FILE (emergency)', up.source.workbook, parsed.meta.totalRecords, 'rows');
      return cache;
    }
  }

  // ERROR — do NOT silently serve old Excel data
  audit('error', 'Google Sheet not connected', reason);
  if (forensicSrc && forensicSrc !== 'error') auditFx.logSystem('CRITICAL', 'Connection lost', reason);
  forensicSrc = 'error';
  cache = { at: Date.now(), parsed: parseAll({ headers: [], rows: [] }, null, null, new Date()), source: 'error', sourceMeta: null, mtime: null, error: reason };
  return cache;
}

function sourceLabel(src) {
  return src === 'live' ? 'LIVE GOOGLE SHEET' : src === 'file' ? 'EXCEL EMERGENCY BACKUP' : src === 'error' ? 'GOOGLE SHEET NOT CONNECTED' : 'NO DATA SOURCE';
}

const app = express();

// Cache-busting: version assets per server start + force browsers to revalidate.
// Prevents stale app.js/styles.css (old banner logic) from lingering in the browser.
const ASSET_VER = Date.now();
function sendIndex(_req, res) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html.replace('href="styles.css"', `href="styles.css?v=${ASSET_VER}"`)
             .replace('src="app.js"', `src="app.js?v=${ASSET_VER}"`);
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('html').send(html);
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (/\.(js|css|html)$/.test(p)) res.set('Cache-Control', 'no-cache, must-revalidate'); },
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, DATA_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase();
      const type = (req.query.type || 'source').toLowerCase();
      const base = ['transactions', 'expenses', 'settings'].includes(type) ? type : 'source';
      cb(null, base + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Forensic audit history — full field-level change log (newest first).
app.get('/api/audit', (_req, res) => {
  const changes = auditFx.loadHistory();
  res.json({ changes: changes.slice(0, 3000), total: changes.length, generatedAt: new Date().toISOString() });
});

app.get('/api/data', async (req, res) => {
  try {
    const c = await loadParsed(req.query.fresh === '1');
    const p = c.parsed;
    const filter = { from: req.query.from || '', to: req.query.to || '', service: req.query.service || 'All', lead: req.query.lead || 'All' };
    const view = analyze(p, filter);
    const allTime = analyze(p, {});
    res.json({
      source: c.source,
      meta: {
        ...p.meta,
        source: c.source, sourceLabel: sourceLabel(c.source), sourceMeta: c.sourceMeta, mtime: c.mtime,
        error: c.error || null, emergencyFallback: EXCEL_EMERGENCY,
        lastSync: lastSuccessfulSync ? lastSuccessfulSync : null, fetchedAt: new Date().toISOString(),
        todayDubai: p.today, sheetStatus, spreadsheetId: SPREADSHEET_ID,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit',
      },
      view,
      allTime: { kpis: allTime.kpis, revenueTrend: allTime.revenueTrend },
      audit: syncLog.concat(p.audit).slice(0, 160),
      validation: p.validation,
    });
  } catch (e) {
    log('FATAL /api/data', e.stack || e.message);
    audit('error', 'Compute error', e.message);
    res.status(500).json({ error: 'COMPUTE_ERROR', message: e.message });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const c = await loadParsed(false);
    const filter = { from: req.query.from || '', to: req.query.to || '', service: req.query.service || 'All', lead: req.query.lead || 'All' };
    const view = analyze(c.parsed, filter);
    const cols = ['date', 'client', 'service', 'ref', 'amount', 'method', 'status', 'delivery', 'lead'];
    const head = cols.join(',');
    const lines = c.parsed.records
      .filter(r => r.dateKey >= view.filter.from && r.dateKey <= view.filter.to
        && (view.filter.service === 'All' || r.service === view.filter.service)
        && (view.filter.lead === 'All' || r.lead === view.filter.lead))
      .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
      .map(r => [r.dateKey, r.client, r.service, r.ref, r.amount, r.method, r.payment, r.delivery, r.lead]
        .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(','));
    audit('info', 'Export generated', `CSV export — ${lines.length} rows (${view.filter.from}…${view.filter.to})`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ALMUTARJEM_transactions_${view.filter.from}_${view.filter.to}.csv"`);
    res.send('﻿' + [head].concat(lines).join('\r\n'));
  } catch (e) { res.status(500).send('export error: ' + e.message); }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  cache = { at: 0, parsed: null };
  audit('ok', 'File uploaded', `New ${req.query.type || 'source'} fallback file: ${req.file && req.file.filename}`);
  log('Uploaded', req.file && req.file.filename);
  res.json({ ok: true, saved: req.file ? req.file.filename : null });
});

app.listen(PORT, () => {
  log('ALMUTARJEM dashboard on http://localhost:' + PORT + ' | spreadsheet ' + SPREADSHEET_ID);
  audit('ok', 'Server started', `Dashboard listening on port ${PORT}`);
  loadParsed(true);
  // auto-refresh from the primary source every 60s (detects Google Sheet updates)
  setInterval(() => loadParsed(true).catch(() => {}), 60 * 1000);
});
