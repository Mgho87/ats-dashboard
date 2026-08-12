'use strict';
/* ============================================================================
 * ALMUTARJEM — Daily Telegram Report  ·  REDESIGN v2  ·  TWO PNG IMAGES
 * ----------------------------------------------------------------------------
 * IMAGE 1 = SHERRY — Operations & ACTUAL revenue (confirmed jobs, money in/out).
 * IMAGE 2 = RAWAN  — Sales leads, potential vs converted, lost-reason analysis.
 *
 * Two funnel STAGES of one business — never summed:
 *   RAWAN potential (what COULD become business)  →  SHERRY actual (what DID).
 *
 * Premium executive-dashboard look, mobile/Telegram-first (width 1500, big type,
 * KPI cards + two-column analytics, compact tables). Height dynamic but kept tight.
 * Source failure shows "—" / a banner, NEVER "AED 0" as if real.
 * Uses ONLY real source fields (schema verified): Sherry has NO per-row paid-amount
 * column, so row Received/Balance are DERIVED from Payment Status (footnoted); the
 * authoritative split lives in the aggregate reconciliation.
 *
 * Renderer reuses the proven Sharp rasteriser + logo loader from report-image.js.
 * This module is standalone — the live report path is unchanged until wired in.
 * ========================================================================== */

const RI = require('./report-image');   // rasterise() + loadLogo() (Arabic-capable, cPanel-safe)

/* ------------------------------- palette ---------------------------------- */
const INK = '#1B2436', MUTE = '#6B7688', LINE = '#E6EAF1', SOFT = '#F5F7FB', WHITE = '#FFFFFF';
const THEME = {
  sherry: { key: '#0E7A54', keyDk: '#0B5E41', tint: '#E7F4EE', accent2: '#0B5FA5', name: 'SHERRY' },
  rawan:  { key: '#4B3F9E', keyDk: '#3B3183', tint: '#ECEAFA', accent2: '#B5378E', name: 'RAWAN'  },
};
const OK = '#1E9E6A', WARN = '#E08A0B', BAD = '#CE3F3F', INFO = '#2E6DB4', PUR = '#7A3FD0';
const TONE_SHERRY = { bg: '#E7F4EE', br: '#BFE4D3', fg: '#0B5E41' };   // confirmed/actual (primary)
const TONE_RAWAN = { bg: '#ECEAFA', br: '#D6CFF3', fg: '#3B3183' };    // potential/leads (secondary)
const FONT = "Arial, 'DejaVu Sans', 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', sans-serif";
const W = 1500, PAD = 56, CW = W - 2 * PAD;

