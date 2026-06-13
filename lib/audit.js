'use strict';
/**
 * Forensic audit engine for ALMUTARJEM.
 *
 * On every sync we diff the PREVIOUS dataset snapshot against the NEW one and
 * record field-level changes (old → new) with a change type and severity.
 *
 * Records are keyed by their SHEET ROW NUMBER. The Transactions tab has no
 * unique business key (the "Refrence Number" column holds document names, not
 * invoice IDs), and row position is stable for in-place edits and bottom
 * appends — the way staff actually update the sheet. A mid-sheet insert/delete
 * shifts rows; a guard collapses an implausibly large diff into one bulk event
 * instead of thousands of false changes.
 *
 * History + last snapshot persist to data/ so the log is a true historical
 * record across server restarts.
 */
const fs = require('fs');
const path = require('path');

// AUDIT_DIR lets a cloud host point persistence at a mounted persistent disk
// (e.g. Render disk at /var/data) so the forensic history survives redeploys.
const DIR = process.env.AUDIT_DIR || path.join(__dirname, '..', 'data');
try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch (_) {}
const HIST_FILE = path.join(DIR, 'audit-history.json');
const SNAP_FILE = path.join(DIR, 'last-snapshot.json');
const MAX_HISTORY = 8000;
const STAFF = 'Google Sheet (staff)';

function loadJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return def; } }
function saveJSON(p, v) { try { fs.writeFileSync(p, JSON.stringify(v)); } catch (_) {} }

function loadHistory() { return loadJSON(HIST_FILE, []); }
function loadSnapshot() { return loadJSON(SNAP_FILE, null); }
function saveSnapshot(records) { saveJSON(SNAP_FILE, records.map(slim)); }

/** Persist a batch of change events (newest first). */
function recordChanges(changes) {
  if (!changes || !changes.length) return;
  const hist = loadHistory();
  saveJSON(HIST_FILE, changes.concat(hist).slice(0, MAX_HISTORY));
}

/** Log a system/sync event into the forensic history. */
function logSystem(severity, message, details) {
  recordChanges([{
    ts: new Date().toISOString(), user: 'System', sheet: '—', ref: '—', row: null,
    column: '', oldValue: '', newValue: '', changeType: 'SYSTEM_EVENT',
    severity: severity || 'INFO', message: message || '', details: details || '',
  }]);
}

/* ------------------------------- helpers ---------------------------------- */
function slim(r) {
  return {
    row: r.sheetRow, date: r.dateKey || '', ref: (r.ref || '').trim(), client: (r.client || '').trim(),
    phone: (r.phone || '').trim(), service: (r.service || '').trim(), amount: Number(r.amount) || 0,
    payment: (r.rawPayment || r.payment || '').trim(), delivery: (r.rawDelivery || r.delivery || '').trim(),
    method: (r.method || '').trim(), lead: (r.lead || '').trim(), notes: (r.notes || '').trim(),
  };
}
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const aed = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const refOf = r => (r && r.ref) ? r.ref : (r && r.client) ? r.client : ('row ' + (r ? r.row : '?'));

function mk(ts, changeType, severity, ref, column, oldValue, newValue, message, row) {
  return { ts, user: STAFF, sheet: 'Transactions', ref, row, column, oldValue, newValue, changeType, severity, message };
}

/* paid → outstanding/pending = money at risk; → cancelled = revenue lost */
function paymentSeverity(oldV, newV) {
  const o = norm(oldV), n = norm(newV);
  if (/cancel|refund/.test(n)) return 'CRITICAL';
  if (/paid|settled|received/.test(o) && /pending|outstanding|unpaid|partial/.test(n)) return 'WARNING';
  return /paid|settled|received/.test(n) ? 'INFO' : 'WARNING';
}
function amountSeverity(oldV, newV) {
  const d = Number(newV) - Number(oldV), abs = Math.abs(d), pct = oldV ? abs / Math.abs(oldV) * 100 : 100;
  if (abs >= 500 || pct >= 50) return 'CRITICAL';          // large modification
  if (d < 0) return 'WARNING';                             // revenue reduced
  return abs >= 100 ? 'WARNING' : 'INFO';
}

