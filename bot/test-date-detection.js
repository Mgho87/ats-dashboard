'use strict';
/**
 * Regression tests for the Sherry/Transactions date-column detection and the
 * source-integrity guard.
 *
 * Background: a blanked/renamed A1 made Google Sheets expose the first column as
 * "Column 1". No header alias matched, col.date became -1, and all 506 rows were
 * silently dropped as "no date" — the report then showed a perfectly clean
 * "0 files · AED 0.00" for Sherry while the sheet was full of data.
 *
 * Run:  node test-date-detection.js
 */

const assert = require('assert');
const compute = require('./lib/compute');
const v2 = require('./report-image-v2');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
}

/* ------------------------------- fixtures ---------------------------------- */
const HEAD_TAIL = ['Refrence Number', 'Company or Client Name', 'Phone Number', 'Service Type',
                   'Amount (AED)', 'Payment Status', 'Delivery Status', 'Payment Method', 'Lead Source', 'Notes'];

/** N rows shaped like the real gviz output: col A is a real Date object. */
function rowsWithDates(n, firstColValues) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = firstColValues ? firstColValues[i % firstColValues.length] : new Date(2026, 7, 1 + (i % 20));
    out.push([a, 'ATS' + (100000 + i), 'Client ' + i, 971500000000 + i, 'Legal Translation',
              100 + i, 'Paid', 'Delivered', 'Cash', 'Google Ads', 'note']);
  }
  return out;
}
const table = (firstHeader, rows) => ({ headers: [firstHeader].concat(HEAD_TAIL), rows });
const EMPTY_EXP = { headers: [], rows: [] };
const parse = t => compute.parseAll(t, EMPTY_EXP, null, new Date(2026, 8, 2));

console.log('\nDate-column detection & source integrity\n');

/* ---- A: the normal, expected header ---- */
test('A · header "Date" parses normally', () => {
  const p = parse(table('Date', rowsWithDates(20)));
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'header');
  assert.strictEqual(p.records.length, 20, 'expected 20 records, got ' + p.records.length);
  assert.strictEqual(p.sourceIntegrity.ok, true);
});

/* ---- B: an alternate supported alias ---- */
test('B · header "Transaction Date" parses normally', () => {
  const p = parse(table('Transaction Date', rowsWithDates(20)));
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'header');
  assert.strictEqual(p.records.length, 20);
  assert.strictEqual(p.sourceIntegrity.ok, true);
});

/* ---- C: the actual production failure — renamed header, real dates below ---- */
test('C · header "Column 1" falls back to column A and preserves every record', () => {
  const p = parse(table('Column 1', rowsWithDates(20)));
  assert.strictEqual(p.col.date, 0, 'column A should have been adopted');
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'fallback-column-a');
  assert.strictEqual(p.records.length, 20, 'no record may be lost, got ' + p.records.length);
  assert.strictEqual(p.sourceIntegrity.ok, true);
  assert.strictEqual(p.sourceIntegrity.dateHeaderValue, 'Column 1');
  const warned = p.audit.some(a => /Date column fallback/.test(a.event));
  assert.ok(warned, 'a fallback warning must be emitted into the audit log');
  const w = p.audit.find(a => /Date column fallback/.test(a.event)).details;
  assert.ok(/Falling back to column A after validating date-like values/.test(w), 'warning text: ' + w);
  assert.ok(/Detected header: "Column 1"/.test(w), 'warning must name the real header: ' + w);
});

/* ---- D: header cell blank entirely ---- */
test('D · blank first header falls back to column A', () => {
  const p = parse(table('', rowsWithDates(20)));
  assert.strictEqual(p.col.date, 0);
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'fallback-column-a');
  assert.strictEqual(p.records.length, 20);
  assert.strictEqual(p.sourceIntegrity.ok, true);
});

/* ---- E: the fallback must NOT fire when column A is not dates ---- */
test('E · unrecognized header + non-date column A is refused (no fabricated dates)', () => {
  const junk = ['Certified Translation', 'Legal Translation', 'Medical Report', 'Trade License', 'Court'];
  const p = parse(table('Column 1', rowsWithDates(20, junk)));
  assert.strictEqual(p.col.date, -1, 'column A must NOT be adopted as the date column');
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'none');
  assert.strictEqual(p.records.length, 0, 'no records may be invented');
  assert.strictEqual(p.sourceIntegrity.ok, false);
  assert.strictEqual(p.sourceIntegrity.status, 'NO_DATE_COLUMN');
});

test('E2 · bare numbers in column A are not mistaken for dates', () => {
  const p = parse(table('Column 1', rowsWithDates(20, [60, 100, 2026, 80, 36.75])));
  assert.strictEqual(p.col.date, -1, 'numbers like 2026 must not be read as a year');
  assert.strictEqual(p.sourceIntegrity.ok, false);
});