/* ------------------------------ text helpers ------------------------------ */
const escX = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const hasAr = s => /[؀-ۿ]/.test(String(s || ''));
const cap = s => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : '—'; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
const p9 = s => (String(s || '').replace(/\D/g, '').slice(-9)) || '';
const N = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const hasAmt = v => N(v) > 0;   // a real opportunity amount (> 0). blank/zero → "—", never a fabricated "AED 0"
const AED = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AED0 = n => 'AED ' + Math.round(Number(n) || 0).toLocaleString('en-US');
function T(x, y, s, o) {
  o = o || {};
  const a = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const w = o.weight ? ` font-weight="${o.weight}"` : '';
  const d = hasAr(s) ? ' direction="rtl"' : '';
  const ls = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  return `<text x="${x}" y="${y}" font-family="${o.family || FONT}" font-size="${o.size || 26}" fill="${o.fill || INK}"${w}${a}${d}${ls}>${escX(s)}</text>`;
}
const lineT = (lx, rx, y, s, o) => hasAr(s) ? T(rx, y, s, Object.assign({}, o, { anchor: 'start' })) : T(lx, y, s, Object.assign({}, o, { anchor: (o && o.anchor) || 'start' }));
function maxChars(px, size) { return Math.max(4, Math.floor(px / (size * 0.56))); }
function wrap(str, mc) {
  str = String(str == null ? '' : str).trim(); if (!str) return ['—'];
  const words = str.split(/\s+/), out = []; let cur = '';
  for (let w of words) {
    while (w.length > mc) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, mc - 1) + '-'); w = w.slice(mc - 1); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= mc) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur); return out.length ? out : ['—'];
}
/* pill */
const PB = { green: '#E4F3EC', orange: '#FBEED6', red: '#F6E0E0', gray: '#ECEFF4', blue: '#E1ECF9', purple: '#EDE6FA' };
const PF = { green: '#147A50', orange: '#A5620A', red: '#A52F2F', gray: '#5A6577', blue: '#22588F', purple: '#5A2FA0' };
function pill(x, y, label, cls, size) {
  size = size || 22; label = cap(label);
  const w = Math.round(label.length * size * 0.6) + 26, h = size + 15;
  return { w, h, svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${PB[cls] || PB.gray}"/>` + T(x + w / 2, y + h - Math.round(size * 0.36) - 2, label, { size, weight: 700, fill: PF[cls] || PF.gray, anchor: 'middle' }) };
}

/* ============================================================================
 * CANVAS
 * ========================================================================== */
function makeCanvas(theme) {
  const blocks = []; const SEP = 26;
  const push = (svg, h, x) => blocks.push({ svg, h, x: x == null ? PAD : x });
  const spacer = h => push('', h);

  function header(title, subtitle, dateStr, dayName, pageLabel, logo) {
    const H = 188; let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${WHITE}"/>`;
    s += `<rect x="0" y="0" width="${W}" height="10" fill="${theme.key}"/>`;
    s += `<rect x="0" y="${H - 1}" width="${W}" height="1" fill="${LINE}"/>`;
    const lh = 118, aspect = 599 / 502, lw = Math.round(lh * aspect);
    if (logo && logo.ok) s += `<image x="${PAD}" y="${(H - lh) / 2 + 4}" height="${lh}" width="${lw}" href="${logo.uri}"/>`;
    else s += T(PAD, H / 2 + 10, 'ALMUTARJEM', { size: 42, weight: 800, fill: theme.key });
    s += T(W / 2, 78, title, { size: 46, weight: 800, fill: INK, anchor: 'middle' });
    s += T(W / 2, 118, subtitle, { size: 25, weight: 600, fill: MUTE, anchor: 'middle', spacing: '2' });
    s += T(W - PAD, 70, dayName + ', ' + dateStr, { size: 27, weight: 700, fill: INK, anchor: 'end' });
    s += T(W - PAD, 106, 'Daily report · 20:00 GST', { size: 22, fill: MUTE, anchor: 'end' });
    const cw = pageLabel.length * 13 + 40;
    s += `<rect x="${W - PAD - cw}" y="126" width="${cw}" height="40" rx="20" fill="${theme.tint}"/>` + T(W - PAD - cw / 2, 152, pageLabel, { size: 22, weight: 800, fill: theme.keyDk, anchor: 'middle' });
    push(s, H, 0);
    spacer(SEP);
  }

  // Coloured banner (source failure / notice)
  function banner(kind, title, sub) {
    const map = { bad: { c: BAD, bg: '#F8E3E3' }, warn: { c: WARN, bg: '#FBEFD6' }, info: { c: INFO, bg: '#E7F0FA' } }[kind] || { c: MUTE, bg: SOFT };
    let s = `<rect x="0" y="0" width="${CW}" height="118" rx="16" fill="${map.bg}" stroke="${map.c}" stroke-width="3"/>`;
    s += T(28, 52, '⚠  ' + title, { size: 30, weight: 800, fill: map.c });
    if (sub) s += T(28, 92, sub, { size: 24, fill: INK });
    push(s, 118); spacer(SEP);
  }

  // KPI card row (2..5). Each card: soft bg, top accent stripe, big value, label, sub.
  function kpiRow(cards) {
    const n = cards.length, gap = 18, cw = (CW - gap * (n - 1)) / n, ch = 198;
    let s = '';
    cards.forEach((c, i) => {
      const x = i * (cw + gap), accent = c.accent || theme.key;
      s += `<rect x="${x}" y="0" width="${cw}" height="${ch}" rx="16" fill="${c.fill || SOFT}" stroke="${LINE}"/>`;
      s += `<rect x="${x}" y="0" width="${cw}" height="8" rx="4" fill="${accent}"/>`;
      s += T(x + 26, 66, c.label.toUpperCase(), { size: 23, weight: 800, fill: MUTE, spacing: '0.5' });
      const val = String(c.value);
      const vs = val.length > 12 ? 36 : val.length > 9 ? 42 : val.length > 6 ? 48 : 56;
      s += T(x + 24, 134, val, { size: vs, weight: 800, fill: c.valFill || INK });
      if (c.sub) s += T(x + 26, 172, c.sub, { size: 23, fill: MUTE });
    });
    push(s, ch); spacer(SEP);
  }

  // Priority ribbon: PRIMARY block (left) + secondary (right). Each box carries its own tone;
  // opts.arrow = 'left' (secondary→primary funnel) or 'right'. Confirmed leads first per business priority.
  function funnel(left, right, mid, opts) {
    opts = opts || {};
    const H = 144, gap = 100, colW = (CW - gap) / 2;
    let s = '';
    const card = (x, box) => {
      const tone = box.tone || TONE_RAWAN;
      let g = `<rect x="${x}" y="0" width="${colW}" height="${H}" rx="16" fill="${tone.bg}" stroke="${tone.br}" stroke-width="2"/>`;
      g += T(x + 28, 48, box.tag, { size: 23, weight: 800, fill: tone.fg, spacing: '0.5' });
      g += T(x + 28, 104, box.big, { size: 45, weight: 800, fill: INK });
      g += T(x + colW - 28, 104, box.small, { size: 27, weight: 700, fill: tone.fg, anchor: 'end' });
      return g;
    };
    s += card(0, left);
    s += card(colW + gap, right);
    // connector arrow (orient=auto rotates the marker to the path direction) + conversion badge
    const ax = colW, aw = gap, cy = H / 2;
    if (opts.arrow === 'left') s += `<path d="M ${ax + aw - 14} ${cy} L ${ax + 16} ${cy}" stroke="${MUTE}" stroke-width="4" marker-end="url(#arrow)"/>`;
    else s += `<path d="M ${ax + 14} ${cy} L ${ax + aw - 16} ${cy}" stroke="${MUTE}" stroke-width="4" marker-end="url(#arrow)"/>`;
    s += `<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${MUTE}"/></marker></defs>`;
    if (mid) { const bw = mid.length * 12 + 24; s += `<rect x="${ax + aw / 2 - bw / 2}" y="${cy - 44}" width="${bw}" height="34" rx="17" fill="${INK}"/>` + T(ax + aw / 2, cy - 20, mid, { size: 21, weight: 800, fill: '#fff', anchor: 'middle' }); }
    push(s, H); spacer(SEP);
  }

  function sectionTitle(txt, tag) {
    const h = 60; let s = `<rect x="0" y="10" width="8" height="38" rx="4" fill="${theme.key}"/>`;
    s += T(24, 46, txt, { size: 36, weight: 800, fill: INK });
    if (tag) s += T(CW, 44, tag, { size: 24, weight: 600, fill: MUTE, anchor: 'end' });
    s += `<rect x="0" y="${h - 2}" width="${CW}" height="2" fill="${LINE}"/>`;
    push(s, h + 12);
  }

  function table(cols, rows, o) {
    o = o || {}; const fs = o.size || 27, lh = Math.round(fs * 1.3), padY = 16, headH = 60, psz = 23;
    let s = `<rect x="0" y="0" width="${CW}" height="${headH}" rx="10" fill="${theme.keyDk}"/>`;
    let cx = 0;
    cols.forEach(c => { const tx = c.align === 'right' ? cx + c.w - 14 : cx + 16; s += T(tx, 39, c.title.toUpperCase(), { size: 23, weight: 700, fill: '#fff', anchor: c.align === 'right' ? 'end' : 'start' }); cx += c.w; });
    let y = headH;
    const mc = (w, txt) => Math.max(4, Math.floor(maxChars(w - 28, fs) * (hasAr(txt) ? 0.82 : 1)));
    if (!rows.length) { const h = 70; s += `<rect x="0" y="${y}" width="${CW}" height="${h}" fill="${SOFT}"/>` + T(CW / 2, y + 45, o.empty || 'No records.', { size: 25, fill: MUTE, anchor: 'middle' }); push(s, y + h); spacer(o.gap == null ? SEP : o.gap); return; }
    rows.forEach((row, ri) => {
      const cells = cols.map(c => c.cell(row));
      const linesPer = cells.map((cell, ci) => cell.pills ? 1 : wrap(cell.text != null ? cell.text : '—', mc(cols[ci].w, cell.text)).length);
      const nLines = Math.max(1, ...linesPer);
      const rowH = nLines * lh + 2 * padY;
      if (ri % 2) s += `<rect x="0" y="${y}" width="${CW}" height="${rowH}" fill="${SOFT}"/>`;
      cx = 0;
      cols.forEach((c, ci) => {
        const cell = cells[ci], baseY = y + padY + fs - 2;
        if (cell.pills) { let px = cx + 14; cell.pills.forEach(p => { const pl = pill(px, y + padY - 3, p.label, p.cls, psz); s += pl.svg; px += pl.w + 7; }); }
        else {
          const txt = cell.text != null ? cell.text : '—';
          const lines = wrap(txt, mc(c.w, txt)), lx = cx + 16, rx = cx + c.w - 16;
          const co = { size: fs, weight: cell.bold ? 700 : 400, fill: cell.fill || INK };
          lines.forEach((ln, li) => { const yy = baseY + li * lh; if (c.align === 'right') s += T(cx + c.w - 14, yy, ln, Object.assign({ anchor: 'end' }, co)); else s += lineT(lx, rx, yy, ln, co); });
        }
        cx += c.w;
      });
      s += `<rect x="0" y="${y + rowH - 1}" width="${CW}" height="1" fill="${LINE}"/>`;
      y += rowH;
    });
    push(s, y); spacer(o.gap == null ? SEP : o.gap);
  }

  function panel(inner, innerH, o) {
    o = o || {}; const pad = 22, h = innerH + pad * 2;
    let s = `<rect x="0" y="0" width="${CW}" height="${h}" rx="16" fill="${o.bg || SOFT}" stroke="${LINE}"/>`;
    if (o.accent) s += `<rect x="0" y="0" width="7" height="${h}" rx="3.5" fill="${o.accent}"/>`;
    s += `<g transform="translate(${pad + (o.accent ? 6 : 0)},${pad})">${inner}</g>`;
    push(s, h); spacer(o.gap == null ? SEP : o.gap);
  }
  // two side-by-side panels; returns inner column width
  function twoCol(left, right) {
    const pad = 22, gap = 20, colW = (CW - gap) / 2;
    const h = Math.max(left.h, right.h) + pad * 2 + 44;
    let s = '';
    [[0, left], [colW + gap, right]].forEach(([x, p]) => {
      s += `<rect x="${x}" y="0" width="${colW}" height="${h}" rx="16" fill="${SOFT}" stroke="${LINE}"/>`;
      s += `<rect x="${x}" y="0" width="7" height="${h}" rx="3.5" fill="${p.accent || theme.key}"/>`;
      s += `<g transform="translate(${x + pad + 6},${pad})">${T(0, 22, p.title, { size: 24, weight: 800, fill: theme.keyDk })}</g>`;
      s += `<g transform="translate(${x + pad + 6},${pad + 44})">${p.inner}</g>`;
    });
    push(s, h); spacer(SEP);
    return colW - pad * 2 - 6;
  }
  const colInnerW = () => ((CW - 20) / 2) - 22 * 2 - 6;

  function footer(txt) { push(T(0, 26, txt, { size: 21, fill: MUTE }), 42); }

  function assemble() {
    let y = 0, body = '';
    blocks.forEach(b => { if (b.svg) body += `<g transform="translate(${b.x},${y})">${b.svg}</g>`; y += b.h; });
    const H = y + 34;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${WHITE}"/>${body}</svg>`;
    return { svg, width: W, height: H };
  }
  return { header, banner, kpiRow, funnel, sectionTitle, table, panel, twoCol, colInnerW, footer, spacer, push, assemble, SEP };
}

/* ============================================================================
 * MODEL — same-day, funnel-aware, real fields only
 * ========================================================================== */
// Rawan lost/pending reason classification — outcome + NOTES, conservative.
function classifyRawan(r) {
  const oc = String(r.outcome || '').toLowerCase();
  const note = String(r.notes || '').toLowerCase();
  const pay = String(r.status || '').toLowerCase();
  const file = String(r.fileStatus || r.file || '').toLowerCase();
  const proceeded = /accept|agree|confirm|approv|deal|won/.test(oc) || /paid/.test(pay) || /deliver|in progress|progress/.test(file);
  if (proceeded) return { group: 'PROCEEDED', label: 'Converted', cls: 'green', next: 'Won — moved to Sherry' };
  const has = re => re.test(note);
  if (/price/.test(oc) || has(/price|expensive|higher than|too (high|much)|over budget|budget|cost too|quotation.*(high|much)/)) return { group: 'PRICE', label: 'Price', cls: 'orange', next: 'Follow up / review pricing' };
  if (has(/another (company|office|provider|agency|place|shop)|found some|some ?one else|went (else|to another|with)|used another|chose another|got it done (else|some)/)) return { group: 'FOUND_ANOTHER', label: 'Found another', cls: 'red', next: 'Closed — lost to competitor' };
  if (/no response/.test(oc) || has(/no response|no reply|didn.?t reply|not reply|no answer|unreachable|not reachable|ignored/)) return { group: 'NO_RESPONSE', label: 'No response', cls: 'orange', next: 'Re-contact' };
  if (has(/not interest|no longer (need|interest|require)|not required|no need|don.?t need|changed .*mind/) || /cancel|not interest|declin|reject/.test(oc)) return { group: 'NOT_INTERESTED', label: 'Not interested', cls: 'red', next: 'Closed' };
  if (has(/get back|will be back|come back|revert|will contact|contact .*later|later|reach out again/)) return { group: 'WILL_GET_BACK', label: 'Will get back', cls: 'blue', next: 'Follow up' };
  if (/pending/.test(oc) || has(/waiting|awaiting|confirm|company confirmation|approval|decide|deciding|think/)) return { group: 'WAITING', label: 'Waiting', cls: 'purple', next: 'Follow up / await' };
  // Other / blank outcome → inspect note
  if (note && note !== '—') return { group: 'OTHER', label: 'Other', cls: 'gray', next: 'Follow up' };
  return { group: 'NEEDS_REVIEW', label: 'Needs review', cls: 'gray', next: 'Review note' };
}

/* Cross-stage reconciliation — match Rawan ACCEPTED leads to Sherry confirmed jobs.
 * Multi-signal, ±7-day window; NEVER forces a match. Signal strength:
 *   3 = exact phone (last 9 digits)              → matched
 *   2 = normalized client name + service agree    → matched
 *   1 = name only (no phone, service differs/absent) → NEEDS REVIEW (uncertain)
 *   0 = no basis                                   → unmatched
 * accepted: [{client,phone,service,amount}]  ·  sherryWin: [{client,phone,service,amount,dateKey}]  */
const _dayNum = k => Math.floor(new Date(k + 'T00:00:00').getTime() / 86400000);
function reconcileFunnel(accepted, sherryWin, sampleKey) {
  const matchedJobIdx = new Set();
  const rows = (accepted || []).map(l => {
    let best = null;
    (sherryWin || []).forEach((j, ji) => {
      const dd = Math.abs(_dayNum(sampleKey) - _dayNum(j.dateKey));
      if (dd > 7) return;
      const ph = !!(p9(l.phone) && p9(j.phone) && p9(l.phone) === p9(j.phone));
      const nm = !!(norm(l.client) && norm(j.client) && norm(l.client) === norm(j.client));
      const sv = !!(norm(l.service) && norm(j.service) && norm(l.service) === norm(j.service));
      const strength = ph ? 3 : (nm && sv) ? 2 : nm ? 1 : 0;
      if (!strength) return;
      const cand = { ji, strength, ph, nm, sv, dd, job: j };
      if (!best || cand.strength > best.strength || (cand.strength === best.strength && cand.dd < best.dd)) best = cand;
    });
    let verdict = !best ? 'UNMATCHED' : best.strength >= 2 ? (best.dd === 0 ? 'SAME_DAY' : 'WINDOW') : 'NEEDS_REVIEW';
    if (best && (verdict === 'SAME_DAY' || verdict === 'WINDOW')) matchedJobIdx.add(best.ji);
    return { lead: l, best, verdict };
  });
  const sameDay = rows.filter(r => r.verdict === 'SAME_DAY');
  const windowM = rows.filter(r => r.verdict === 'WINDOW');
  const needsReview = rows.filter(r => r.verdict === 'NEEDS_REVIEW');
  const unmatched = rows.filter(r => r.verdict === 'UNMATCHED');
  const sherryNoRawan = [];
  (sherryWin || []).forEach((j, i) => { if (j.dateKey === sampleKey && !matchedJobIdx.has(i)) sherryNoRawan.push(j); });
  return { rows, sameDay, windowM, needsReview, unmatched, sherryNoRawan, acceptedTotal: (accepted || []).length, sameDaySherry: (sherryWin || []).filter(j => j.dateKey === sampleKey).length };
}

function computeModelV2(dateKey, sherryRows, rawanRows, opts) {
  opts = opts || {};
  const src = opts.source || { sherry: 'OK', rawan: 'OK' };
  const D = new Date(dateKey + 'T12:00:00');
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][D.getDay()];
  const dateStr = D.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][D.getMonth()] + ' ' + D.getFullYear();

  /* ---------------- SHERRY (actual) ---------------- */
  const sAll = (sherryRows || []).slice();
  const sCanc = sAll.filter(r => /cancel/i.test(String(r.status || r.payment || '')));
  const jobs = sAll.filter(r => !/cancel/i.test(String(r.status || r.payment || '')));
  // Payment category — PARTIAL is checked first so it is never miscounted as fully paid/outstanding.
  // A partial row's paid split is UNKNOWN (Sherry has no per-row paid-amount column), so it is neither
  // Received nor Outstanding — it sits in its own "split unknown" bucket (no fabricated arithmetic).
  const catOf = r => { const s = String(r.status || r.payment || '').toLowerCase();
    if (/partial|deposit|advance|part[\s-]?paid|partly/.test(s)) return 'partial';
    if (/paid|received|collected|settled/.test(s)) return 'paid';
    return 'outstanding'; };
  const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) ? N(r.amount) : 0), 0);
  const confirmedValue = jobs.reduce((a, r) => a + N(r.amount), 0);
  const received = sum(jobs, r => catOf(r) === 'paid');
  const outstanding = sum(jobs, r => catOf(r) === 'outstanding');
  const partialUnknown = sum(jobs, r => catOf(r) === 'partial');
  const partialCount = jobs.filter(r => catOf(r) === 'partial').length;
  const deliv = s => /deliver|complete|done|ready|collected/i.test(String(s || ''));
  const delivered = jobs.filter(r => deliv(r.fileStatus || r.delivery)).length;
  const sherry = {
    jobs: jobs.length, cancelled: sCanc.length, confirmedValue, received, outstanding, partialUnknown, partialCount, delivered,
    reconGap: Math.round((confirmedValue - received - outstanding - partialUnknown) * 100) / 100,
    rows: jobs.slice().sort((a, b) => N(b.amount) - N(a.amount)).map(r => {
      const cat = catOf(r);
      return {
        client: r.client || '—', file: r.ref || r.file || '—', service: r.service || '—', lang: r.notes || '—',
        amount: N(r.amount),
        received: cat === 'paid' ? N(r.amount) : cat === 'partial' ? null : 0,   // partial split unknown → —
        balance: cat === 'paid' ? 0 : cat === 'partial' ? null : N(r.amount),    // partial split unknown → —
        pay: String(r.status || r.payment || '').trim() || 'Unpaid',
        file2: String(r.fileStatus || r.delivery || '').trim() || 'Pending',
      };
    }),
  };

  /* ---------------- RAWAN (potential) ---------------- */
  const leads = (rawanRows || []).slice();
  const withAmt = leads.filter(r => hasAmt(r.amount));
  const potentialValue = withAmt.reduce((a, r) => a + N(r.amount), 0);
  const enriched = leads.map(r => { const c = classifyRawan(r); return { r, c, amt: N(r.amount), hasAmt: hasAmt(r.amount) }; });
  const proceeded = enriched.filter(e => e.c.group === 'PROCEEDED');
  const lostGroups = ['PRICE', 'FOUND_ANOTHER', 'NO_RESPONSE', 'NOT_INTERESTED'];
  const pendingGroups = ['WILL_GET_BACK', 'WAITING', 'OTHER', 'NEEDS_REVIEW'];
  const lost = enriched.filter(e => lostGroups.includes(e.c.group));
  const pending = enriched.filter(e => pendingGroups.includes(e.c.group));
  const convertedValue = proceeded.reduce((a, e) => a + e.amt, 0);
  const unrealized = Math.max(0, potentialValue - convertedValue);
  const conversionRate = leads.length ? Math.round(proceeded.length / leads.length * 1000) / 10 : 0;
  // reason breakdown (count + value), lost + pending
  const reasonOrder = ['PRICE', 'NO_RESPONSE', 'FOUND_ANOTHER', 'NOT_INTERESTED', 'WAITING', 'WILL_GET_BACK', 'OTHER', 'NEEDS_REVIEW'];
  const reasonMeta = {
    PRICE: { label: 'Price not suitable', cls: 'orange' }, NO_RESPONSE: { label: 'No response', cls: 'orange' },
    FOUND_ANOTHER: { label: 'Found another provider', cls: 'red' }, NOT_INTERESTED: { label: 'Not interested', cls: 'red' },
    WAITING: { label: 'Waiting for confirmation', cls: 'purple' }, WILL_GET_BACK: { label: 'Will get back', cls: 'blue' },
    OTHER: { label: 'Other', cls: 'gray' }, NEEDS_REVIEW: { label: 'Needs review', cls: 'gray' },
  };
  const notProceeded = enriched.filter(e => e.c.group !== 'PROCEEDED');
  const reasons = reasonOrder.map(g => {
    const items = notProceeded.filter(e => e.c.group === g);
    return { group: g, label: reasonMeta[g].label, cls: reasonMeta[g].cls, count: items.length, value: items.reduce((a, e) => a + e.amt, 0) };
  }).filter(x => x.count > 0).sort((a, b) => b.count - a.count || b.value - a.value);   // leading reason = largest
  const leadReason = reasons[0] || null;
  const priceShare = notProceeded.length ? Math.round((reasons.find(r => r.group === 'PRICE')?.count || 0) / notProceeded.length * 100) : 0;
  const noRespShare = notProceeded.length ? Math.round((reasons.find(r => r.group === 'NO_RESPONSE')?.count || 0) / notProceeded.length * 100) : 0;
  const highestLost = notProceeded.filter(e => e.hasAmt).sort((a, b) => b.amt - a.amt)[0] || null;
  // client-notes rows: CONVERTED/accepted first (realized before potential), then not-proceeded — each by value
  const noteRows = enriched.slice().sort((a, b) => {
    const ap = a.c.group === 'PROCEEDED' ? 1 : 0, bp = b.c.group === 'PROCEEDED' ? 1 : 0;
    if (ap !== bp) return bp - ap; return b.amt - a.amt;
  }).map(e => ({
    client: e.r.client || '—', amt: e.amt, hasAmt: e.hasAmt,
    reason: e.c.label, cls: e.c.cls, note: e.r.notes || '—', next: e.c.next,
  }));
  // recommendations (data-driven)
  const openHighValue = enriched.filter(e => (pendingGroups.includes(e.c.group) || e.c.group === 'PRICE' || e.c.group === 'NO_RESPONSE') && e.hasAmt)
    .sort((a, b) => b.amt - a.amt);
  const recs = [];
  if (openHighValue.length) { const top = openHighValue.slice(0, 3); recs.push({ ic: '☎', c: INFO, t: 'Follow up ' + top.length + ' high-value open lead(s): ' + top.map(e => e.r.client + ' (' + AED0(e.amt) + ')').join(', ') + '.' }); }
  if (priceShare >= 25 && (reasons.find(r => r.group === 'PRICE')?.count || 0) >= 2) recs.push({ ic: '◆', c: PUR, t: 'Price objections are ' + priceShare + '% of non-converted leads — review pricing / offer options.' });
  const nr = reasons.find(r => r.group === 'NO_RESPONSE'); if (nr && nr.count >= 2) recs.push({ ic: '⟳', c: WARN, t: 'Re-contact ' + nr.count + ' no-response lead(s) worth ' + AED0(nr.value) + ' while still warm.' });
  const fa = reasons.find(r => r.group === 'FOUND_ANOTHER'); if (fa && fa.count >= 1) recs.push({ ic: '⚠', c: BAD, t: fa.count + ' lead(s) went to another provider — investigate turnaround/price gaps.' });
  const nrv = reasons.find(r => r.group === 'NEEDS_REVIEW'); if (nrv && nrv.count >= 1) recs.push({ ic: '?', c: MUTE, t: nrv.count + ' lead(s) have unclear notes — have Rawan clarify the reason.' });
  if (!recs.length) recs.push({ ic: '✓', c: OK, t: 'No open follow-ups flagged for today.' });
  const insights = [];
  insights.push({ k: 'Conversion rate', v: conversionRate + '%  (' + proceeded.length + ' of ' + leads.length + ')' });
  if (leadReason) insights.push({ k: 'Leading lost/pending reason', v: leadReason.label + '  (' + leadReason.count + ')' });
  insights.push({ k: 'Lost to price', v: priceShare + '%  ·  No response ' + noRespShare + '%' });
  if (highestLost) insights.push({ k: 'Highest-value open opportunity', v: highestLost.r.client + '  ' + AED0(highestLost.amt) });
  insights.push({ k: 'Total unrealized opportunity', v: AED0(unrealized) });

  const rawan = {
    totalLeads: leads.length, potentialValue, leadsWithAmount: withAmt.length,
    converted: proceeded.length, conversionRate, convertedValue, unrealized,
    lost: lost.length, pending: pending.length, reasons, noteRows, insights, recs,
    highestLost, leadReason, priceShare, noRespShare,
    acceptedLeads: proceeded.map(e => ({ client: e.r.client, phone: e.r.phone, service: e.r.service, amount: e.amt })),
  };

  /* ---------------- funnel reconcile (report only, never force) ---------------- */
  const matched = proceeded.filter(e => jobs.some(j =>
    (e.r.client && norm(j.client) && norm(j.client) === norm(e.r.client)) ||
    (p9(e.r.phone) && p9(j.phone) && p9(j.phone) === p9(e.r.phone))
  )).length;
  const reconcile = {
    rawanConverted: proceeded.length, sherryJobs: jobs.length, matched,
    note: matched === proceeded.length && proceeded.length === jobs.length
      ? 'Rawan converted and Sherry jobs reconcile exactly.'
      : matched + ' of ' + proceeded.length + ' Rawan-converted lead(s) match a Sherry job by name/phone. ' +
        'Counts differ because a same-day lead can be delivered/paid on another day, and walk-in Sherry jobs need not appear in Rawan — reported, not forced.',
  };

  return { dateKey, dayName, dateStr, source: src, sherry, rawan, reconcile };
}

