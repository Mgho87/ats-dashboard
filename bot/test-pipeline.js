'use strict';
/* Read-only validation of the pipeline engine against the live data + audit baselines.
 * No writes, no Telegram, no production changes. Usage: node test-pipeline.js */
const { fetchSheet, fetchSheetOptional } = require('./lib/sheets');
const compute = require('./lib/compute');
const P = require('./pipeline');
const REPORT = '2026-08-07';
const SID = process.env.SPREADSHEET_ID || '1p7SrQZFavFmslQ84FNMIWtAVHcIhUOLKrSM6e3vuH4Q';
const RAWAN = (process.env.RAWAN_GVIZ_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT0U4OaCeJa5z9Uj9e2URY8gSo4NxpYMFi35JPEEsHeDeFIcztbWhsv4jWA8lXUP9l8kLRpSuZPjTOw/pub?output=csv').trim();
const q = String.fromCharCode(34);
function pCSV(t) { const rows = []; let i = 0, f = '', row = [], inq = false, s = String(t || ''); while (i < s.length) { const c = s[i]; if (inq) { if (c === q) { if (s[i + 1] === q) { f += q; i += 2; continue; } inq = false; i++; continue; } f += c; i++; continue; } if (c === q) { inq = true; i++; continue; } if (c === ',') { row.push(f); f = ''; i++; continue; } if (c === '\r') { i++; continue; } if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; } f += c; i++; } if (f.length || row.length) { row.push(f); rows.push(row); } return rows; }
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function rdk(v) { v = String(v == null ? '' : v).trim(); let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3]; m = v.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/); if (m) { const mm = MON[m[2].slice(0, 3).toLowerCase()]; if (mm) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + mm + '-' + String(m[1]).padStart(2, '0'); } } m = v.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); } return ''; }
async function loadRawan() {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(RAWAN + '&_=' + Date.now() + i, { redirect: 'follow' }); const t = await r.text(); if (r.status === 200 && !/^\s*<(!doctype|html)/i.test(t)) return t; } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}
function mapRawan(csv) {
  const grid = pCSV(csv).filter(x => x.some(c => String(c).trim() !== '')); const idx = {};
  grid[0].forEach((h, n) => { const k = String(h || '').trim().toLowerCase(); if (/refr?ence|reference/.test(k)) idx.ref = n; else if (k === 'date') idx.date = n; else if (/company|client|name/.test(k) && idx.client == null) idx.client = n; else if (/phone/.test(k)) idx.phone = n; else if (/service/.test(k)) idx.service = n; else if (/amount/.test(k)) idx.amount = n; else if (/payment status/.test(k)) idx.status = n; else if (/lead outcome|outcome/.test(k)) idx.outcome = n; else if (/lead source/.test(k)) idx.lead = n; else if (/note/.test(k)) idx.notes = n; });
  const g = (row, f) => idx[f] != null ? String(row[idx[f]] == null ? '' : row[idx[f]]).trim() : '';
  return grid.slice(1).map(r => ({ date: rdk(g(r, 'date')), ref: g(r, 'ref'), client: g(r, 'client'), phone: g(r, 'phone'), service: g(r, 'service'), amount: g(r, 'amount'), outcome: g(r, 'outcome'), status: g(r, 'status'), lead: g(r, 'lead'), notes: g(r, 'notes') })).filter(o => o.client || (o.ref && o.ref !== '0') || o.amount || o.phone);
}
const AED = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US');
function line(seg, base) { return `${seg.n} leads / AED ${seg.aed.toLocaleString()}` + (base ? `   (baseline ${base})` : ''); }

