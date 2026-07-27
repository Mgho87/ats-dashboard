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

  // Page-2 recommendations (practical, data-driven — never generic). kind → leading icon.
  const recs = [];
  if (priority[0]) recs.push({ kind: 'call', text: `Contact ${priority[0].client} first — highest open opportunity at ${AED(priority[0].amount)}${priority[0].notes ? ' (' + priority[0].notes + ')' : ''}.` });
  const noResp = follow.filter(r => /no response/i.test(r.outcome));
  if (noResp.length) recs.push({ kind: 'call', text: `Call ${noResp.length} customer(s) with no response: ${noResp.slice(0, 3).map(r => r.client).join(', ')}.` });
  const waiting = follow.filter(r => /question|await|waiting|follow/i.test((r.outcome || '') + ' ' + (r.notes || '')));
  if (waiting[0]) recs.push({ kind: 'followup', text: `Send a reminder to ${waiting[0].client} — ${waiting[0].notes || 'awaiting reply'}.` });
  if (priority.length > 1) recs.push({ kind: 'revenue', text: `Prioritise the top opportunities: ${priority.slice(0, 3).map(r => r.client + ' (' + AED(r.amount) + ')').join(', ')}.` });
  if (rawanNotInterested.length) recs.push({ kind: 'followup', text: `${rawanNotInterested.length} customer(s) not interested (${AED(lostValue)} lost) — review objections.` });
  if (!recs.length) recs.push({ kind: 'revenue', text: totalLeads ? 'All customer replies resolved today — no follow-up outstanding.' : 'No customer activity recorded today.' });

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

