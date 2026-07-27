'use strict';
/* Local test harness for the Daily Office Report image path. Renders every scenario to a PNG,
 * asserts it does not crash / clip, and prints model reconciliation. No Telegram, no network
 * (uses fixtures + one optional real-data file). Usage: node test-report-image.js [outDir] [realDataJson] */
const fs = require('fs');
const path = require('path');
const ri = require('./report-image');

const OUT = process.argv[2] || path.join(__dirname, 'archive', 'tests');
const REAL = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

const S = (o) => Object.assign({ ref: '', client: '', service: 'Legal Translation', amount: 0, status: 'paid', fileStatus: 'delivered', method: 'Cash', lead: '', notes: 'English to Arabic', phone: '' }, o);
const R = (o) => Object.assign({ ref: '', client: '', service: 'Legal Translation', amount: 0, status: 'Other', fileStatus: 'Pending', method: '', lead: '', outcome: 'No Response', notes: '', phone: '' }, o);

const AR = 'المترجم القانوني للترجمة القانونية المعتمدة في دولة الإمارات العربية المتحدة مع خدمة سريعة';
const EN_LONG = 'Certified legal translation of a residential tenancy contract including all annexes, addenda, schedules and the notarised power of attorney, delivered same day with courier';

const scenarios = {};
// 1 normal (real data if provided, else a small synthetic)
if (REAL && fs.existsSync(REAL)) { const d = JSON.parse(fs.readFileSync(REAL, 'utf8')); scenarios['1-normal'] = { date: d.date, sherry: d.sherry, rawan: d.rawan }; }
else scenarios['1-normal'] = { date: '2026-07-04', sherry: [S({ ref: 'Residential Purposes File', client: 'MD DULAL', amount: 105 }), S({ ref: 'Cheque Return Memo', client: 'Skyline Mustafa', amount: 42, status: 'outstanding' })], rawan: [R({ ref: 'ATS103804', client: 'Roshane dias', amount: 236.25, notes: 'will get back to us' }), R({ client: 'MD Dulal', amount: 105, status: 'Paid', fileStatus: 'Delivered', outcome: 'Accepted', notes: 'done' })] };
// 2 empty day
scenarios['2-empty'] = { date: '2026-07-05', sherry: [], rawan: [] };
// 3 many records → very tall
const many = { date: '2026-07-06', sherry: [], rawan: [] };
for (let i = 1; i <= 60; i++) many.sherry.push(S({ ref: 'ATS' + (100000 + i), client: 'Client Number ' + i, amount: (i * 37) % 500, status: i % 3 ? 'paid' : 'outstanding', fileStatus: i % 4 ? 'delivered' : 'pending' }));
for (let i = 1; i <= 50; i++) many.rawan.push(R({ ref: 'ATS' + (200000 + i), client: 'Lead Person ' + i, amount: (i * 53) % 700, outcome: i % 2 ? 'No Response' : 'Accepted', notes: 'follow-up note number ' + i }));
scenarios['3-many-tall'] = many;
// 5 long arabic
scenarios['5-arabic'] = { date: '2026-07-07', sherry: [S({ ref: 'ATS777', client: 'محمد عبد الله الشحي', amount: 350, notes: AR })], rawan: [R({ client: 'شركة الإمارات للمحاماة والاستشارات القانونية', amount: 900, notes: AR, outcome: 'No Response' })] };
// 6 long english
scenarios['6-english-long'] = { date: '2026-07-08', sherry: [S({ ref: 'ATS888', client: 'International Trading & Contracting Company LLC (Branch)', amount: 1250, notes: EN_LONG })], rawan: [R({ client: 'A Very Long Client Business Name That Should Wrap Across Multiple Lines Without Clipping', amount: 500, notes: EN_LONG, outcome: 'Customer question' })] };
// 7 unmatched only
scenarios['7-unmatched'] = { date: '2026-07-09', sherry: [S({ ref: 'ATSA', client: 'Alpha One', amount: 100 })], rawan: [R({ ref: 'ZZZ1', client: 'Totally Different Lead', amount: 200 }), R({ ref: 'ZZZ2', client: 'Another Stranger', amount: 300 })] };
// 8 duplicate refs
scenarios['8-duplicates'] = { date: '2026-07-10', sherry: [S({ ref: 'DUP1', client: 'Client A', amount: 100 }), S({ ref: 'DUP1', client: 'Client A copy', amount: 100 })], rawan: [R({ ref: 'DUP1', client: 'Client A', amount: 100, outcome: 'Accepted' }), R({ ref: 'DUP1', client: 'Client A', amount: 100 })] };
// 9 all pending
scenarios['9-all-pending'] = { date: '2026-07-11', sherry: [S({ ref: 'P1', client: 'Pending One', amount: 100, status: 'outstanding', fileStatus: 'pending' }), S({ ref: 'P2', client: 'Pending Two', amount: 200, status: 'outstanding', fileStatus: 'in progress' })], rawan: [R({ client: 'Pending One', amount: 100 })] };
// 10 all completed
scenarios['10-all-completed'] = { date: '2026-07-12', sherry: [S({ ref: 'D1', client: 'Done One', amount: 100 }), S({ ref: 'D2', client: 'Done Two', amount: 200 })], rawan: [R({ client: 'Done One', amount: 100, status: 'Paid', fileStatus: 'Delivered', outcome: 'Accepted' })] };