(async () => {
  let PASS = 0, FAIL = 0; const chk = (name, cond, detail) => { console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : '')); cond ? PASS++ : FAIL++; };
  const csv = await loadRawan();
  const t = await fetchSheet(SID, 'Transactions'); const e = (await fetchSheetOptional(SID, 'Expenses')) || { headers: [], rows: [] }; const st = await fetchSheetOptional(SID, 'Settings');
  const sherry = compute.parseAll(t, e, st, new Date()).records.map(r => ({ dateKey: r.dateKey, phone: r.phone, ref: r.ref, amount: r.amount, service: r.service, fileStatus: r.delivery }));

  console.log('=== SOURCE HEALTH ===');
  const stOK = P.sourceHealth(!!csv, csv ? mapRawan(csv) : [], REPORT);
  chk('feed loaded → not SOURCE_UNAVAILABLE', !!csv, 'state=' + stOK);
  chk('source-failure simulation → SOURCE_UNAVAILABLE (not 0)', P.sourceHealth(false, [], REPORT) === 'SOURCE_UNAVAILABLE');
  if (!csv) { console.log('\nFeed down right now — cannot run data regression; the SOURCE_UNAVAILABLE path is validated above.'); process.exit(FAIL ? 1 : 0); }

  const rawan = mapRawan(csv);
  const R = P.buildPipeline(rawan, sherry, REPORT);
  const T = R.totals;
  console.log('\n=== SEGMENTED PIPELINE (report ' + REPORT + ') ===');
  console.log('  ACTIVE OPEN (0–30):   ' + line(T.activeOpen, '≈67 / 33,370.75'));
  console.log('  STALE OPEN (31–45):   ' + line(T.staleOpen));
  console.log('  STALE-REVIEW (46+):   ' + line(T.staleReview));
  console.log('  STALE (all >30):      ' + line(T.staleOpenAll, '≈70 / 31,418.50'));
  console.log('  NEEDS REVIEW:         ' + line(T.needsReview, '≈29 / 27,382 (pre-conservative)'));
  console.log('  TODAY NEW OPEN:       ' + line(T.todayNew, '2 / 2,100'));
  console.log('  TODAY WON/CONVERTED:  ' + line(T.todayWon, '4 / 450'));
  console.log('  HIGH-VALUE (≥2000):   ' + line(T.highValue));
  console.log('  counts:', JSON.stringify(R.counts));

  console.log('\n=== VALIDATION CASES ===');
  const find = re => R.leads.find(L => re.test(L.client));
  const mal = find(/malika/i);
  chk('Malika → WON_CONVERTED (HIGH), not active', mal && mal.class === 'WON_CONVERTED' && mal.conversion.level === 'HIGH', mal && mal.class);
  chk('Malika NOT in ACTIVE OPEN', !T && true || !R.segments.activeOpen.some(L => /malika/i.test(L.client)));
  const drmc = find(/drmc/i);
  chk('DRMC → NEEDS_REVIEW (Other), not ACTIVE', drmc && drmc.class === 'NEEDS_REVIEW' && !R.segments.activeOpen.includes(drmc), drmc && (drmc.class + ' age ' + drmc.age));
  chk('DRMC still visible as HIGH-VALUE', drmc && R.segments.highValue.includes(drmc), drmc && ('AED ' + drmc.amt));
  const orian = find(/orian/i);
  chk('Orian → NEEDS_REVIEW via OUTCOME_CONTRADICTION', orian && orian.flag === 'OUTCOME_CONTRADICTION' && orian.class === 'NEEDS_REVIEW', orian && (orian.outcome + ' / note:"' + orian.note.slice(0, 24) + '"'));
  chk('Orian NOT in ACTIVE OPEN', orian && !R.segments.activeOpen.includes(orian));
  const otherInActive = R.segments.activeOpen.filter(L => /^other$/i.test(L.outcome) && L.class === 'OPEN');
  chk('No "Other" silently in ACTIVE OPEN', otherInActive.length === 0, otherInActive.length + ' found');
  const lowConv = R.leads.filter(L => L.convFlag === 'LOW');
  chk('phone-only (LOW) matches never auto-closed', lowConv.every(L => L.class !== 'WON_CONVERTED'), lowConv.length + ' LOW-flagged, all kept open/review');
  chk('HIGH conversions auto-closed', R.counts.converted > 0, R.counts.converted + ' WON_CONVERTED');
  chk('aging never forced OPEN→LOST', R.leads.filter(L => L.class === 'LOST').every(L => /cancel|not interest|declin|lost|reject/i.test(L.outcome)), 'all LOST have explicit loss outcome');

  console.log('\n' + PASS + ' passed · ' + FAIL + ' failed');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
