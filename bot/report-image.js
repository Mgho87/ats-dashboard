'use strict';
/* ============================================================================
 * ALMUTARJEM — Daily Office Report IMAGE generator (SVG → PNG)
 * ----------------------------------------------------------------------------
 * Produces ONE professional dashboard PNG per day. Width is fixed (~2300 px);
 * HEIGHT IS DYNAMIC — the canvas grows as tall as needed to show EVERY record.
 * No A4 ratio, no fixed page height, no clipping, no "…and more", no font
 * shrinking. Renderer is cPanel-safe: an SVG string rasterised by Sharp
 * (prebuilt libvips) with an automatic fallback to @resvg/resvg-js. Puppeteer /
 * headless Chrome is never used.
 *
 * NOTE on the logo: assets/almutarjem-logo.png is background-removed by edge
 * flood-fill. Some flat white/light *page* pixels that were connected to the
 * outer background became transparent, so NOT every interior pixel is preserved.
 * It is visually faithful ON A WHITE ground only — always keep a white logo-safe
 * area behind it; do not place it over dark/coloured backgrounds. The pristine
 * source is kept at assets/almutarjem-logo-original.png.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

/* ---------- palette / type ---------- */
const C = {
  blue: '#173A6A', blue2: '#2E6DB4', ink: '#17233A', muted: '#647089', line: '#E3E9F1',
  soft: '#F6F8FB', white: '#FFFFFF', green: '#1E9E6A', orange: '#E08A0B', red: '#CE3F3F', purple: '#7A3FD0',
};
const FONT = "Arial, 'DejaVu Sans', 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', sans-serif";
const W = 2300, PAD = 64, CW = W - 2 * PAD;

/* ---------- text helpers ---------- */
const escX = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const AED = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = s => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '—'; };
const isCancel = s => /cancel/i.test(String(s || ''));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
const p9 = s => (String(s || '').replace(/\D/g, '').slice(-9)) || '';
const hasArabic = s => /[؀-ۿ]/.test(String(s || ''));

// approximate glyph width so we can wrap WITHOUT a browser. Deliberately generous
// (0.58×size) so text never overflows its column — readability over tightness.
function maxChars(widthPx, size) { return Math.max(4, Math.floor(widthPx / (size * 0.58))); }
function wrap(str, mc) {
  str = String(str == null ? '' : str).trim();
  if (!str) return ['—'];
  const words = str.split(/\s+/), lines = []; let cur = '';
  for (let w of words) {
    while (w.length > mc) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, mc - 1) + '-'); w = w.slice(mc - 1); }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= mc) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ['—'];
}
function T(x, y, s, o) {
  o = o || {};
  const anchor = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const weight = o.weight ? ` font-weight="${o.weight}"` : '';
  const dir = hasArabic(s) ? ' direction="rtl"' : '';
  return `<text x="${x}" y="${y}" font-family="${o.family || FONT}" font-size="${o.size || 26}" fill="${o.fill || C.ink}"${weight}${anchor}${dir}>${escX(s)}</text>`;
}
// Direction-aware line: Latin lines anchor at leftX (flow →); Arabic (RTL) anchor at rightX (flow ←)
// so RTL text stays inside its column instead of running off the left edge.
function lineT(leftX, rightX, y, str, o) {
  o = o || {};
  if (hasArabic(str)) return T(rightX, y, str, Object.assign({}, o, { anchor: 'start' }));
  return T(leftX, y, str, Object.assign({}, o, { anchor: o.anchor || 'start' }));
}