/* ============================================================================
 * IMAGE 1 — SHERRY (operations & actual revenue)
 * ========================================================================== */
function buildSherrySVG(model, logo) {
  const th = THEME.sherry, cv = makeCanvas(th), S = model.sherry, R = model.rawan;
  cv.header('Operations & Revenue', 'SHERRY · CONFIRMED WORK & ACTUAL MONEY', model.dateStr, model.dayName, 'Image 1 / 2 · Sherry', logo);

  if (model.source.sherry !== 'OK') {
    cv.banner('bad', 'SHERRY SOURCE UNAVAILABLE', 'Confirmed-work figures could not be loaded. Values are hidden ("—") — they are NOT zero.');
    cv.kpiRow([
      { label: 'Confirmed Jobs', value: '—' }, { label: 'Confirmed Value', value: '—' },
      { label: 'Received Today', value: '—' }, { label: 'Outstanding', value: '—' }, { label: 'Delivered', value: '—' },
    ]);
    cv.footer('ALMUTARJEM · Sherry Operations · Image 1/2 · source unavailable.');
    return cv.assemble();
  }

  // KPIs
  cv.kpiRow([
    { label: 'Confirmed Jobs', value: String(S.jobs), sub: 'actual work today', accent: th.key },
    { label: 'Confirmed Value', value: AED0(S.confirmedValue), sub: 'total approved AED', accent: th.key },
    { label: 'Received Today', value: AED0(S.received), sub: 'money in', accent: OK, valFill: th.keyDk },
    { label: 'Outstanding', value: AED0(S.outstanding), sub: 'not yet received', accent: S.outstanding > 0 ? WARN : LINE, valFill: S.outstanding > 0 ? '#9A5A08' : INK },
    { label: 'Delivered', value: S.delivered + ' / ' + S.jobs, sub: 'completed / total', accent: th.accent2 },
  ]);

  // Funnel context — SHERRY confirmed FIRST (business priority: actual revenue before potential)
  cv.funnel(
    { tag: 'SHERRY · CONFIRMED (actual)', big: S.jobs + ' jobs', small: AED0(S.confirmedValue), tone: TONE_SHERRY },
    { tag: 'RAWAN · POTENTIAL (leads)', big: R.totalLeads + ' leads', small: AED0(R.potentialValue), tone: TONE_RAWAN },
    R.conversionRate + '% conv',
    { arrow: 'left' }   // potential → confirmed
  );

  // Jobs table
  cv.sectionTitle("Today's Confirmed Jobs", S.jobs + ' job(s) · Sherry');
  cv.table([
    { title: 'Client', w: 226, cell: r => ({ text: r.client, bold: true }) },
    { title: 'Document', w: 210, cell: r => ({ text: r.file, fill: MUTE }) },
    { title: 'Language', w: 184, cell: r => ({ text: r.lang }) },
    { title: 'Confirmed', w: 138, align: 'right', cell: r => ({ text: AED0(r.amount), bold: true }) },
    { title: 'Recv.*', w: 138, align: 'right', cell: r => ({ text: r.received == null ? '—' : AED0(r.received), fill: r.received ? THEME.sherry.keyDk : MUTE }) },
    { title: 'Bal.*', w: 120, align: 'right', cell: r => ({ text: r.balance == null ? '—' : AED0(r.balance), fill: r.balance ? '#9A5A08' : MUTE }) },
    { title: 'Status', w: CW - 226 - 210 - 184 - 138 - 138 - 120, cell: r => ({ pills: [{ label: r.pay, cls: payCls(r.pay) }, { label: r.file2, cls: fileCls(r.file2) }] }) },
  ], S.rows, { empty: 'No confirmed Sherry jobs today.' });
  cv.footer('*  Recv. / Bal. are DERIVED from Payment Status — not source fields. Full money split = the reconciliation below.');

  // Reconciliation bar (honest split — Partial sits in its own "split unknown" bucket, never fabricated)
  cv.sectionTitle('Daily Revenue Reconciliation');
  {
    const iw = CW - 44;
    const seg = (label, val, col, x, w) => `<rect x="${x}" y="0" width="${w}" height="66" rx="12" fill="${col.bg}"/>` +
      T(x + 18, 30, label, { size: 19, weight: 800, fill: col.fg }) + T(x + 18, 58, val, { size: 25, weight: 800, fill: INK });
    // top: full-width CONFIRMED VALUE bar
    let inner = `<rect x="0" y="0" width="${iw}" height="66" rx="12" fill="${th.tint}"/>` +
      T(18, 30, 'CONFIRMED VALUE', { size: 19, weight: 800, fill: th.keyDk }) + T(18, 58, AED(S.confirmedValue), { size: 27, weight: 800, fill: INK });
    // segments row: Received + Outstanding (+ Partial split-unknown when present)
    const segs = [
      { label: 'RECEIVED  (money in)', val: AED(S.received), bg: '#E4F3EC', fg: '#147A50' },
      { label: 'OUTSTANDING  (to collect)', val: AED(S.outstanding), bg: '#FBEED6', fg: '#9A5A08' },
    ];
    if (S.partialUnknown > 0) segs.push({ label: 'PARTIAL  (split unknown)', val: AED(S.partialUnknown), bg: '#EDE6FA', fg: '#5A2FA0' });
    const n = segs.length, gap = 16, segW = (iw - gap * (n - 1)) / n;
    inner += `<g transform="translate(0,82)">`;
    segs.forEach((s2, i) => { inner += seg(s2.label, s2.val, s2, i * (segW + gap), segW); });
    inner += `</g>`;
    // equation row (own line — never clips regardless of segment count)
    const eq = 'CONFIRMED  =  RECEIVED + OUTSTANDING' + (S.partialUnknown > 0 ? ' + PARTIAL(split unknown)' : '');
    const ok = Math.abs(S.reconGap) < 0.01;
    inner += T(0, 178, eq, { size: 21, weight: 700, fill: MUTE });
    inner += T(iw, 178, ok ? '✓ reconciled' : '⚠ gap ' + AED(S.reconGap), { size: 21, weight: 800, fill: ok ? OK : BAD, anchor: 'end' });
    if (S.partialUnknown > 0) inner += T(0, 210, 'Partial amount is neither Received nor Outstanding — the paid split is not in the source, so it is NOT invented.', { size: 19, fill: MUTE });
    cv.panel(inner, S.partialUnknown > 0 ? 220 : 190, { accent: th.key });
  }

  cv.footer('ALMUTARJEM Translation Services · SHERRY — Operations & Actual Revenue · Image 1 of 2. Actual money only (not Rawan potential).');
  return cv.assemble();
}