test('E3 · a mixed column below the majority threshold is refused', () => {
  // 2 dates out of 5 distinct values = 40% — well under the 80% bar.
  const mixed = [new Date(2026, 7, 3), new Date(2026, 7, 4), 'Legal Translation', 'Court', 'Trade License'];
  const p = parse(table('Column 1', rowsWithDates(20, mixed)));
  assert.strictEqual(p.col.date, -1);
  assert.strictEqual(p.sourceIntegrity.status, 'NO_DATE_COLUMN');
});

/* ---- F: silent-zero protection (date column found, but nothing parsed) ---- */
test('F · many rows + zero parsed records is flagged broken, not quiet', () => {
  const p = parse(table('Date', rowsWithDates(20, ['N/A', 'n/a', '-', 'TBC', ''])));
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'header', 'the header itself was fine');
  assert.strictEqual(p.records.length, 0);
  assert.strictEqual(p.sourceIntegrity.ok, false, 'must not look like a genuine zero-activity day');
  assert.strictEqual(p.sourceIntegrity.status, 'PARSE_EMPTY');
  assert.ok(p.sourceIntegrity.nonEmptyRows >= 10);
  assert.ok(/0 valid records were parsed/.test(p.sourceIntegrity.reason), p.sourceIntegrity.reason);
});

test('F2 · a genuinely small/empty sheet is NOT called broken', () => {
  // Below the threshold an empty result is plausibly real — do not cry wolf.
  const p = parse(table('Date', []));
  assert.strictEqual(p.records.length, 0);
  assert.strictEqual(p.sourceIntegrity.ok, true, 'an empty sheet is not evidence of breakage');
});

test('F3 · a real quiet day still reports as OK', () => {
  // 20 healthy rows, none of them today — integrity is about the sheet, not the day.
  const p = parse(table('Date', rowsWithDates(20)));
  assert.strictEqual(p.sourceIntegrity.ok, true);
  assert.strictEqual(p.records.filter(r => r.dateKey === '2026-09-02').length, 0);
});

/* ---- G: header matching tolerance ---- */
test('G · header matching tolerates case, padding and zero-width characters', () => {
  const p = parse(table('﻿  DA​TE  ', rowsWithDates(20)));
  assert.strictEqual(p.sourceIntegrity.dateDetectionMethod, 'header', 'should match on the header, not fall back');
  assert.strictEqual(p.records.length, 20);
});

/* ---- H: the diagnostics the operator needs ---- */
test('H · diagnostics are complete and carry no row contents', () => {
  const p = parse(table('Column 1', rowsWithDates(20)));
  const si = p.sourceIntegrity;
  ['rawRows', 'nonEmptyRows', 'parsedRows', 'excludedNoDate', 'excludedBadDate',
   'dateColumn', 'dateDetectionMethod', 'dateHeaderValue'].forEach(k => {
    assert.ok(si[k] !== undefined, 'missing diagnostic: ' + k);
  });
  assert.strictEqual(si.rawRows, 20);
  assert.strictEqual(si.parsedRows, 20);
  const blob = JSON.stringify(si);
  assert.ok(!/Client \d/.test(blob), 'diagnostics must not leak client names');
  assert.ok(!/9715\d+/.test(blob), 'diagnostics must not leak phone numbers');
});

/* ---- I: the report withholds figures instead of printing zeros ---- */
test('I · BROKEN source renders the alert banner and withholds figures', () => {
  const model = v2.computeModelV2('2026-09-02', [], [], {
    source: { sherry: 'BROKEN', rawan: 'OK', sherryIntegrity: { nonEmptyRows: 506, rawRows: 506, dateHeaderValue: 'Column 1' } },
  });
  const svg = v2.buildSherrySVG(model, null).svg;
  assert.ok(/SHERRY SOURCE BROKEN/.test(svg), 'the banner must name the failure');
  assert.ok(/506 rows received/.test(svg), 'the banner must state the evidence');
  assert.ok(/0 valid records parsed/.test(svg));
  assert.ok(!/AED\s*0(\.00)?\b/.test(svg), 'a broken source must never render AED 0');
});

test('I2 · a healthy source is unaffected by the new branch', () => {
  const rows = [{ dateKey: '2026-09-01', ref: 'ATS1', client: 'A', service: 'Legal Translation',
                  amount: 100, status: 'Paid', fileStatus: 'Delivered', method: 'Cash', lead: 'Google Ads', notes: '', phone: '9715' }];
  const model = v2.computeModelV2('2026-09-01', rows, [], { source: { sherry: 'OK', rawan: 'OK' } });
  const svg = v2.buildSherrySVG(model, null).svg;
  assert.ok(!/SOURCE BROKEN/.test(svg));
  assert.ok(!/SOURCE UNAVAILABLE/.test(svg));
});

test('I3 · DOWN still renders the original "unavailable" wording', () => {
  const model = v2.computeModelV2('2026-09-02', [], [], { source: { sherry: 'DOWN', rawan: 'OK' } });
  const svg = v2.buildSherrySVG(model, null).svg;
  assert.ok(/SHERRY SOURCE UNAVAILABLE/.test(svg), 'the pre-existing DOWN path must be preserved');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
