'use strict';
/**
 * Reads the ALMUTARJEM Business Control workbook (the Google Sheet exported /
 * saved as .xlsx inside the project) and returns each tab as { headers, rows }.
 *
 * The real spreadsheet is ONE workbook with several named tabs
 * (Transactions, Expenses, Settings, …) — not three separate files — so we read
 * the named sheets directly. Single-file uploads (transactions.xlsx etc.) are
 * still honoured for backwards compatibility.
 *
 * Source priority:
 *   1. data/source.xlsx                (canonical copy of the Google Sheet)
 *   2. "ALMUTARJEM Business Control Sheet.xlsx" in the project root
 *   3. data/transactions.* + data/expenses.* (legacy single-tab uploads)
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const EXTS = ['xlsx', 'xls', 'csv'];

const WORKBOOK_CANDIDATES = [
  process.env.SOURCE_WORKBOOK && path.resolve(ROOT, process.env.SOURCE_WORKBOOK),
  path.join(DATA_DIR, 'source.xlsx'),
  path.join(ROOT, 'ALMUTARJEM Business Control Sheet.xlsx'),
].filter(Boolean);

function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// SheetJS converts Excel serial dates to JS Dates with a small precision error
// (e.g. 2026-05-01 comes back as 2026-04-30T19:59:48Z), which shifts the day by
// one in +UTC timezones. Snap every Date cell to the nearest calendar day and
// rebuild it as a clean LOCAL-midnight date so day/month bucketing is exact.
function normDateCell(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return v;
  const r = new Date(Math.round(v.getTime() / 86400000) * 86400000); // nearest UTC midnight
  return new Date(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate());
}

/** Convert one worksheet to { headers, rows }. headerRow lets us skip banner rows. */
function sheetToTable(ws) {
  let arr = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!arr.length) return { headers: [], rows: [] };
  arr = arr.map(row => Array.isArray(row) ? row.map(normDateCell) : row);
  // The real header is the first row that has several non-empty text cells.
  let hIdx = 0;
  for (let i = 0; i < Math.min(arr.length, 8); i++) {
    const cells = (arr[i] || []).filter(v => v != null && String(v).trim() !== '');
    const textCells = (arr[i] || []).filter(v => typeof v === 'string' && String(v).trim() !== '');
    if (cells.length >= 3 && textCells.length >= 3) { hIdx = i; break; }
  }
  const headers = (arr[hIdx] || []).map(h => String(h == null ? '' : h).trim());
  const rows = arr.slice(hIdx + 1);
  return { headers, rows };
}

function pickSheet(wb, keywords) {
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (keywords.some(k => n === k)) return wb.Sheets[name];
  }
  for (const name of wb.SheetNames) {
    const n = norm(name);
    if (keywords.some(k => n.includes(k))) return wb.Sheets[name];
  }
  return null;
}

function readWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const tWs = pickSheet(wb, ['transactions', 'transaction', 'orders', 'sales']);
  if (!tWs) return null; // not the business workbook
  const eWs = pickSheet(wb, ['expenses', 'expense', 'costs']);
  const sWs = pickSheet(wb, ['settings', 'lists', 'config']);
  return {
    transactions: sheetToTable(tWs),
    expenses: eWs ? sheetToTable(eWs) : { headers: [], rows: [] },
    settings: sWs ? sheetToTable(sWs) : null,
    source: { workbook: path.basename(filePath), tabs: wb.SheetNames },
  };
}

/* ---- legacy single-file uploads (data/transactions.xlsx etc.) ---- */
function findFile(base) {
  for (const ext of EXTS) {
    const p = path.join(DATA_DIR, base + '.' + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function readFileTable(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  return sheetToTable(wb.Sheets[wb.SheetNames[0]]);
}
function readSeparateUploads() {
  const tPath = findFile('transactions');
  if (!tPath) return null;
  const ePath = findFile('expenses');
  const sPath = findFile('settings');
  return {
    transactions: readFileTable(tPath),
    expenses: ePath ? readFileTable(ePath) : { headers: [], rows: [] },
    settings: sPath ? readFileTable(sPath) : null,
    source: { workbook: path.basename(tPath), tabs: ['(single file)'] },
  };
}

/** Returns { transactions, expenses, settings, source, file } or null. */
function readUploaded() {
  for (const p of WORKBOOK_CANDIDATES) {
    try {
      if (p && fs.existsSync(p)) {
        const data = readWorkbook(p);
        if (data && data.transactions.rows.length) {
          data.file = p;
          data.mtime = fs.statSync(p).mtime.toISOString();
          return data;
        }
      }
    } catch (_) { /* try next candidate */ }
  }
  const legacy = readSeparateUploads();
  if (legacy) {
    legacy.file = findFile('transactions');
    legacy.mtime = legacy.file ? fs.statSync(legacy.file).mtime.toISOString() : null;
  }
  return legacy;
}

module.exports = { readUploaded, readWorkbook, DATA_DIR, EXTS };