/* ============================================================================
 * IMAGE 2 — RAWAN (sales leads, lost opportunity, feedback)
 * ========================================================================== */
function buildRawanSVG(model, logo) {
  const th = THEME.rawan, cv = makeCanvas(th), R = model.rawan, S = model.sherry;
  cv.header('Sales Leads & Client Feedback', 'RAWAN · FRONT DESK · OPPORTUNITY & WHY WE LOSE', model.dateStr, model.dayName, 'Image 2 / 2 · Rawan', logo);

  if (model.source.rawan !== 'OK') {
    cv.banner('bad', 'RAWAN SOURCE UNAVAILABLE', 'Lead figures could not be loaded after retries. Values are hidden ("—") — they are NOT zero.');
    cv.kpiRow([
      { label: 'Incoming Leads', value: '—' }, { label: 'Potential Value', value: '—' },
      { label: 'Converted', value: '—' }, { label: 'Conversion', value: '—' }, { label: 'Not Proceeded', value: '—' },
    ]);
    cv.footer('ALMUTARJEM · Rawan Sales · Image 2/2 · source unavailable.');
    return cv.assemble();
  }

  // KPIs
  cv.kpiRow([
    { label: 'Incoming Leads', value: String(R.totalLeads), sub: 'handled today', accent: th.key },
    { label: 'Potential Value', value: AED0(R.potentialValue), sub: 'opportunity (not revenue)', accent: th.accent2, valFill: th.keyDk },
    { label: 'Converted', value: String(R.converted), sub: AED0(R.convertedValue) + ' won', accent: OK, valFill: '#147A50' },
    { label: 'Conversion', value: R.conversionRate + '%', sub: R.converted + ' of ' + R.totalLeads, accent: INFO },
    { label: 'Not Proceeded', value: String(R.lost + R.pending), sub: R.lost + ' lost · ' + R.pending + ' open', accent: WARN, valFill: '#9A5A08' },
  ]);

  // Funnel — CONVERTED (realized) FIRST, then potential; unrealized emphasis below
  cv.funnel(
    { tag: 'CONVERTED (proceeded)', big: R.converted + ' won', small: AED0(R.convertedValue), tone: TONE_SHERRY },
    { tag: 'POTENTIAL (all leads today)', big: R.totalLeads + ' leads', small: AED0(R.potentialValue), tone: TONE_RAWAN },
    R.conversionRate + '%',
    { arrow: 'left' }   // potential → converted
  );
  // Unrealized banner strip
  {
    let s = `<rect x="0" y="0" width="${CW}" height="70" rx="14" fill="#FBEFD6" stroke="#E9C877" stroke-width="2"/>`;
    s += T(24, 44, 'UNREALIZED OPPORTUNITY  (potential − converted)', { size: 23, weight: 800, fill: '#9A5A08' });
    s += T(CW - 24, 46, AED0(R.unrealized), { size: 30, weight: 800, fill: '#9A5A08', anchor: 'end' });
    cv.push(s, 70); cv.spacer(cv.SEP);
  }

  // Reason analysis (two columns): breakdown bars + insights
  cv.sectionTitle('Why Leads Did Not Proceed', R.lost + R.pending + ' non-converted');
  {
    const iw = cv.colInnerW();
    // left: reason bars
    const maxC = Math.max(1, ...R.reasons.map(r => r.count));
    let li = ''; let ly = 6;
    if (!R.reasons.length) li += T(0, 24, 'All leads converted today — no lost/pending reasons.', { size: 23, fill: MUTE });
    R.reasons.forEach(r => {
      const bw = Math.round((iw - 150) * (r.count / maxC));
      li += T(0, ly + 20, r.label, { size: 22, weight: 700, fill: INK });
      li += `<rect x="0" y="${ly + 30}" width="${iw - 150}" height="20" rx="10" fill="#EDEFF4"/>`;
      li += `<rect x="0" y="${ly + 30}" width="${Math.max(8, bw)}" height="20" rx="10" fill="${PF[r.cls] || PF.gray}"/>`;
      li += T(iw, ly + 26, r.count + ' · ' + AED0(r.value), { size: 21, weight: 700, fill: MUTE, anchor: 'end' });
      ly += 64;
    });
    // right: key insights
    let ri = ''; let ry = 4;
    R.insights.forEach(o => {
      wrap(o.k + ': ' + o.v, maxChars(iw, 23)).forEach((ln, i2) => { ri += T(i2 ? 18 : 0, ry + 20, (i2 ? '' : '• ') + ln, { size: 23, weight: i2 ? 400 : 600, fill: i2 ? MUTE : INK }); ry += 34; });
      ry += 8;
    });
    const H = Math.max(ly, ry);
    cv.twoCol(
      { title: 'Reason breakdown', inner: li, accent: th.accent2, h: H },
      { title: 'Key insights', inner: ri, accent: th.key, h: H }
    );
  }

  // Client notes table (the heart of Image 2)
  cv.sectionTitle('Client Notes & Feedback', R.totalLeads + ' lead(s) · read the note');
  cv.table([
    { title: 'Client', w: 250, cell: r => ({ text: r.client, bold: true }) },
    { title: 'Potential', w: 140, align: 'right', cell: r => ({ text: r.hasAmt ? AED0(r.amt) : '—', bold: true, fill: r.hasAmt ? THEME.rawan.keyDk : MUTE }) },
    { title: 'Reason', w: 224, cell: r => ({ pills: [{ label: r.reason, cls: r.cls }] }) },
    { title: 'Rawan Note', w: 416, cell: r => ({ text: r.note }) },
    { title: 'Next Action', w: CW - 250 - 140 - 224 - 416, cell: r => ({ text: r.next, fill: MUTE }) },
  ], R.noteRows, { empty: 'No Rawan leads recorded today.' });

  // Recommended actions
  cv.sectionTitle('Recommended Actions');
  {
    let inner = ''; let yy = 26; const tx = 44;
    R.recs.forEach(r => {
      inner += T(0, yy, r.ic, { size: 26, weight: 800, fill: r.c });
      wrap(r.t, maxChars(CW - 44 - tx, 24)).forEach((ln, i2) => { inner += lineT(tx, CW - 44, yy, ln, { size: 24, fill: INK }); yy += 34; });
      yy += 12;
    });
    cv.panel(inner, yy - 20, { accent: th.key, bg: '#FBFAFE' });
  }

  cv.footer('ALMUTARJEM Translation Services · RAWAN — Sales Leads & Feedback · Image 2 of 2. Potential = opportunity, NOT actual revenue.');
  return cv.assemble();
}