/* ---------- status → semantic colour ---------- */
function payClass(s) { s = String(s || '').toLowerCase(); if (/cancel/.test(s)) return 'red'; if (/paid|collected/.test(s)) return 'green'; if (/outstand|pending|due|other/.test(s)) return 'orange'; return 'gray'; }
function fileClass(s) { s = String(s || '').toLowerCase(); if (/deliver|complete|done|ready|closed|collected/.test(s)) return 'green'; if (/pending|progress|await|new|process/.test(s)) return 'orange'; if (/cancel/.test(s)) return 'red'; return 'gray'; }
function outcomeClass(s) { s = String(s || '').toLowerCase(); if (/accept|agree|confirm/.test(s)) return 'green'; if (/no response|pending|await|question/.test(s)) return 'orange'; if (/reject|declin|cancel/.test(s)) return 'red'; return 'gray'; }
const PILLBG = { green: '#E4F3EC', orange: '#FBEED6', red: '#F6E0E0', gray: '#ECEFF4' };
const PILLFG = { green: '#147A50', orange: '#A5620A', red: '#A52F2F', gray: '#647089' };

/* pill: rounded rect + centred label. Returns {svg,w}. */
function pill(x, y, label, cls, size) {
  size = size || 22; label = cap(label);
  const w = Math.round(label.length * size * 0.60) + 28, h = size + 16;
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${PILLBG[cls] || PILLBG.gray}"/>` +
      T(x + w / 2, y + h - Math.round(size * 0.35) - 3, label, { size, weight: 700, fill: PILLFG[cls] || PILLFG.gray, anchor: 'middle' }),
    h,
  };
}

/* ============================================================================
 * MODEL — stats, matching + reconciliation
 * ========================================================================== */
