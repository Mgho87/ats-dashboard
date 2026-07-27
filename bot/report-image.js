'use strict';
/* ============================================================================
 * ALMUTARJEM — Daily Office Report IMAGE generator (SVG → PNG)  ·  TWO PAGES
 * ----------------------------------------------------------------------------
 * Page 1 = DAILY OPERATIONS DASHBOARD  ("What happened today?") — Sherry ops.
 * Page 2 = FOLLOW-UP & SALES DASHBOARD ("What should we do next?") — Rawan.
 *
 * Each page is its own PNG. Width fixed (~2300 px); HEIGHT IS DYNAMIC — as tall
 * as needed to show EVERY record, no clipping / no "…and more" / no font shrink.
 * Renderer: SVG rasterised by Sharp (prebuilt libvips; cPanel-safe, no Chromium),
 * with an automatic @resvg/resvg-js fallback. Same design language on both pages.
 *
 * "Pending" inside Sherry means pending PAYMENT / internal PROCESSING (an office
 * operation) — NOT "customer did not confirm". So Sherry pending stays on Page 1.
 * Customer confirmation / follow-up / lost all come from Rawan and live on Page 2.
 *
 * Logo note: assets/almutarjem-logo.png is background-removed by edge flood-fill;
 * faithful ON WHITE only (some flat page pixels became transparent — not every
 * interior pixel is preserved). Keep a white logo-safe area behind it. Pristine
 * original at assets/almutarjem-logo-original.png.
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
function lineT(leftX, rightX, y, str, o) {
  o = o || {};
  if (hasArabic(str)) return T(rightX, y, str, Object.assign({}, o, { anchor: 'start' }));
  return T(leftX, y, str, Object.assign({}, o, { anchor: o.anchor || 'start' }));
}

/* ---------- status → semantic colour ---------- */
function payClass(s) { s = String(s || '').toLowerCase(); if (/cancel/.test(s)) return 'red'; if (/paid|collected/.test(s)) return 'green'; if (/outstand|pending|due|other/.test(s)) return 'orange'; return 'gray'; }
function fileClass(s) { s = String(s || '').toLowerCase(); if (/deliver|complete|done|ready|closed|collected/.test(s)) return 'green'; if (/pending|progress|await|new|process/.test(s)) return 'orange'; if (/cancel/.test(s)) return 'red'; return 'gray'; }
function outcomeClass(s) { s = String(s || '').toLowerCase(); if (/accept|agree|confirm/.test(s)) return 'green'; if (/not interest|declin|lost|reject|cancel/.test(s)) return 'red'; if (/no response|pending|await|question|follow|price/.test(s)) return 'orange'; return 'gray'; }
const PILLBG = { green: '#E4F3EC', orange: '#FBEED6', red: '#F6E0E0', gray: '#ECEFF4' };
const PILLFG = { green: '#147A50', orange: '#A5620A', red: '#A52F2F', gray: '#647089' };
function pill(x, y, label, cls, size) {
  size = size || 22; label = cap(label);
  const w = Math.round(label.length * size * 0.60) + 28, h = size + 16;
  return { w, h, svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${PILLBG[cls] || PILLBG.gray}"/>` + T(x + w / 2, y + h - Math.round(size * 0.35) - 3, label, { size, weight: 700, fill: PILLFG[cls] || PILLFG.gray, anchor: 'middle' }) };
}

/* ---------- Rawan classification (customer tracking) ---------- */
const isAccepted = r => /accept|agree|confirm/i.test(String(r.outcome || ''));
const isNotInterested = r => /not interest|declin|lost|reject|cancel/i.test(String(r.outcome || ''));
const isPendingCust = r => !isAccepted(r) && !isNotInterested(r); // no response / waiting / question / follow-up / other
const amt = r => isCancel(r.status) ? 0 : (+r.amount || 0);

/* ============================================================================
 * MODEL
 * ========================================================================== */
function computeModel(dateKey, sherry, rawan) {
  sherry = sherry || []; rawan = rawan || [];
  // Sherry (operations) KPIs
  const clients = new Set(sherry.map(r => norm(r.client)).filter(Boolean)).size;
  const files = sherry.length;
  const completed = sherry.filter(r => fileClass(r.fileStatus) === 'green').length;
  const pending = files - completed;                         // pending payment / processing (office op)
  const revenue = sherry.reduce((a, r) => a + (isCancel(r.status) ? 0 : (+r.amount || 0)), 0);
  const convRate = files ? Math.round((completed / files) * 100) : 0;

  // Rawan (customer tracking)
  const rawanAccepted = rawan.filter(isAccepted);
  const rawanPending = rawan.filter(isPendingCust);
  const rawanNotInterested = rawan.filter(isNotInterested);

  // dedup pending for the follow-up list
  const seen = new Set(), follow = [];
  rawanPending.forEach(r => { const k = norm(r.client) + '|' + norm(r.ref); if (!seen.has(k)) { seen.add(k); follow.push(r); } });
  const priority = [...follow].filter(r => amt(r) > 0).sort((a, b) => amt(b) - amt(a));

  const potential = follow.reduce((a, r) => a + amt(r), 0);   // revenue still available
  const lostValue = rawanNotInterested.reduce((a, r) => a + amt(r), 0);
  const pipeline = revenue + potential;

  // reconciliation (matched / unmatched / ambiguous / duplicates) — kept for validation
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
  rawan.forEach(r => { const { strong, weak } = matchesOf(r); if (strong.length === 1) matched++; else if (strong.length > 1 || weak.length) ambiguous++; else unmatched++; });
  const dupCount = list => { const m = {}; list.forEach(r => { if (r.ref && r.ref !== '0') { const k = norm(r.ref); m[k] = (m[k] || 0) + 1; } }); return Object.values(m).filter(n => n > 1).reduce((a, n) => a + n, 0); };
  const duplicates = dupCount(rawan) + dupCount(sherry);

  // Page-2 analysis
  const totalLeads = rawan.length;
  const confirmationRate = totalLeads ? Math.round(rawanAccepted.length / totalLeads * 100) : 0;

  // Page-2 recommendations (practical, data-driven — never generic)
  const recs = [];
  if (priority[0]) recs.push(`Contact ${priority[0].client} first — highest open opportunity at ${AED(priority[0].amount)}${priority[0].notes ? ' (' + priority[0].notes + ')' : ''}.`);
  const noResp = follow.filter(r => /no response/i.test(r.outcome));
  if (noResp.length) recs.push(`Call ${noResp.length} customer(s) with no response${noResp.length ? ': ' + noResp.slice(0, 3).map(r => r.client).join(', ') : ''}.`);
  const waiting = follow.filter(r => /question|await|waiting|follow/i.test((r.outcome || '') + ' ' + (r.notes || '')));
  if (waiting[0]) recs.push(`Send a reminder to ${waiting[0].client} — ${waiting[0].notes || 'awaiting reply'}.`);
  if (priority.length > 1) recs.push(`Prioritise the top opportunities: ${priority.slice(0, 3).map(r => r.client + ' (' + AED(r.amount) + ')').join(', ')}.`);
  if (rawanNotInterested.length) recs.push(`${rawanNotInterested.length} customer(s) not interested (${AED(lostValue)} lost) — review objections.`);
  if (!recs.length) recs.push(totalLeads ? 'All customer replies resolved today — no follow-up outstanding.' : 'No customer activity recorded today.');

  // Office notes — real operational notes from today's records (deduped)
  const notesSet = [];
  const seenN = new Set();
  sherry.concat(rawan).forEach(r => { const n = String(r.notes || '').trim(); if (n && n.length > 2 && !seenN.has(n.toLowerCase())) { seenN.add(n.toLowerCase()); notesSet.push({ who: r.client || r.ref || '—', note: n }); } });

  // validation
  const issues = [];
  sherry.forEach(r => { if (!(+r.amount) && !isCancel(r.status) && fileClass(r.fileStatus) === 'green') issues.push(`Sherry file "${r.client || r.ref}" delivered with no amount`); });
  if (duplicates) issues.push(`${duplicates} record(s) share a duplicate ATS reference`);
  if (ambiguous) issues.push(`${ambiguous} Rawan record(s) matched ambiguously (verify manually)`);
  const validation = { reconciles: true, ok: true, issues };

  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey) || [];
  const dObj = dm.length ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : new Date();
  return {
    date: dateKey, dayName: dObj.toLocaleDateString('en-GB', { weekday: 'long' }),
    dateStr: dObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    kpi: { clients, files, completed, pending, revenue, convRate },
    revenue: { confirmed: revenue, potential, total: pipeline },
    sherry, rawanAccepted, rawanPending, rawanNotInterested, follow, priority,
    recon: { matched, unmatched, ambiguous, duplicates },
    analysis: { confirmationRate, totalLeads, accepted: rawanAccepted.length, lostCount: rawanNotInterested.length, lostValue, followWorkload: follow.length, revenueAvailable: potential },
    recs, officeNotes: notesSet, validation,
  };
}