/* status → pill class (Sherry) */
function payCls(s) { s = String(s || '').toLowerCase(); if (/cancel/.test(s)) return 'red'; if (/paid|received|collected|settled/.test(s)) return 'green'; if (/partial|deposit|advance/.test(s)) return 'purple'; return 'orange'; }
function fileCls(s) { s = String(s || '').toLowerCase(); if (/deliver|complete|done|ready|collected/.test(s)) return 'green'; if (/progress|process|working/.test(s)) return 'blue'; if (/cancel/.test(s)) return 'red'; return 'orange'; }

/* ============================================================================
 * RENDER
 * ========================================================================== */
async function renderTwoImages(model, dir, opts) {
  opts = opts || {};
  const logo = RI.loadLogo(opts.logoPath || require('path').join(__dirname, 'assets', 'almutarjem-logo.png'));
  const out = [];
  const pages = [
    { name: 'SHERRY', svg: buildSherrySVG(model, logo) },
    { name: 'RAWAN', svg: buildRawanSVG(model, logo) },
  ];
  const path = require('path');
  for (const p of pages) {
    const outPath = path.join(dir, p.name + '.png');
    const r = await RI.rasterise(p.svg.svg, outPath);
    out.push({ name: p.name, path: outPath, width: r.width, height: r.height, size: r.size, renderer: r.renderer });
  }
  return out;
}

module.exports = { computeModelV2, buildSherrySVG, buildRawanSVG, renderTwoImages, classifyRawan, reconcileFunnel, W };