function computeModel(dateKey, sherry, rawan) {
  sherry = sherry || []; rawan = rawan || [];
  const clients = new Set(sherry.map(r => norm(r.client)).filter(Boolean)).size;
  const files = sherry.length;
  const completed = sherry.filter(r => fileClass(r.fileStatus) === 'green').length;
  const pending = files - completed;
  const revenue = sherry.reduce((a, r) => a + (isCancel(r.status) ? 0 : (+r.amount || 0)), 0);
  const confRate = files ? Math.round((completed / files) * 100) : 0;

  // matching signals
  const sRefs = new Map(), sNames = [], sPhones = new Map();
  sherry.forEach(s => { const nr = norm(s.ref); if (s.ref && s.ref !== '0') sRefs.set(nr, (sRefs.get(nr) || 0) + 1); if (s.client) sNames.push(norm(s.client)); if (p9(s.phone)) sPhones.set(p9(s.phone), true); });
  function matchesOf(r) {
    const strong = [], weak = [];
    sherry.forEach(s => {
      const refEq = r.ref && r.ref !== '0' && norm(r.ref) === norm(s.ref) && norm(s.ref);
      const phEq = p9(r.phone) && p9(r.phone) === p9(s.phone);
      const nmEq = norm(r.client) && norm(r.client) === norm(s.client);
      if (refEq || phEq || nmEq) strong.push(s);
      else { const a = norm(r.client), b = norm(s.client); if (a && b && (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5) weak.push(s); }
    });
    return { strong, weak };
  }

  let matched = 0, unmatched = 0, ambiguous = 0;
  const matchedList = [], followList = [];
  rawan.forEach(r => {
    const { strong, weak } = matchesOf(r);
    if (strong.length === 1) { matched++; matchedList.push(r); }
    else if (strong.length > 1) { ambiguous++; matchedList.push(Object.assign({ _amb: true }, r)); }
    else if (weak.length >= 1) { ambiguous++; matchedList.push(Object.assign({ _amb: true }, r)); }
    else { unmatched++; }
    // follow-up = anything not accepted (regardless of match)
    if (outcomeClass(r.outcome) !== 'green') followList.push(r);
  });

  // duplicates: same ATS ref appearing more than once (within rawan, within sherry)
  const dupCount = list => { const m = {}; list.forEach(r => { if (r.ref && r.ref !== '0') { const k = norm(r.ref); m[k] = (m[k] || 0) + 1; } }); return Object.values(m).filter(n => n > 1).reduce((a, n) => a + n, 0); };
  const duplicates = dupCount(rawan) + dupCount(sherry);

  // Sherry files with NO reply in Rawan (Group B) — reverse match
  const noReply = sherry.filter(s => !rawan.some(r => {
    const refEq = s.ref && s.ref !== '0' && norm(s.ref) === norm(r.ref) && norm(r.ref);
    const phEq = p9(s.phone) && p9(s.phone) === p9(r.phone);
    const a = norm(s.client), b = norm(r.client);
    const nm = a && b && (a === b || ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5));
    return refEq || phEq || nm;
  }));

  // follow-up unique (dedup by client+ref), pending/not-agreed only
  const seen = new Set(), follow = [];
  followList.forEach(r => { const k = norm(r.client) + '|' + norm(r.ref); if (!seen.has(k)) { seen.add(k); follow.push(r); } });

  const potential = follow.reduce((a, r) => a + (isCancel(r.status) ? 0 : (+r.amount || 0)), 0);
  const pipeline = revenue + potential;
  const priority = [...follow].filter(r => (+r.amount || 0) > 0).sort((a, b) => (+b.amount || 0) - (+a.amount || 0));

  const reasonCounts = {};
  rawan.forEach(r => { const o = cap(r.outcome || 'No Reply'); reasonCounts[o] = (reasonCounts[o] || 0) + 1; });
  const reasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);

  // recommendations
  const recs = [];
  if (priority[0]) recs.push(`Prioritise ${priority[0].client} — highest open opportunity at ${AED(priority[0].amount)}. ${priority[0].notes || 'Follow up today.'}`);
  const outstanding = sherry.filter(r => payClass(r.status) === 'orange' && !isCancel(r.status));
  if (outstanding.length) recs.push(`Collect ${AED(outstanding.reduce((a, r) => a + (+r.amount || 0), 0))} outstanding across ${outstanding.length} delivered file(s).`);
  const noResp = follow.filter(r => /no response/i.test(r.outcome)).length;
  if (noResp) recs.push(`${noResp} lead(s) show no response — send a second follow-up before end of day.`);
  if (files && confRate < 100) recs.push(`Completion rate is ${confRate}% — clear the ${pending} pending file(s) to reach 100%.`);
  if (!recs.length) recs.push(files ? 'All files delivered and all leads resolved — no action required today.' : 'No business activity recorded today.');

  // validation
  const issues = [];
  sherry.forEach(r => { if (!(+r.amount) && !isCancel(r.status) && fileClass(r.fileStatus) === 'green') issues.push(`Sherry file "${r.client || r.ref}" delivered with no amount`); });
  if (duplicates) issues.push(`${duplicates} record(s) share a duplicate ATS reference`);
  if (ambiguous) issues.push(`${ambiguous} Rawan record(s) matched ambiguously (verify manually)`);
  const reconciles = Math.abs(pipeline - (revenue + potential)) < 0.005;
  const validation = { reconciles, ok: reconciles, issues };

  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey) || [];
  const dObj = dm.length ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : new Date();
  return {
    date: dateKey, dayName: dObj.toLocaleDateString('en-GB', { weekday: 'long' }),
    dateStr: dObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    kpi: { clients, files, completed, pending, revenue, confRate },
    pipeline: { confirmed: revenue, potential, total: pipeline },
    sherry, matchedList, noReply, follow, priority, reasons, recs,
    recon: { matched, unmatched, ambiguous, duplicates },
    validation,
  };
}

/* ============================================================================
 * SVG LAYOUT ENGINE — append blocks, grow height dynamically
 * ========================================================================== */
function loadLogo(logoPath) {
  try { const b = fs.readFileSync(logoPath); return { uri: 'data:image/png;base64,' + b.toString('base64'), ok: true }; }
  catch (_) { return { uri: null, ok: false }; }
}