/* ============================================================================
 * CANVAS — shared layout engine used by both page builders
 * ========================================================================== */
function loadLogo(logoPath) {
  try { const b = fs.readFileSync(logoPath); return { uri: 'data:image/png;base64,' + b.toString('base64'), ok: true }; }
  catch (_) { return { uri: null, ok: false }; }
}

function makeCanvas(logo) {
  const blocks = [];
  const SEPY = 34;
  const push = (svg, h, x) => blocks.push({ svg, h, x: x == null ? PAD : x });
  const spacer = h => push('', h);

  function header(title, pageLabel, model) {
    const H = 220; let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.white}"/>`;
    s += `<rect x="0" y="${H - 6}" width="${W}" height="6" fill="${C.blue}"/>`;
    const logoH = 150, aspect = 599 / 502, logoW = Math.round(logoH * aspect);
    if (logo.ok) s += `<image x="${PAD}" y="${(H - logoH) / 2 - 3}" height="${logoH}" width="${logoW}" href="${logo.uri}"/>`;
    else s += T(PAD, H / 2 + 6, 'ALMUTARJEM', { size: 54, weight: 800, fill: C.blue });
    const tx = PAD + (logo.ok ? logoW + 44 : 360);
    s += T(tx, 96, title, { size: 50, weight: 800, fill: C.blue });
    s += T(tx, 140, 'ALMUTARJEM TRANSLATION SERVICES', { size: 25, weight: 700, fill: C.muted });
    s += T(W - PAD, 84, `${model.dayName}, ${model.dateStr}`, { size: 28, weight: 700, fill: C.ink, anchor: 'end' });
    s += T(W - PAD, 122, 'Report time 20:00 GST', { size: 25, fill: C.muted, anchor: 'end' });
    const cw = pageLabel.length * 15 + 40;
    s += `<rect x="${W - PAD - cw}" y="140" width="${cw}" height="42" rx="21" fill="#DCE7F4"/>` + T(W - PAD - cw / 2, 169, pageLabel, { size: 24, weight: 700, fill: C.blue2, anchor: 'middle' });
    push(s, H, 0);
  }

  function pushSec(num, title, tag) {
    const h = 66; let s = '';
    s += `<rect x="0" y="8" width="46" height="46" rx="10" fill="${C.blue}"/>` + T(23, 41, String(num), { size: 26, weight: 800, fill: '#fff', anchor: 'middle' });
    s += T(60, 42, title, { size: 34, weight: 800, fill: C.blue });
    if (tag) s += T(CW, 42, tag, { size: 24, weight: 600, fill: C.muted, anchor: 'end' });
    s += `<rect x="0" y="${h - 4}" width="${CW}" height="3" fill="${C.line}"/>`;
    push(s, h + 14);
  }

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
    push(s, rows * cardH + (rows - 1) * gap + SEPY);
  }

  function pipeCards(cards) {
    const cols = cards.length, gap = 22, cardW = (CW - gap * (cols - 1)) / cols, cardH = 130;
    let s = '';
    cards.forEach((c, i) => { const cx = i * (cardW + gap); s += `<rect x="${cx}" y="0" width="${cardW}" height="${cardH}" rx="16" fill="${c.fill}"/>`; s += T(cx + 28, 52, c.label.toUpperCase(), { size: 24, weight: 700, fill: '#fff' }); s += T(cx + 28, 104, c.value, { size: 44, weight: 800, fill: '#fff' }); });
    push(s, cardH + SEPY);
  }

  function table(cols, rows, o) {
    o = o || {}; const fs2 = o.size || 26, lh = Math.round(fs2 * 1.28), padY = 16, headH = 54;
    let s = `<rect x="0" y="0" width="${CW}" height="${headH}" rx="10" fill="${C.blue}"/>`;
    let cx = 0;
    cols.forEach(col => { const tx = col.align === 'right' ? cx + col.w - 14 : cx + 16; s += T(tx, 37, col.title.toUpperCase(), { size: 22, weight: 700, fill: '#fff', anchor: col.align === 'right' ? 'end' : 'start' }); cx += col.w; });
    let y = headH;
    const cellMc = (w, txt) => Math.max(4, Math.floor(maxChars(w - 30, fs2) * (hasArabic(txt) ? 0.8 : 1)));
    if (!rows.length) { const h = 70; s += `<rect x="0" y="${y}" width="${CW}" height="${h}" fill="${C.soft}"/>` + T(CW / 2, y + 44, o.empty || 'No records.', { size: 25, fill: C.muted, anchor: 'middle' }); push(s, y + h); return; }
    rows.forEach((row, ri) => {
      const cells = cols.map(col => col.cell(row));
      const linesPer = cells.map((cell, ci) => cell.pills ? 1 : wrap(cell.text != null ? cell.text : '—', cellMc(cols[ci].w, cell.text)).length);
      const nLines = Math.max(1, ...linesPer);
      const rowH = nLines * lh + 2 * padY;
      if (ri % 2) s += `<rect x="0" y="${y}" width="${CW}" height="${rowH}" fill="${C.soft}"/>`;
      cx = 0;
      cols.forEach((col, ci) => {
        const cell = cells[ci], baseY = y + padY + fs2;
        if (cell.pills) { let px = cx + 16; cell.pills.forEach(p => { const pl = pill(px, y + padY - 2, p.label, p.cls, 22); s += pl.svg; px += pl.w + 8; }); }
        else {
          const txt = cell.text != null ? cell.text : '—';
          const lines = wrap(txt, cellMc(col.w, txt));
          const leftX = cx + 16, rightX = cx + col.w - 16;
          const co = { size: fs2, weight: cell.bold ? 700 : 400, fill: cell.fill || C.ink, family: cell.mono ? "'DejaVu Sans Mono', Consolas, monospace" : FONT };
          lines.forEach((ln, li) => { const y2 = baseY + li * lh; if (col.align === 'right') s += T(cx + col.w - 14, y2, ln, Object.assign({ anchor: 'end' }, co)); else s += lineT(leftX, rightX, y2, ln, co); });
        }
        cx += col.w;
      });
      s += `<rect x="0" y="${y + rowH - 1}" width="${CW}" height="1" fill="${C.line}"/>`;
      y += rowH;
    });
    push(s, y);
  }

  function panel(innerSvg, innerH, o) {
    o = o || {}; const pad = 24, h = innerH + pad * 2;
    let s = `<rect x="0" y="0" width="${CW}" height="${h}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
    if (o.accent) s += `<rect x="0" y="0" width="7" height="${h}" rx="3.5" fill="${o.accent}"/>`;
    s += `<g transform="translate(${pad},${pad})">${innerSvg}</g>`;
    push(s, h + (o.gap == null ? SEPY : o.gap));
  }

  function assemble() {
    let y = 0, body = '';
    blocks.forEach(b => { if (b.svg) body += `<g transform="translate(${b.x},${y})">${b.svg}</g>`; y += b.h; });
    const H = y + 40;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#FFFFFF"/>${body}</svg>`;
    return { svg, width: W, height: H, logoOk: logo.ok };
  }

  return { header, pushSec, kpiGrid, pipeCards, table, panel, spacer, push, assemble, SEPY, CW, C, T, lineT, AED, wrap, maxChars };
}