async function renderCase(name, sc, opts) {
  const model = ri.computeModel(sc.date, sc.sherry, sc.rawan);
  let pages, err = null;
  try { pages = await ri.renderReportPages(model, OUT, name, opts); } catch (e) { err = e.message; }
  const p1 = pages && pages.find(p => p.page === 1), p2 = pages && pages.find(p => p.page === 2);
  return { name, ok: !err && !!p1 && !!p2, err,
    p1: p1 ? p1.width + 'x' + p1.height : '-', p2: p2 ? p2.width + 'x' + p2.height : '-',
    renderer: p1 ? p1.renderer : '-', logo: p1 ? p1.logoOk : '-',
    recon: model.recon,
    acc: model.rawanAccepted.length, pend: model.rawanPending.length, lost: model.rawanNotInterested.length,
    conf: model.revenue.confirmed, pot: model.revenue.potential, tot: model.revenue.total, valid: model.validation.ok };
}

(async () => {
  const results = [];
  for (const name of Object.keys(scenarios)) results.push(await renderCase(name, scenarios[name]));
  results.push(await renderCase('4-missing-logo', scenarios['1-normal'], { logoPath: path.join(__dirname, 'assets', 'NO_SUCH_LOGO.png') }));
  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  console.log('\nSCENARIO             OK   PAGE1(ops)   PAGE2(f/u)   LOGO  ACC/PEND/LOST   M/U/A/D        CONF/POT/TOTAL         VALID');
  for (const r of results) {
    console.log(`${r.name.padEnd(20)} ${(r.ok ? 'YES' : 'NO ')}  ${String(r.p1).padEnd(12)} ${String(r.p2).padEnd(12)} ${String(r.logo).padEnd(5)} ${(r.acc + '/' + r.pend + '/' + r.lost).padEnd(15)} ${(r.recon.matched + '/' + r.recon.unmatched + '/' + r.recon.ambiguous + '/' + r.recon.duplicates).padEnd(14)} ${(r.conf + '/' + r.pot + '/' + r.tot).padEnd(22)} ${r.valid}` + (r.err ? '  ERR:' + r.err : ''));
  }
  const fails = results.filter(r => !r.ok);
  console.log('\n' + results.length + ' scenarios · ' + (results.length - fails.length) + ' passed · ' + fails.length + ' failed (each renders 2 pages)');
  console.log('output dir:', OUT);
  process.exit(fails.length ? 1 : 0);
})();