/** Field-level comparison of two snapshot rows. */
function compareFields(o, n, ts) {
  const out = [];
  const ref = refOf(n);
  if (Number(o.amount) !== Number(n.amount)) {
    const d = Number(n.amount) - Number(o.amount), dir = d >= 0 ? 'increased' : 'reduced';
    out.push(mk(ts, 'VALUE_CHANGE', amountSeverity(o.amount, n.amount), ref, 'Amount', aed(o.amount), aed(n.amount),
      `Amount ${dir} by ${aed(Math.abs(d))} (${aed(o.amount)} → ${aed(n.amount)})`, n.row));
  }
  if (norm(o.payment) !== norm(n.payment)) {
    out.push(mk(ts, 'STATUS_CHANGE', paymentSeverity(o.payment, n.payment), ref, 'Payment Status', o.payment || '—', n.payment || '—',
      `Payment status ${o.payment || '—'} → ${n.payment || '—'}`, n.row));
  }
  if (norm(o.delivery) !== norm(n.delivery)) {
    const sev = /cancel/.test(norm(n.delivery)) ? 'WARNING' : 'INFO';
    out.push(mk(ts, 'STATUS_CHANGE', sev, ref, 'Delivery Status', o.delivery || '—', n.delivery || '—',
      `Delivery status ${o.delivery || '—'} → ${n.delivery || '—'}`, n.row));
  }
  if (norm(o.client) !== norm(n.client))
    out.push(mk(ts, 'UPDATE', 'WARNING', ref, 'Client Name', o.client || '—', n.client || '—', `Client name changed`, n.row));
  if (norm(o.service) !== norm(n.service))
    out.push(mk(ts, 'UPDATE', 'INFO', ref, 'Service Type', o.service || '—', n.service || '—', `Service type changed`, n.row));
  if (norm(o.lead) !== norm(n.lead))
    out.push(mk(ts, 'UPDATE', 'INFO', ref, 'Lead Source', o.lead || '—', n.lead || '—', `Lead source changed`, n.row));
  if (o.date !== n.date)
    out.push(mk(ts, 'UPDATE', 'WARNING', ref, 'Date', o.date || '—', n.date || '—', `Transaction date changed`, n.row));
  if (norm(o.method) !== norm(n.method))
    out.push(mk(ts, 'UPDATE', 'INFO', ref, 'Payment Method', o.method || '—', n.method || '—', `Payment method changed`, n.row));
  if (norm(o.ref) !== norm(n.ref))
    out.push(mk(ts, 'UPDATE', 'INFO', ref, 'Reference', o.ref || '—', n.ref || '—', `Reference changed`, n.row));
  if (norm(o.notes) !== norm(n.notes))
    out.push(mk(ts, 'UPDATE', 'INFO', ref, 'Notes', o.notes || '—', n.notes || '—', `Notes changed`, n.row));
  // req #12: stamp the affected transaction's own date so the Audit Log can filter by
  // Transaction Date (Mode B) as well as detection time (Mode A / ts).
  const _td = n.date || o.date || '';
  out.forEach(c => { c.txnDate = _td; });
  return out;
}

/**
 * Diff old snapshot (array of slim rows) vs new records (parseAll records).
 * Returns { changes, created, updated, deleted, bulk }.
 */
function diffRecords(oldSlim, newRecords, nowIso) {
  const ts = nowIso || new Date().toISOString();
  const newSlim = newRecords.map(slim);
  const oldByRow = new Map((oldSlim || []).map(r => [r.row, r]));
  const newByRow = new Map(newSlim.map(r => [r.row, r]));
  const rows = new Set([...oldByRow.keys(), ...newByRow.keys()]);

  const changes = [];
  let created = 0, deleted = 0, updated = 0;
  for (const row of rows) {
    const o = oldByRow.get(row), n = newByRow.get(row);
    if (!o && n) {
      created++;
      const cc = mk(ts, 'CREATE', 'INFO', refOf(n), '—', '', aed(n.amount),
        `New transaction added — ${n.client || 'client'} · ${n.service || 'service'} · ${aed(n.amount)}`, row);
      cc.txnDate = n.date || ''; changes.push(cc);
    } else if (o && !n) {
      deleted++;
      const dc = mk(ts, 'DELETE', 'CRITICAL', refOf(o), '—', aed(o.amount), '',
        `Transaction removed — ${o.client || 'client'} · was ${aed(o.amount)} (revenue reduced)`, row);
      dc.txnDate = o.date || ''; changes.push(dc);
    } else if (o && n) {
      const fc = compareFields(o, n, ts);
      if (fc.length) { updated++; changes.push(...fc); }
    }
  }

  // guard: a mid-sheet insert/delete shifts rows and would explode the diff.
  const touched = created + deleted + updated;
  if (touched > 40 && touched > newSlim.length * 0.5) {
    return {
      changes: [mk(ts, 'UPDATE', 'CRITICAL', 'BULK', '—', `${(oldSlim || []).length} rows`, `${newSlim.length} rows`,
        `Bulk change detected (${created} added / ${updated} modified / ${deleted} removed) — likely rows inserted or reordered in the sheet. Individual diffs suppressed.`, null)],
      created, updated, deleted, bulk: true,
    };
  }
  // order: structural first (CREATE/DELETE), then field changes
  changes.sort((a, b) => rank(a.changeType) - rank(b.changeType));
  return { changes, created, updated, deleted, bulk: false };
}
function rank(t) { return { DELETE: 0, CREATE: 1, VALUE_CHANGE: 2, STATUS_CHANGE: 3, UPDATE: 4, SYSTEM_EVENT: 5 }[t] ?? 9; }

module.exports = { loadHistory, loadSnapshot, saveSnapshot, recordChanges, logSystem, diffRecords, STAFF };