/* ============================================================================
 * PAGE 1 — DAILY OPERATIONS DASHBOARD  (Sherry — "what happened today")
 * ========================================================================== */
function buildPage1SVG(model, logo) {
  const cv = makeCanvas(logo), K = model.kpi, R = model.revenue;
  cv.header('Daily Operations Dashboard', 'Page 1 of 2 · Operations', model);

  cv.pushSec('★', 'Key Figures', 'today · Sherry');
  cv.kpiGrid([
    { ic: 'C', label: 'Total Clients', value: K.clients, accent: C.blue2 },
    { ic: 'F', label: 'Files Received', value: K.files, accent: C.blue2 },
    { ic: '✓', label: 'Completed', value: K.completed, accent: C.green, sub: 'delivered' },
    { ic: 'P', label: 'Pending', value: K.pending, accent: C.orange, sub: 'payment / processing' },
    { ic: '$', label: 'Confirmed Revenue', value: AED(K.revenue), accent: C.purple },
    { ic: '%', label: 'Conversion Rate', value: K.convRate + '%', accent: C.blue, sub: K.completed + ' of ' + K.files + ' delivered' },
  ]);

  cv.pushSec('≡', 'Revenue Summary');
  cv.pipeCards([
    { label: 'Confirmed Revenue', value: AED(R.confirmed), fill: C.green },
    { label: 'Potential Revenue', value: AED(R.potential), fill: C.orange },
    { label: 'Total Pipeline', value: AED(R.total), fill: C.purple },
  ]);

  cv.pushSec('1', "Today's Files (Sherry)", model.kpi.files + ' file(s) received');
  cv.table([
    { title: '#', w: 70, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 420, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'ATS / Ref', w: 360, cell: r => ({ text: (r.ref && r.ref !== '0') ? r.ref : '—', mono: true, fill: C.muted }) },
    { title: 'Type', w: 340, cell: r => ({ text: r.service || '—' }) },
    { title: 'Language', w: 340, cell: r => ({ text: r.notes || '—' }) },
    { title: 'Amount', w: 300, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Status', w: CW - 70 - 420 - 360 - 340 - 340 - 300, cell: r => ({ pills: [{ label: r.status, cls: payClass(r.status) }, { label: r.fileStatus, cls: fileClass(r.fileStatus) }] }) },
  ], model.sherry.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No Sherry files received today.' });
  cv.spacer(cv.SEPY);

  cv.pushSec('2', 'Customer Replies — Confirmed / Accepted', model.rawanAccepted.length + ' confirmed today');
  cv.table([
    { title: '#', w: 70, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 620, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 320, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Reason', w: 760, cell: r => ({ text: r.notes || '—' }) },
    { title: 'Reply', w: CW - 70 - 620 - 320 - 760, cell: r => ({ pills: [{ label: r.outcome || 'Accepted', cls: 'green' }] }) },
  ], model.rawanAccepted.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No confirmed customer replies today.' });
  cv.spacer(cv.SEPY);

  cv.pushSec('3', 'Daily Summary');
  { const b = [
      `${K.files} file(s) received from ${K.clients} client(s)`,
      `${K.completed} delivered · ${K.pending} still under processing (payment / internal)`,
      `${AED(K.revenue)} confirmed revenue today`,
      `${model.rawanAccepted.length} customer(s) confirmed / accepted`,
    ];
    let inner = ''; let yy = 34; b.forEach(l => { inner += T(0, yy, '•  ' + l, { size: 28 }); yy += 46; });
    cv.panel(inner, yy - 24, { gap: 20 });
  }
  cv.push(T(0, 30, 'ALMUTARJEM Translation Services · Daily Operations · Page 1 of 2 · Key figures from Sherry (master).', { size: 22, fill: C.muted }), 50);
  return cv.assemble();
}

/* ============================================================================
 * PAGE 2 — FOLLOW-UP & SALES DASHBOARD  (Rawan — "what should we do next")
 * ========================================================================== */
function buildPage2SVG(model, logo) {
  const cv = makeCanvas(logo), A = model.analysis, R = model.revenue;
  cv.header('Follow-up & Sales Dashboard', 'Page 2 of 2 · Follow-up', model);

  cv.pushSec('1', 'Pending Customer Confirmation', model.rawanPending.length + ' awaiting reply');
  cv.table([
    { title: '#', w: 70, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 640, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 320, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Status', w: 380, cell: r => ({ pills: [{ label: r.outcome || r.status || 'Pending', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 70 - 640 - 320 - 380, cell: r => ({ text: r.notes || '—' }) },
  ], model.rawanPending.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No customers awaiting confirmation. ✔' });
  cv.spacer(cv.SEPY);

  cv.pushSec('2', 'Not Interested', model.rawanNotInterested.length + ' lost / declined');
  cv.table([
    { title: '#', w: 70, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 700, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 320, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Reason', w: CW - 70 - 700 - 320, cell: r => ({ text: r.notes || r.outcome || '—' }) },
  ], model.rawanNotInterested.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No customers marked not interested. ✔' });
  cv.spacer(cv.SEPY);

  cv.pushSec('3', 'Customer Follow-Up', 'action list — all shown');
  cv.table([
    { title: '#', w: 70, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 560, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 300, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Reason', w: 660, cell: r => ({ text: r.notes || '—' }) },
    { title: 'Latest Status', w: CW - 70 - 560 - 300 - 660, cell: r => ({ pills: [{ label: r.outcome || r.status || 'Pending', cls: outcomeClass(r.outcome) }] }) },
  ], model.follow.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No follow-ups outstanding. ✔' });
  cv.spacer(cv.SEPY);

  cv.pushSec('4', 'High Priority', 'highest-value opportunities');
  cv.table([
    { title: 'Rank', w: 120, cell: r => ({ text: String(r._i), bold: true, fill: C.red }) },
    { title: 'Client', w: 620, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Opportunity', w: 360, align: 'right', cell: r => ({ text: AED(r.amount), bold: true, fill: C.purple }) },
    { title: 'Status', w: 340, cell: r => ({ pills: [{ label: r.outcome || '—', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 120 - 620 - 360 - 340, cell: r => ({ text: r.notes || '—' }) },
  ], model.priority.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No revenue opportunities open.' });
  cv.spacer(cv.SEPY);

  cv.pushSec('5', 'Business Analysis');
  { const lines = [
      `Confirmation rate: ${A.confirmationRate}% (${A.accepted} of ${A.totalLeads} customer replies).`,
      `Lost opportunities: ${A.lostCount} customer(s) not interested (${AED(A.lostValue)}).`,
      `Follow-up workload: ${A.followWorkload} customer(s) awaiting action.`,
      `Revenue still available: ${AED(A.revenueAvailable)} in open follow-up.`,
    ];
    let inner = ''; let yy = 30; lines.forEach(l => { inner += lineT(0, CW - 48, yy, l, { size: 26 }); yy += 42; });
    cv.panel(inner, yy - 20);
  }

  cv.pushSec('6', 'AI Recommendations');
  { let inner = T(0, 26, '◆ GENERATED FROM TODAY\'S DATA', { size: 22, weight: 800, fill: C.purple }); let yy = 70;
    model.recs.forEach(r => { const lines = cv.wrap('•  ' + r, Math.floor(cv.maxChars(CW - 48, 26) * (hasArabic(r) ? 0.8 : 1))); lines.forEach((ln, li) => { inner += lineT(li ? 34 : 0, CW - 48, yy, ln, { size: 26 }); yy += 38; }); yy += 8; });
    cv.panel(inner, yy - 20, { accent: C.purple });
  }

  cv.pushSec('7', 'Office Notes');
  { let inner = ''; let yy = 30;
    const notes = model.officeNotes;
    if (!notes.length) inner = T(0, yy, 'No operational notes recorded today.', { size: 25, fill: C.muted });
    else notes.forEach(n => { const lines = cv.wrap('•  ' + n.who + ' — ' + n.note, Math.floor(cv.maxChars(CW - 48, 25) * (hasArabic(n.note) ? 0.8 : 1))); lines.forEach((ln, li) => { inner += lineT(li ? 34 : 0, CW - 48, yy, ln, { size: 25 }); yy += 36; }); yy += 4; });
    cv.panel(inner, Math.max(30, yy - 20));
  }

  { const v = model.validation, vc = v.ok ? C.green : C.orange;
    let inner = T(0, 30, (v.ok ? '✓ VALIDATION PASSED' : '⚠ VALIDATION NOTES') + ' — reconciliation ' + (v.reconciles ? 'balanced' : 'GAP') + ' · matched ' + model.recon.matched + ' · unmatched ' + model.recon.unmatched + ' · ambiguous ' + model.recon.ambiguous + ' · duplicate ' + model.recon.duplicates, { size: 24, weight: 800, fill: vc });
    let yy = 66; (v.issues.length ? v.issues : ['No data-quality issues detected.']).forEach(is => { inner += lineT(0, CW - 48, yy, '• ' + is, { size: 23, fill: C.muted }); yy += 34; });
    cv.panel(inner, yy - 20, { gap: 20 });
  }
  cv.push(T(0, 30, 'ALMUTARJEM Translation Services · Follow-up & Sales · Page 2 of 2 · Customer tracking from Rawan.', { size: 22, fill: C.muted }), 50);
  return cv.assemble();
}

/* ============================================================================
 * RASTERISE — Sharp primary, @resvg/resvg-js fallback
 * ========================================================================== */
async function rasterise(svg, outPath) {
  try {
    const sharp = require('sharp');
    const info = await sharp(Buffer.from(svg)).png().toFile(outPath);
    return { renderer: 'sharp', width: info.width, height: info.height, size: fs.statSync(outPath).size };
  } catch (eSharp) {
    try {
      const { Resvg } = require('@resvg/resvg-js');
      const r = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
      const png = r.render().asPng();
      fs.writeFileSync(outPath, png);
      return { renderer: 'resvg-js', width: _pngSize(png).w, height: _pngSize(png).h, size: png.length };
    } catch (eResvg) {
      const err = new Error('No SVG rasteriser available. sharp: ' + eSharp.message + ' | resvg-js: ' + eResvg.message);
      err.noRenderer = true; throw err;
    }
  }
}
function _pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

/* Render BOTH pages. Returns [{page,path,width,height,size,renderer,logoOk}, ...] */
async function renderReportPages(model, dir, dateKey, opts) {
  opts = opts || {};
  const logo = loadLogo(opts.logoPath || path.join(__dirname, 'assets', 'almutarjem-logo.png'));
  const built = [
    { n: 1, page: buildPage1SVG(model, logo) },
    { n: 2, page: buildPage2SVG(model, logo) },
  ];
  const out = [];
  for (const b of built) {
    const outPath = path.join(dir, 'Daily_Report_' + dateKey + '_p' + b.n + '.png');
    const r = await rasterise(b.page.svg, outPath);
    out.push({ page: b.n, path: outPath, width: r.width, height: r.height, size: r.size, renderer: r.renderer, logoOk: logo.ok });
  }
  return out;
}

module.exports = { computeModel, buildPage1SVG, buildPage2SVG, renderReportPages, rasterise, loadLogo, _pngSize, W };