function buildReportSVG(model, opts) {
  opts = opts || {};
  const logo = loadLogo(opts.logoPath || path.join(__dirname, 'assets', 'almutarjem-logo.png'));
  const blocks = []; // {svg, h, x}  (local coords, translated by x at assembly)
  const push = (svg, h, x) => blocks.push({ svg, h, x: x == null ? PAD : x });
  const SEPY = 34; // gap between sections

  /* ---- header (white, logo-safe) ---- */
  (function header() {
    const H = 220; let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.white}"/>`;
    s += `<rect x="0" y="${H - 6}" width="${W}" height="6" fill="${C.blue}"/>`;
    const logoH = 150, aspect = 599 / 502, logoW = Math.round(logoH * aspect);
    if (logo.ok) s += `<image x="${PAD}" y="${(H - logoH) / 2 - 3}" height="${logoH}" width="${logoW}" href="${logo.uri}"/>`;
    else s += T(PAD, H / 2 + 6, 'ALMUTARJEM', { size: 54, weight: 800, fill: C.blue });
    const tx = PAD + (logo.ok ? logoW + 44 : 360);
    s += T(tx, 96, 'Daily Office Report', { size: 50, weight: 800, fill: C.blue });
    s += T(tx, 140, 'ALMUTARJEM TRANSLATION SERVICES', { size: 25, weight: 700, fill: C.muted });
    // meta right
    s += T(W - PAD, 84, `${model.dayName}, ${model.dateStr}`, { size: 28, weight: 700, fill: C.ink, anchor: 'end' });
    s += T(W - PAD, 122, 'Report time 20:00 GST', { size: 25, fill: C.muted, anchor: 'end' });
    const chip = 'Working Day', cw = chip.length * 16 + 40;
    s += `<rect x="${W - PAD - cw}" y="140" width="${cw}" height="42" rx="21" fill="#DCE7F4"/>` + T(W - PAD - cw / 2, 169, chip, { size: 24, weight: 700, fill: C.blue2, anchor: 'middle' });
    push(s, H, 0);
  })();

  /* ---- section header helper ---- */
  function secHead(num, title, tag) {
    const h = 66; let s = '';
    s += `<rect x="0" y="8" width="46" height="46" rx="10" fill="${C.blue}"/>` + T(23, 41, String(num), { size: 26, weight: 800, fill: '#fff', anchor: 'middle' });
    s += T(60, 42, title, { size: 34, weight: 800, fill: C.blue });
    if (tag) s += T(CW, 42, tag, { size: 24, weight: 600, fill: C.muted, anchor: 'end' });
    s += `<rect x="0" y="${h - 4}" width="${CW}" height="3" fill="${C.line}"/>`;
    return { svg: s, h };
  }
  const pushSec = (num, title, tag) => { const b = secHead(num, title, tag); push(b.svg, b.h + 14); };

  /* ---- KPI cards (3-col grid) ---- */
  function kpiGrid(cards) {
    const cols = 3, gap = 22, cardW = (CW - gap * (cols - 1)) / cols, cardH = 150, rows = Math.ceil(cards.length / cols);
    let s = '';
    cards.forEach((c, i) => {
      const cx = (i % cols) * (cardW + gap), cy = Math.floor(i / cols) * (cardH + gap);
      s += `<rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
      s += `<rect x="${cx + 22}" y="${cy + 30}" width="66" height="66" rx="14" fill="${c.accent}"/>`;
      s += T(cx + 22 + 33, cy + 30 + 44, c.ic, { size: 34, weight: 800, fill: '#fff', anchor: 'middle' });
      s += T(cx + 110, cy + 62, String(c.value), { size: 44, weight: 800, fill: C.ink });
      s += T(cx + 110, cy + 100, c.label.toUpperCase(), { size: 22, weight: 700, fill: C.muted });
      if (c.sub) s += T(cx + 110, cy + 128, c.sub, { size: 20, fill: C.muted });
    });
    return { svg: s, h: rows * cardH + (rows - 1) * gap };
  }

  /* ---- pipeline cards ---- */
  function pipeCards(cards) {
    const cols = cards.length, gap = 22, cardW = (CW - gap * (cols - 1)) / cols, cardH = 130;
    let s = '';
    cards.forEach((c, i) => {
      const cx = i * (cardW + gap);
      s += `<rect x="${cx}" y="0" width="${cardW}" height="${cardH}" rx="16" fill="${c.fill}"/>`;
      s += T(cx + 28, 52, c.label.toUpperCase(), { size: 24, weight: 700, fill: '#fff' });
      s += T(cx + 28, 104, c.value, { size: 44, weight: 800, fill: '#fff' });
    });
    return { svg: s, h: cardH };
  }

  /* ---- table (dynamic rows, wrapping, no clipping) ----
   * cols: [{title, w, align, cell(row)-> {text?, wrap?, pills?[{label,cls}], bold?, fill?, mono?}}] */
  function table(cols, rows, o) {
    o = o || {}; const fs2 = o.size || 26, lh = Math.round(fs2 * 1.28), padY = 16, headH = 54;
    let s = `<rect x="0" y="0" width="${CW}" height="${headH}" rx="10" fill="${C.blue}"/>`;
    let cx = 0;
    cols.forEach(col => { const tx = col.align === 'right' ? cx + col.w - 14 : cx + 16; s += T(tx, 37, col.title.toUpperCase(), { size: 22, weight: 700, fill: '#fff', anchor: col.align === 'right' ? 'end' : 'start' }); cx += col.w; });
    let y = headH;
    const cellMc = (w, txt) => Math.max(4, Math.floor(maxChars(w - 30, fs2) * (hasArabic(txt) ? 0.8 : 1)));
    if (!rows.length) { const h = 70; s += `<rect x="0" y="${y}" width="${CW}" height="${h}" fill="${C.soft}"/>` + T(CW / 2, y + 44, o.empty || 'No records.', { size: 25, fill: C.muted, anchor: 'middle' }); return { svg: s, h: y + h }; }
    rows.forEach((row, ri) => {
      // measure
      const cells = cols.map(col => col.cell(row));
      const linesPer = cells.map((cell, ci) => cell.pills ? 1 : wrap(cell.text != null ? cell.text : '—', cellMc(cols[ci].w, cell.text)).length);
      const nLines = Math.max(1, ...linesPer);
      const rowH = nLines * lh + 2 * padY;
      if (ri % 2) s += `<rect x="0" y="${y}" width="${CW}" height="${rowH}" fill="${C.soft}"/>`;
      cx = 0;
      cols.forEach((col, ci) => {
        const cell = cells[ci], baseY = y + padY + fs2;
        if (cell.pills) {
          let px = cx + 16;
          cell.pills.forEach(p => { const pl = pill(px, y + padY - 2, p.label, p.cls, 22); s += pl.svg; px += pl.w + 8; });
        } else {
          const txt = cell.text != null ? cell.text : '—';
          const lines = wrap(txt, cellMc(col.w, txt));
          const leftX = cx + 16, rightX = cx + col.w - 16;
          const co = { size: fs2, weight: cell.bold ? 700 : 400, fill: cell.fill || C.ink, family: cell.mono ? "'DejaVu Sans Mono', Consolas, monospace" : FONT };
          lines.forEach((ln, li) => {
            const y2 = baseY + li * lh;
            if (col.align === 'right') s += T(cx + col.w - 14, y2, ln, Object.assign({ anchor: 'end' }, co));
            else s += lineT(leftX, rightX, y2, ln, co);
          });
        }
        cx += col.w;
      });
      s += `<rect x="0" y="${y + rowH - 1}" width="${CW}" height="1" fill="${C.line}"/>`;
      y += rowH;
    });
    return { svg: s, h: y };
  }
  const pushTable = (cols, rows, o) => { const b = table(cols, rows, o); push(b.svg, b.h); };

  /* ---- panel (rounded box) with inner svg ---- */
  function panel(innerSvg, innerH, o) {
    o = o || {}; const pad = 24, h = innerH + pad * 2;
    let s = `<rect x="0" y="0" width="${CW}" height="${h}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
    if (o.accent) s += `<rect x="0" y="0" width="7" height="${h}" rx="3.5" fill="${o.accent}"/>`;
    s += `<g transform="translate(${pad},${pad})">${innerSvg}</g>`;
    return { svg: s, h };
  }

  /* ================= assemble ================= */
  const K = model.kpi;
  pushSec('★', 'Key Figures', 'Sherry — master report');
  { const b = kpiGrid([
      { ic: 'C', label: 'Total Clients', value: K.clients, accent: C.blue2, sub: '' },
      { ic: 'F', label: 'Total Files', value: K.files, accent: C.blue2, sub: '' },
      { ic: '✓', label: 'Completed Files', value: K.completed, accent: C.green, sub: 'delivered' },
      { ic: 'P', label: 'Pending Files', value: K.pending, accent: C.orange, sub: 'in progress' },
      { ic: '$', label: 'Confirmed Revenue', value: AED(K.revenue), accent: C.purple, sub: 'non-cancelled' },
      { ic: '%', label: 'Confirmation Rate', value: K.confRate + '%', accent: C.blue, sub: K.completed + ' of ' + K.files + ' completed' },
    ]); push(b.svg, b.h + SEPY); }

  const P = model.pipeline;
  pushSec('≡', 'Pipeline');
  { const b = pipeCards([
      { label: 'Confirmed Revenue', value: AED(P.confirmed), fill: C.green },
      { label: 'Potential Revenue', value: AED(P.potential), fill: C.orange },
      { label: 'Total Pipeline', value: AED(P.total), fill: C.purple },
    ]); push(b.svg, b.h + SEPY); }

  pushSec('1', 'Sherry — Master Report', model.kpi.files + ' file(s) received');
  pushTable([
    { title: '#', w: 70, cell: (r) => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 420, cell: (r) => ({ text: r.client || '—', bold: true }) },
    { title: 'ATS / Ref', w: 360, cell: (r) => ({ text: (r.ref && r.ref !== '0') ? r.ref : '—', mono: true, fill: C.muted }) },
    { title: 'Type', w: 340, cell: (r) => ({ text: r.service || '—' }) },
    { title: 'Language', w: 340, cell: (r) => ({ text: r.notes || '—' }) },
    { title: 'Amount', w: 300, align: 'right', cell: (r) => ({ text: AED(r.amount), bold: true }) },
    { title: 'Status', w: CW - 70 - 420 - 360 - 340 - 340 - 300, cell: (r) => ({ pills: [{ label: r.status, cls: payClass(r.status) }, { label: r.fileStatus, cls: fileClass(r.fileStatus) }] }) },
  ], model.sherry.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No Sherry files received today.' });
  push('', SEPY);

  pushSec('2', 'Customer Replies (Rawan)');
  { // Group A
    push(T(0, 30, 'Group A · Matched Files (' + model.matchedList.length + ')', { size: 27, weight: 800, fill: C.green }), 46);
    pushTable([
      { title: '#', w: 70, cell: (r) => ({ text: String(r._i), fill: C.muted, bold: true }) },
      { title: 'Client', w: 520, cell: (r) => ({ text: (r._amb ? '⚠ ' : '') + (r.client || '—'), bold: true }) },
      { title: 'Sherry', w: 300, cell: (r) => ({ pills: [{ label: r.status, cls: payClass(r.status) }] }) },
      { title: 'Reason', w: 700, cell: (r) => ({ text: r.notes || '—' }) },
      { title: 'Reply', w: CW - 70 - 520 - 300 - 700, cell: (r) => ({ pills: [{ label: r.outcome || '—', cls: outcomeClass(r.outcome) }] }) },
    ], model.matchedList.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No matched files today.' });
    push('', 18);
    // Group B
    push(T(0, 30, 'Group B · No Customer Reply Yet (' + model.noReply.length + ')', { size: 27, weight: 800, fill: C.orange }), 46);
    pushTable([
      { title: '#', w: 70, cell: (r) => ({ text: String(r._i), fill: C.muted, bold: true }) },
      { title: 'Client', w: 620, cell: (r) => ({ text: r.client || '—', bold: true }) },
      { title: 'ATS / Ref', w: 460, cell: (r) => ({ text: (r.ref && r.ref !== '0') ? r.ref : '—', mono: true, fill: C.muted }) },
      { title: 'Amount', w: 320, align: 'right', cell: (r) => ({ text: AED(r.amount), bold: true }) },
      { title: 'File', w: CW - 70 - 620 - 460 - 320, cell: (r) => ({ pills: [{ label: r.fileStatus, cls: fileClass(r.fileStatus) }] }) },
    ], model.noReply.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'Every Sherry file has a customer reply.' });
    push('', SEPY);
  }

  pushSec('3', 'Customer Follow-Up', model.follow.length + ' pending / not agreed — all shown');
  pushTable([
    { title: '#', w: 70, cell: (r) => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 560, cell: (r) => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 320, align: 'right', cell: (r) => ({ text: AED(r.amount), bold: true }) },
    { title: 'Status', w: 380, cell: (r) => ({ pills: [{ label: r.outcome || r.status || '—', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 70 - 560 - 320 - 380, cell: (r) => ({ text: r.notes || '—' }) },
  ], model.follow.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No pending follow-ups.' });
  push('', SEPY);

  pushSec('4', 'High Priority', 'by highest revenue opportunity');
  pushTable([
    { title: 'Rank', w: 120, cell: (r) => ({ text: String(r._i), bold: true, fill: C.red }) },
    { title: 'Client', w: 560, cell: (r) => ({ text: r.client || '—', bold: true }) },
    { title: 'Opportunity', w: 360, align: 'right', cell: (r) => ({ text: AED(r.amount), bold: true, fill: C.purple }) },
    { title: 'Status', w: 340, cell: (r) => ({ pills: [{ label: r.outcome || '—', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 120 - 560 - 360 - 340, cell: (r) => ({ text: r.notes || '—' }) },
  ], model.priority.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No revenue opportunities open.' });
  push('', SEPY);

  pushSec('5', 'Reason Summary');
  { const rows = model.reasons; const max = Math.max(1, ...rows.map(r => r[1])); const barH = 40, gap = 22, lblW = 360, valW = 90;
    let inner = ''; let yy = 0;
    if (!rows.length) inner = T(0, 30, 'No customer replies to summarise.', { size: 25, fill: C.muted });
    rows.forEach(([name, n]) => {
      const trackW = CW - 48 - lblW - valW;
      inner += T(lblW - 16, yy + barH - 12, name, { size: 25, weight: 600, anchor: 'end' });
      inner += `<rect x="${lblW}" y="${yy}" width="${trackW}" height="${barH}" rx="${barH / 2}" fill="#ECEFF4"/>`;
      inner += `<rect x="${lblW}" y="${yy}" width="${Math.max(barH, Math.round(trackW * n / max))}" height="${barH}" rx="${barH / 2}" fill="${PILLFG[outcomeClass(name)] || C.muted}"/>`;
      inner += T(lblW + trackW + 20, yy + barH - 12, String(n), { size: 26, weight: 800 });
      yy += barH + gap;
    });
    const b = panel(inner, Math.max(30, yy - gap)); push(b.svg, b.h + SEPY);
  }

  pushSec('6', 'Revenue Opportunity');
  { const b = pipeCards([
      { label: 'Open Opportunity', value: AED(P.potential), fill: C.purple },
      { label: 'Already Confirmed', value: AED(P.confirmed), fill: C.green },
      { label: 'Conversion Upside', value: (P.confirmed ? Math.round(P.potential / P.confirmed * 100) : 0) + '%', fill: C.orange },
    ]); push(b.svg, b.h + SEPY); }

  pushSec('7', 'Daily Business Analysis');
  { const lines = [
      `Files received today: ${K.files} from ${K.clients} client(s).`,
      `Delivery: ${K.completed} completed, ${K.pending} pending (${K.confRate}% done).`,
      `Confirmed revenue booked: ${AED(K.revenue)}.`,
      `Open pipeline in follow-up: ${AED(P.potential)} across ${model.follow.length} lead(s).`,
      `Customer replies: ${model.recon.matched} matched, ${model.recon.unmatched} unmatched, ${model.recon.ambiguous} ambiguous, ${model.recon.duplicates} duplicate ref(s).`,
      `Total business in play today: ${AED(P.total)}.`,
    ];
    let inner = ''; let yy = 30; lines.forEach(l => { inner += lineT(0, CW - 48, yy, l, { size: 26 }); yy += 42; });
    const b = panel(inner, yy - 20); push(b.svg, b.h + SEPY);
  }

  pushSec('8', 'AI Recommendation');
  { let inner = T(0, 26, '◆ GENERATED FROM TODAY\'S DATA', { size: 22, weight: 800, fill: C.purple }); let yy = 70;
    model.recs.forEach(r => { const lines = wrap('•  ' + r, Math.floor(maxChars(CW - 48, 26) * (hasArabic(r) ? 0.8 : 1))); lines.forEach((ln, li) => { inner += lineT(li ? 34 : 0, CW - 48, yy, ln, { size: 26 }); yy += 38; }); yy += 8; });
    const b = panel(inner, yy - 20, { accent: C.purple }); push(b.svg, b.h + SEPY);
  }

  /* validation footer */
  { const v = model.validation; const vc = v.ok ? C.green : C.orange;
    let inner = T(0, 30, (v.ok ? '✓ VALIDATION PASSED' : '⚠ VALIDATION NOTES') + ' — reconciliation ' + (v.reconciles ? 'balanced' : 'GAP'), { size: 24, weight: 800, fill: vc });
    let yy = 66; (v.issues.length ? v.issues : ['No data-quality issues detected.']).forEach(is => { inner += lineT(0, CW - 48, yy, '• ' + is, { size: 23, fill: C.muted }); yy += 34; });
    const b = panel(inner, yy - 20); push(b.svg, b.h + 20);
  }

  /* footer line */
  push(T(0, 30, 'ALMUTARJEM Translation Services · Daily Office Report · KPI cards calculated from Sherry (master) · Generated automatically', { size: 22, fill: C.muted }), 50);

  /* ---- assemble with dynamic height ---- */
  let y = 0, body = '';
  blocks.forEach(b => { if (b.svg) body += `<g transform="translate(${b.x},${y})">${b.svg}</g>`; y += b.h; });
  const H = y + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#FFFFFF"/>` +
    body + `</svg>`;
  return { svg, width: W, height: H, logoOk: logo.ok };
}

/* ============================================================================
 * RASTERISE — Sharp primary, @resvg/resvg-js fallback (both prebuilt, no Chrome)
 * ========================================================================== */
async function rasterise(svg, outPath) {
  // 1) Sharp
  try {
    const sharp = require('sharp');
    const info = await sharp(Buffer.from(svg)).png().toFile(outPath);
    return { renderer: 'sharp', width: info.width, height: info.height, size: fs.statSync(outPath).size };
  } catch (eSharp) {
    // 2) resvg-js
    try {
      const { Resvg } = require('@resvg/resvg-js');
      const r = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
      const png = r.render().asPng();
      fs.writeFileSync(outPath, png);
      const sz = _pngSize(png);
      return { renderer: 'resvg-js', width: sz.w, height: sz.h, size: png.length };
    } catch (eResvg) {
      const err = new Error('No SVG rasteriser available. sharp: ' + eSharp.message + ' | resvg-js: ' + eResvg.message);
      err.noRenderer = true; throw err;
    }
  }
}
function _pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

async function renderReportPNG(model, outPath, opts) {
  const { svg, width, height, logoOk } = buildReportSVG(model, opts);
  const r = await rasterise(svg, outPath);
  return { path: outPath, width: r.width, height: r.height, size: r.size, renderer: r.renderer, logoOk, svgWidth: width, svgHeight: height };
}

module.exports = { computeModel, buildReportSVG, renderReportPNG, rasterise, _pngSize, W };