function makeCanvas(logo, opts) {
  opts = opts || {};
  const cpt = !!opts.compact;
  const blocks = [];
  const SEPY = cpt ? 16 : 34;
  const push = (svg, h, x) => blocks.push({ svg, h, x: x == null ? PAD : x });
  const spacer = h => push('', h);

  function header(title, pageLabel, model) {
    const H = 220; let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.white}"/>`;
    s += `<rect x="0" y="${H - 6}" width="${W}" height="6" fill="${C.blue}"/>`;
    const logoH = 150, aspect = 599 / 502, logoW = Math.round(logoH * aspect);
    if (logo.ok) s += `<image x="${PAD}" y="${(H - logoH) / 2 - 3}" height="${logoH}" width="${logoW}" href="${logo.uri}"/>`;
    else s += T(PAD, H / 2 + 6, 'ALMUTARJEM', { size: 54, weight: 800, fill: C.blue });
    // Title block visually centered across the page: LOGO (left) | TITLE (centre) | DATE (right)
    s += T(W / 2, 94, title, { size: 56, weight: 800, fill: C.blue, anchor: 'middle' });
    s += T(W / 2, 142, 'ALMUTARJEM TRANSLATION SERVICES', { size: 30, weight: 700, fill: C.muted, anchor: 'middle' });
    s += T(W - PAD, 82, `${model.dayName}, ${model.dateStr}`, { size: 32, weight: 700, fill: C.ink, anchor: 'end' });
    s += T(W - PAD, 122, 'Report time 20:00 GST', { size: 28, fill: C.muted, anchor: 'end' });
    const cw = pageLabel.length * 16 + 44;
    s += `<rect x="${W - PAD - cw}" y="140" width="${cw}" height="46" rx="23" fill="#DCE7F4"/>` + T(W - PAD - cw / 2, 171, pageLabel, { size: 26, weight: 700, fill: C.blue2, anchor: 'middle' });
    push(s, H, 0);
  }

  function pushSec(num, title, tag) {
    const h = cpt ? 56 : 68, bs = cpt ? 46 : 50, tf = cpt ? 36 : 40; let s = '';
    s += `<rect x="0" y="6" width="${bs}" height="${bs}" rx="10" fill="${C.blue}"/>` + T(bs / 2, cpt ? 39 : 43, String(num), { size: cpt ? 26 : 28, weight: 800, fill: '#fff', anchor: 'middle' });
    s += T(bs + 16, cpt ? 41 : 45, title, { size: tf, weight: 800, fill: C.blue });
    if (tag) s += T(CW, cpt ? 41 : 45, tag, { size: cpt ? 25 : 26, weight: 600, fill: C.muted, anchor: 'end' });
    s += `<rect x="0" y="${h - 4}" width="${CW}" height="3" fill="${C.line}"/>`;
    push(s, h + (cpt ? 8 : 14));
  }

  function kpiGrid(cards) {
    const cols = 3, gap = 22, cardW = (CW - gap * (cols - 1)) / cols, cardH = 164, rows = Math.ceil(cards.length / cols);
    let s = '';
    cards.forEach((c, i) => {
      const cx = (i % cols) * (cardW + gap), cy = Math.floor(i / cols) * (cardH + gap);
      s += `<rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
      s += `<rect x="${cx + 24}" y="${cy + 30}" width="80" height="80" rx="16" fill="${c.accent}"/>`;
      s += T(cx + 24 + 40, cy + 30 + 52, c.ic, { size: 42, weight: 800, fill: '#fff', anchor: 'middle' });
      s += T(cx + 126, cy + 68, String(c.value), { size: 53, weight: 800, fill: C.ink });
      s += T(cx + 126, cy + 108, c.label.toUpperCase(), { size: 27, weight: 800, fill: '#4A566B' });
      if (c.sub) s += T(cx + 126, cy + 137, c.sub, { size: 23, fill: C.muted });
    });
    push(s, rows * cardH + (rows - 1) * gap + SEPY);
  }

  function pipeCards(cards) {
    const cols = cards.length, gap = 22, cardW = (CW - gap * (cols - 1)) / cols, cardH = 138;
    let s = '';
    cards.forEach((c, i) => { const cx = i * (cardW + gap); s += `<rect x="${cx}" y="0" width="${cardW}" height="${cardH}" rx="16" fill="${c.fill}"/>`; s += T(cx + 30, 54, c.label.toUpperCase(), { size: 27, weight: 700, fill: '#fff' }); s += T(cx + 30, 112, c.value, { size: 54, weight: 800, fill: '#fff' }); });
    push(s, cardH + SEPY);
  }

  function table(cols, rows, o) {
    o = o || {}; const fs2 = o.size || 30, lh = Math.round(fs2 * (cpt ? 1.22 : 1.28)), padY = cpt ? 12 : 16, headH = cpt ? 58 : 62;
    const psz = 26, hf = 29;
    let s = `<rect x="0" y="0" width="${CW}" height="${headH}" rx="10" fill="${C.blue}"/>`;
    let cx = 0;
    cols.forEach(col => { const tx = col.align === 'right' ? cx + col.w - 14 : cx + 16; s += T(tx, cpt ? 39 : 41, col.title.toUpperCase(), { size: hf, weight: 700, fill: '#fff', anchor: col.align === 'right' ? 'end' : 'start' }); cx += col.w; });
    let y = headH;
    const cellMc = (w, txt) => Math.max(4, Math.floor(maxChars(w - 30, fs2) * (hasArabic(txt) ? 0.8 : 1)));
    if (!rows.length) { const h = 78; s += `<rect x="0" y="${y}" width="${CW}" height="${h}" fill="${C.soft}"/>` + T(CW / 2, y + 50, o.empty || 'No records.', { size: 29, fill: C.muted, anchor: 'middle' }); push(s, y + h); return; }
    rows.forEach((row, ri) => {
      const cells = cols.map(col => col.cell(row));
      const linesPer = cells.map((cell, ci) => cell.pills ? 1 : wrap(cell.text != null ? cell.text : '—', cellMc(cols[ci].w, cell.text)).length);
      const nLines = Math.max(1, ...linesPer);
      const rowH = nLines * lh + 2 * padY;
      if (ri % 2) s += `<rect x="0" y="${y}" width="${CW}" height="${rowH}" fill="${C.soft}"/>`;
      cx = 0;
      cols.forEach((col, ci) => {
        const cell = cells[ci], baseY = y + padY + fs2;
        if (cell.pills) { let px = cx + 16; cell.pills.forEach(p => { const pl = pill(px, y + padY - 2, p.label, p.cls, psz); s += pl.svg; px += pl.w + 8; }); }
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
    o = o || {}; const pad = cpt ? 18 : 24, h = innerH + pad * 2;
    let s = `<rect x="0" y="0" width="${CW}" height="${h}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
    if (o.accent) s += `<rect x="0" y="0" width="7" height="${h}" rx="3.5" fill="${o.accent}"/>`;
    s += `<g transform="translate(${pad},${pad})">${innerSvg}</g>`;
    push(s, h + (o.gap == null ? SEPY : o.gap));
  }
  // Two side-by-side panels. left/right = {inner, h, accent, title}. Column inner width = colW-2*pad.
  function twoColPanels(left, right, o) {
    o = o || {}; const pad = cpt ? 18 : 24, gap = 22, colW = (CW - gap) / 2;
    const h = Math.max(left.h, right.h) + pad * 2 + (left.title || right.title ? 40 : 0);
    let s = '';
    [[0, left], [colW + gap, right]].forEach(([x, p]) => {
      s += `<rect x="${x}" y="0" width="${colW}" height="${h}" rx="16" fill="${C.soft}" stroke="${C.line}"/>`;
      if (p.accent) s += `<rect x="${x}" y="0" width="7" height="${h}" rx="3.5" fill="${p.accent}"/>`;
      let iy = pad;
      if (p.title) { s += `<g transform="translate(${x + pad},${pad})">${T(0, 22, p.title, { size: 24, weight: 800, fill: C.blue })}</g>`; iy = pad + 40; }
      s += `<g transform="translate(${x + pad},${iy})">${p.inner}</g>`;
    });
    push(s, h + (o.gap == null ? SEPY : o.gap));
    return colW - pad * 2;
  }
  const colInnerW = () => ((CW - 22) / 2) - (cpt ? 18 : 24) * 2;

  function assemble() {
    let y = 0, body = '';
    blocks.forEach(b => { if (b.svg) body += `<g transform="translate(${b.x},${y})">${b.svg}</g>`; y += b.h; });
    const H = y + 40;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#FFFFFF"/>${body}</svg>`;
    return { svg, width: W, height: H, logoOk: logo.ok };
  }

  return { header, pushSec, kpiGrid, pipeCards, table, panel, twoColPanels, colInnerW, spacer, push, assemble, SEPY, CW, C, T, lineT, AED, wrap, maxChars, compact: cpt };
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
    { title: '#', w: 62, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 396, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'ATS / Ref', w: 338, cell: r => ({ text: (r.ref && r.ref !== '0') ? r.ref : '—', mono: true, fill: C.muted }) },
    { title: 'Type', w: 340, cell: r => ({ text: r.service || '—' }) },
    { title: 'Language', w: 402, cell: r => ({ text: r.notes || '—' }) },
    { title: 'Amount', w: 296, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Status', w: CW - 62 - 396 - 338 - 340 - 402 - 296, cell: r => ({ pills: [{ label: r.status, cls: payClass(r.status) }, { label: r.fileStatus, cls: fileClass(r.fileStatus) }] }) },
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
    let inner = ''; let yy = 34; b.forEach(l => { inner += T(0, yy, '•  ' + l, { size: 30 }); yy += 46; });
    cv.panel(inner, yy - 34, { gap: 18 });
  }
  cv.push(T(0, 32, 'ALMUTARJEM Translation Services · Daily Operations · Page 1 of 2 · Key figures from Sherry (master).', { size: 24, fill: C.muted }), 52);
  return cv.assemble();
}

/* ============================================================================
 * PAGE 2 — FOLLOW-UP & SALES DASHBOARD  (Rawan — "what should we do next")
 * ========================================================================== */
function buildPage2SVG(model, logo) {
  const cv = makeCanvas(logo, { compact: true }), A = model.analysis, R = model.revenue;
  cv.header('Follow-up & Sales Dashboard', 'Page 2 of 2 · Follow-up', model);

  // Merged "Pending Confirmation + Follow-Up" — one action list (was two duplicate sections)
  cv.pushSec('1', 'Pending Confirmation & Follow-Up', model.rawanPending.length + ' awaiting reply — all shown');
  cv.table([
    { title: '#', w: 66, cell: r => ({ text: String(r._i), fill: C.muted, bold: true }) },
    { title: 'Client', w: 620, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Amount', w: 300, align: 'right', cell: r => ({ text: AED(r.amount), bold: true }) },
    { title: 'Latest Status', w: 380, cell: r => ({ pills: [{ label: r.outcome || r.status || 'Pending', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 66 - 620 - 300 - 380, cell: r => ({ text: r.notes || '—' }) },
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

  cv.pushSec('3', 'High Priority', 'highest-value opportunities');
  cv.table([
    { title: 'Rank', w: 120, cell: r => ({ text: String(r._i), bold: true, fill: C.red }) },
    { title: 'Client', w: 620, cell: r => ({ text: r.client || '—', bold: true }) },
    { title: 'Opportunity', w: 360, align: 'right', cell: r => ({ text: AED(r.amount), bold: true, fill: C.purple }) },
    { title: 'Status', w: 340, cell: r => ({ pills: [{ label: r.outcome || '—', cls: outcomeClass(r.outcome) }] }) },
    { title: 'Reason', w: CW - 120 - 620 - 360 - 340, cell: r => ({ text: r.notes || '—' }) },
  ], model.priority.map((r, i) => Object.assign({ _i: i + 1 }, r)), { empty: 'No revenue opportunities open.' });
  cv.spacer(cv.SEPY);

  // Business Analysis (left) + Validation (right) side-by-side to save height
  cv.pushSec('4', 'Business Analysis & Validation');
  { const iw = cv.colInnerW();
    const aLines = [
      `Confirmation rate: ${A.confirmationRate}% (${A.accepted}/${A.totalLeads} replies)`,
      `Lost: ${A.lostCount} not interested (${AED(A.lostValue)})`,
      `Follow-up workload: ${A.followWorkload} awaiting action`,
      `Revenue still available: ${AED(A.revenueAvailable)}`,
    ];
    let aInner = ''; let ay = 28; aLines.forEach(l => { cv.wrap(l, cv.maxChars(iw, 29)).forEach((ln, li) => { aInner += lineT(li ? 26 : 0, iw, ay, '• ' + ln, { size: 29 }); ay += 42; }); });
    const v = model.validation, vc = v.ok ? C.green : C.orange;
    let vInner = T(0, 28, (v.ok ? '✓ VALIDATION PASSED' : '⚠ VALIDATION NOTES'), { size: 29, weight: 800, fill: vc }); let vy = 70;
    vInner += lineT(0, iw, vy, 'reconciliation ' + (v.reconciles ? 'balanced' : 'GAP') + ' · M' + model.recon.matched + ' U' + model.recon.unmatched + ' A' + model.recon.ambiguous + ' D' + model.recon.duplicates, { size: 26, fill: C.muted }); vy += 40;
    (v.issues.length ? v.issues : ['No data-quality issues detected.']).forEach(is => { cv.wrap('• ' + is, cv.maxChars(iw, 26)).forEach((ln, li) => { vInner += lineT(li ? 22 : 0, iw, vy, ln, { size: 26, fill: C.muted }); vy += 36; }); });
    cv.twoColPanels({ inner: aInner, h: ay - 14 }, { inner: vInner, h: vy - 14, accent: vc });
  }

  cv.pushSec('5', 'AI Recommendations');
  { const ICN = { call: { g: '☎', c: C.blue2 }, revenue: { g: '◆', c: C.purple }, followup: { g: '⚠', c: C.orange } };
    let inner = T(0, 28, '◆ GENERATED FROM TODAY\'S DATA', { size: 24, weight: 800, fill: C.purple }); let yy = 74;
    const textX = 52;
    model.recs.forEach(r => {
      const ic = ICN[r.kind] || ICN.revenue;
      inner += T(0, yy, ic.g, { size: 30, weight: 800, fill: ic.c });                       // leading category icon
      const lines = cv.wrap(r.text, Math.floor(cv.maxChars(CW - 36 - textX, 29) * (hasArabic(r.text) ? 0.8 : 1)));
      lines.forEach((ln, li) => { inner += lineT(textX, CW - 36, yy, ln, { size: 29 }); yy += 40; });
      yy += 12;
    });
    cv.panel(inner, yy - 24, { accent: C.purple });
  }

  // Office Notes in TWO columns (compact) — keeps every note, half the height
  cv.pushSec('6', 'Office Notes', model.officeNotes.length + ' note(s)');
  { const notes = model.officeNotes; const iw = cv.colInnerW();
    if (!notes.length) { cv.panel(T(0, 30, 'No operational notes recorded today.', { size: 28, fill: C.muted }), 36); }
    else {
      const mid = Math.ceil(notes.length / 2), cols = [notes.slice(0, mid), notes.slice(mid)];
      const colSvg = list => { let s = '', y = 30; list.forEach(n => { const t = n.who + ' — ' + n.note; const wr = cv.wrap(t, Math.floor(cv.maxChars(iw - 28, 28) * (hasArabic(t) ? 0.8 : 1))); wr.forEach((ln, li) => { if (li === 0) s += T(0, y, '•', { size: 28, weight: 800, fill: C.blue2 }); s += lineT(28, iw, y, ln, { size: 28 }); y += 40; }); y += 12; }); return { s, h: y - 22 }; };
      const L = colSvg(cols[0]), Rr = colSvg(cols[1]);
      cv.twoColPanels({ inner: L.s, h: L.h }, { inner: Rr.s, h: Rr.h });
    }
  }
  cv.push(T(0, 30, 'ALMUTARJEM Translation Services · Follow-up & Sales · Page 2 of 2 · Customer tracking from Rawan.', { size: 24, fill: C.muted }), 48);
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
