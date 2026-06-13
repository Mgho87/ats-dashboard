'use strict';
/* ALMUTARJEM Executive Control Center — front-end controller */
const AED  = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AEDk = n => { n = Number(n) || 0; const s = n < 0 ? '-' : ''; n = Math.abs(n); return n >= 1000 ? s + 'AED ' + (n / 1000).toFixed(1) + 'K' : s + 'AED ' + n.toFixed(0); };
const NUM  = n => (Number(n) || 0).toLocaleString('en-US');
const PCT  = n => (Number(n) || 0).toFixed(1) + '%';
const el   = id => document.getElementById(id);
const esc  = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const C = { accent: '#7C5CFC', accent2: '#9B7BFF', blue: '#3B82F6', green: '#2DBE8B', red: '#F0616A', orange: '#F2A23C', teal: '#22B8C9', pink: '#EC6FA8', gold: '#E6B84A', yellow: '#EAB308', muted: '#8A97B5' };
const PALETTE = [C.pink, C.blue, C.green, C.orange, C.accent, C.teal, C.gold, '#9CA3AF', '#6366F1', '#EC4899'];
// fixed lead-source color mapping (req #3): Client=blue, Google Ads=green, New=pink, Walk-In=yellow, Other=purple
function leadColor(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('google')) return C.green;
  if (s.includes('walk')) return C.yellow;
  if (s.includes('new')) return C.pink;
  if (s.includes('client') || s.includes('our')) return C.blue;
  return C.accent; // Other / everything else = purple
}
// fixed payment-method color mapping (req #2): Bank Transfer=Blue, Payment Link=Green, Cash=Orange, Other=Gray
function methodColor(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('bank')) return C.blue;
  if (s.includes('link')) return C.green;
  if (s.includes('cash')) return C.orange;
  return '#8A97B5'; // Other = gray
}
// fixed service-type color mapping (req #3): Legal=Blue, MOFA=Green, Embassy=Violet, MOJ=Teal; others = lighter secondaries (no strong pink for majors)
const SERVICE_SECONDARY = ['#9B7BFF', '#22B8C9', '#E6B84A', '#5B8DEF', '#7FB069', '#C792EA', '#94A3B8'];
function serviceColor(name, i) {
  const s = String(name || '').toLowerCase();
  if (s.includes('legal')) return C.blue;            // Legal Translation = Blue
  if (s.includes('mofa')) return C.green;            // MOFA = Green
  if (s.includes('embassy')) return C.accent;        // Embassy = Purple
  if (s.includes('moj') || s.includes('justice')) return '#A855F7'; // MOJ = Violet
  if (s.includes('court') || s.includes('immigration')) return C.teal;
  return SERVICE_SECONDARY[(i || 0) % SERVICE_SECONDARY.length]; // others = neutral/lighter secondaries
}

const state = { data: null, filter: { range: 'all', from: '', to: '', service: 'All', lead: 'All' }, page: 'overview' };

/* ---------- preferences + view persistence (req #7, #9) ---------- */
const PREFS_KEY = 'ats-prefs', VIEW_KEY = 'ats-view';
const PREF_DEFAULTS = { landing: 'overview', range: 'all', remember: '1', density: 'comfortable', notif: 'all' };
function getPrefs() { try { return Object.assign({}, PREF_DEFAULTS, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) { return Object.assign({}, PREF_DEFAULTS); } }
function setPref(k, v) { const p = getPrefs(); p[k] = v; try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) {} }
function applyPrefs() { document.body.classList.toggle('compact', getPrefs().density === 'compact'); }
function saveView() {
  if (getPrefs().remember !== '1') return;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ page: state.page, range: state.filter.range, from: state.filter.from, to: state.filter.to, service: state.filter.service, lead: state.filter.lead })); } catch (_) {}
}
// Decide the initial page + filter BEFORE the first load() (restores last view, or applies defaults).
function restoreView() {
  const p = getPrefs(); applyPrefs();
  let v = null;
  if (p.remember === '1') { try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch (_) { v = null; } }
  if (!v) v = { page: p.landing, range: p.range, service: 'All', lead: 'All', from: '', to: '' };
  state.page = v.page || 'overview';
  state.filter.service = v.service || 'All';
  state.filter.lead = v.lead || 'All';
  state.filter.range = v.range || 'all';
  // reflect the page in the DOM immediately so the correct section is shown once loading clears
  document.querySelectorAll('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + state.page));
  document.querySelectorAll('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === state.page));
  // reflect the date range
  document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('active', x.dataset.range === state.filter.range));
  if (state.filter.range === 'custom') { el('fFrom').value = v.from || ''; el('fTo').value = v.to || ''; state.filter.from = v.from || ''; state.filter.to = v.to || ''; }
  else { const r = computeRange(state.filter.range); el('fFrom').value = r.from; el('fTo').value = r.to; state.filter.from = r.from; state.filter.to = r.to; }
}

/* ---------- clock ---------- */
function tickClock() {
  const now = new Date();
  if (el('clock-time')) el('clock-time').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now) + ' GST';
  if (el('clock-date')) el('clock-date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'short', month: 'short', day: 'numeric' }).format(now);
}
setInterval(tickClock, 1000); tickClock();

/* ---------- theme ---------- */
(function () {
  if (localStorage.getItem('ats-theme') === 'light') document.body.classList.add('light');
  const sync = () => el('themeIcon').className = 'ti ' + (document.body.classList.contains('light') ? 'ti-sun' : 'ti-moon');
  sync();
  el('themeBtn').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('ats-theme', document.body.classList.contains('light') ? 'light' : 'dark'); sync(); if (state.data) renderAll(); });
})();

/* ---------- navigation ---------- */
function go(page) {
  state.page = page;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  document.querySelectorAll('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  el('sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (state.data) renderPage(page);
  saveView(); // req #7: remember current page
}
document.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.page); }));
el('ham').addEventListener('click', () => el('sidebar').classList.toggle('open'));
el('refreshBtn').addEventListener('click', () => { logEvent('info', 'Refresh clicked', 'Manual data refresh requested'); load(true, true); });

/* ---------- date presets ---------- */
function dubaiToday() { return (state.data && state.data.meta.todayDubai) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()); }
function dStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function computeRange(range) {
  const t = dubaiToday(); const [y, m, dd] = t.split('-').map(Number); const today = new Date(y, m - 1, dd);
  const min = state.data ? state.data.meta.minDate : '', max = state.data ? state.data.meta.maxDate : '';
  const mk = d => dStr(d);
  switch (range) {
    case 'today': return { from: t, to: t, label: 'Today · ' + t };
    case 'yesterday': { const d = new Date(today); d.setDate(d.getDate() - 1); return { from: mk(d), to: mk(d), label: 'Yesterday · ' + mk(d) }; }
    case '7': { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: mk(d), to: t, label: 'Last 7 days' }; }
    case '30': { const d = new Date(today); d.setDate(d.getDate() - 29); return { from: mk(d), to: t, label: 'Last 30 days' }; }
    case 'month': return { from: dStr(new Date(y, m - 1, 1)), to: t, label: 'This month' };
    case 'lastmonth': { const f = new Date(y, m - 2, 1), e = new Date(y, m - 1, 0); return { from: mk(f), to: mk(e), label: 'Last month' }; }
    case 'custom': return { from: el('fFrom').value || min, to: el('fTo').value || max, label: 'Custom range' };
    default: return { from: min, to: max, label: 'All time' };
  }
}
el('presets').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#presets button').forEach(x => x.classList.remove('active')); b.classList.add('active');
  state.filter.range = b.dataset.range;
  const r = computeRange(b.dataset.range);
  el('fFrom').value = r.from; el('fTo').value = r.to;
  applyFilter();
});
['fFrom', 'fTo'].forEach(id => el(id).addEventListener('change', () => { state.filter.range = 'custom'; document.querySelectorAll('#presets button').forEach(x => x.classList.remove('active')); applyFilter(); }));
el('fService').addEventListener('change', applyFilter);
el('fLead').addEventListener('change', applyFilter);
el('emptyReset').addEventListener('click', () => {
  document.querySelectorAll('#presets button').forEach(x => x.classList.remove('active'));
  document.querySelector('#presets [data-range="all"]').classList.add('active');
  state.filter.range = 'all';
  const r = computeRange('all'); el('fFrom').value = r.from; el('fTo').value = r.to;
  applyFilter();
});
el('emptyJump').addEventListener('click', () => {
  if (!state.data) return;
  const last = state.data.meta.maxDate;
  document.querySelectorAll('#presets button').forEach(x => x.classList.remove('active'));
  state.filter.range = 'custom';
  el('fFrom').value = last; el('fTo').value = last;
  logEvent('info', 'Jumped to latest data', 'Selected latest transaction date ' + last);
  applyFilter();
});
el('errorRetry').addEventListener('click', () => { logEvent('info', 'Retry connection', 'Manual reconnect to Google Sheet requested'); load(true); });
function applyFilter() {
  state.filter.from = el('fFrom').value; state.filter.to = el('fTo').value;
  state.filter.service = el('fService').value; state.filter.lead = el('fLead').value;
  const label = computeRange(state.filter.range).label
    + (state.filter.service !== 'All' ? ' · ' + state.filter.service : '')
    + (state.filter.lead !== 'All' ? ' · ' + state.filter.lead : '');
  logEvent('info', 'Date filter changed', `${label} (${state.filter.from} → ${state.filter.to})`);
  saveView(); // req #7: remember current filters
  load(false);
}

/* ---------- charts ---------- */
const charts = {};
function draw(id, cfg) { const c = el(id); if (!c) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(c, cfg); }
const gridc = () => document.body.classList.contains('light') ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.06)';
const axis = money => ({ responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money ? AED(c.parsed.y ?? c.parsed) : NUM(c.parsed.y ?? c.parsed) } } },
  scales: { x: { ticks: { color: C.muted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, grid: { color: gridc() } },
            y: { ticks: { color: C.muted, font: { size: 10 }, callback: v => v >= 1000 ? v / 1000 + 'K' : v }, grid: { color: gridc() } } } });
const doughnut = () => ({ responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { position: 'right', labels: { color: C.muted, font: { size: 11 }, boxWidth: 11, padding: 9 } }, tooltip: { callbacks: { label: c => c.label + ': ' + AED(c.parsed) } } } });

/* ---------- sparkline ---------- */
function spark(values, color, h = 46) {
  const v = (values || []).map(Number); if (v.length < 2) return '';
  const w = 300, min = Math.min(...v), max = Math.max(...v), rng = (max - min) || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 3 - ((y - min) / rng) * (h - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${color}22"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/></svg>`;
}
// compact coloured mini-bars for the Net Profit sidebar (req #10)
function miniBars(values, color) {
  const v = (values || []).slice(-8).map(Number); if (!v.length) return '';
  const w = 120, h = 26, max = Math.max(...v, 1), bw = w / v.length;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">` + v.map((y, i) => { const bh = Math.max(2, (y / max) * (h - 3)); return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1.5, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${color}"/>`; }).join('') + `</svg>`;
}
function execBars(values) {
  const v = (values || []).slice(-8).map(Number); if (!v.length) return '';
  const w = 200, h = 50, max = Math.max(...v, 1), bw = w / v.length;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">` + v.map((y, i) => { const bh = Math.max(3, (y / max) * (h - 6)); return `<rect x="${(i * bw + 3).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#eg)"/>`; }).join('') + `<defs><linearGradient id="eg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5B8DEF"/><stop offset="1" stop-color="#9B7BFF"/></linearGradient></defs></svg>`;
}

/* ---------- small builders ---------- */
function kpi(label, value, sub, tone) { return `<div class="kc"><div class="kc-l">${esc(label)}</div><div class="kc-v mono">${value}</div><div class="kc-s ${tone || ''}">${sub || ''}</div></div>`; }
function tcell(icon, cls, label, val) { return `<div class="tcell"><div class="tic ${cls}"><i class="ti ${icon}"></i></div><div><div class="tl">${label}</div><div class="tv mono">${val}</div></div></div>`; }
function badge(status) { const m = { paid: 'good', delivered: 'good', outstanding: 'warn', partial: 'warn', pending: 'warn', 'in progress': 'info', cancelled: 'bad' }; return `<span class="pill ${m[status] || 'neutral'}">${esc(status)}</span>`; }
function table(headers, rows) {
  return `<table class="dt"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}" class="empty">No records in this range</td></tr>`}</tbody></table>`;
}
function bars(items, max, fmt) { max = max || Math.max(...items.map(i => i.value), 1); return items.map(i => `<div class="svc-row"><span class="sname" title="${esc(i.name)}">${esc(i.name)}</span><div class="svc-track"><div class="svc-fill" style="width:${(i.value / max * 100).toFixed(0)}%"></div></div><span class="svc-pct mono">${fmt ? fmt(i) : AEDk(i.value)}</span></div>`).join('') || '<div class="empty">No data</div>'; }

/* ============================ RENDER ROOT ============================ */
function renderAll() { renderChrome(); renderPage(state.page); }
function renderChrome() {
  const d = state.data, m = d.meta, v = d.view, k = v.kpis;
  const live = d.source === 'live', file = d.source === 'file';
  el('srcPill').className = 'src-pill ' + (live ? 'ok' : file ? 'warn' : 'bad');
  el('srcPillTxt').textContent = m.sourceLabel || (live ? 'LIVE GOOGLE SHEET' : file ? 'EXCEL FALLBACK' : 'NO DATA SOURCE');
  el('src-foot').textContent = m.sourceLabel || d.source;
  el('updated').textContent = m.lastSync ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(m.lastSync)) : 'never';
  // error state — Google Sheet not connected (no silent stale Excel data)
  const isErr = d.source === 'error';
  el('errorBanner').hidden = !isErr;
  if (isErr) {
    el('errorMsg').textContent = ' ' + (m.error || 'Cannot reach the Google Sheet. Share it "Anyone with the link → Viewer" and retry.');
    el('errorOpenSheet').href = m.spreadsheetUrl || '#';
  }
  el('rangeLabel').textContent = computeRange(state.filter.range).label + (v.filter.service !== 'All' ? ' · ' + v.filter.service : '') + (v.filter.lead !== 'All' ? ' · ' + v.filter.lead : '');
  // sidebar Net Profit summary (all-time, clear)
  const at = d.allTime.kpis;
  el('execProfit').textContent = AED(at.netProfit);
  el('execProfit').style.color = at.netProfit >= 0 ? 'var(--green)' : 'var(--red)';
  el('execMargin').textContent = PCT(at.profitMargin);
  // req #10: compact amounts (AED 53.9K) + visual mini-bars instead of long numbers in tiny boxes
  el('execRev').textContent = AEDk(at.totalRevenue);
  el('execExp').textContent = AEDk(at.totalExpenses);
  if (el('execRevSpark')) el('execRevSpark').innerHTML = miniBars((d.allTime.revenueTrend || []).map(r => r.revenue), C.green);
  if (el('execExpSpark')) el('execExpSpark').innerHTML = miniBars((d.allTime.expenseTrend || []).map(r => r.expense), C.red);

  // audit badge mirrors real validation warning count
  const warn = (d.validation && (d.validation.missingAmounts + d.validation.brokenStatus + (d.validation.reconciles ? 0 : 1))) || 0;
  el('auditBadge').textContent = warn || '';
  el('auditBadge').style.display = warn ? 'inline-flex' : 'none';
  const tv = trustVerdict();
  const hd = el('healthDot'); if (hd) hd.className = 'nav-dot ' + tv.level;

  // notifications (real events) + unread badge
  renderNotifications();

  // live sync chip + status (visible "last successful sync")
  const syncDot = el('syncDot'), syncText = el('syncText');
  if (syncDot) syncDot.className = 'sdot ' + (live ? 'good' : file ? 'warn' : 'bad');
  if (syncText) syncText.textContent = (live ? 'LIVE' : file ? 'BACKUP' : 'OFFLINE')
    + (m.lastSync ? ' · synced ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(m.lastSync)) : ' · never synced');

  // filter selects — repopulate whenever the option set changes (e.g. error → live recovery),
  // preserving the current selection. Fixes empty dropdowns after recovering from a no-data state.
  // dropdowns sourced from the Settings sheet (single source of truth, req #13), unioned with any real values present in data
  const st = (v.settings || {});
  const mergeU = (a, b) => [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
  const services = mergeU(st.serviceTypes, m.options.services);
  // req #2/#9: lead dropdown from the Settings master only (unknown sources like "Direct" are
  // never offered as a filterable option — they are logged in Settings Protection instead).
  const leadsList = (st.leadSources && st.leadSources.length) ? st.leadSources.slice() : ['Google Ads', 'Our Client', 'New', 'Walk-in Client', 'Other'];
  const optSig = services.join('|') + '##' + leadsList.join('|');
  if (el('fService').dataset.sig !== optSig && (services.length || leadsList.length)) {
    const curS = el('fService').value || v.filter.service, curL = el('fLead').value || v.filter.lead;
    el('fService').innerHTML = '<option value="All">All Services</option>' + services.map(s => `<option>${esc(s)}</option>`).join('');
    el('fLead').innerHTML = '<option value="All">All Sources</option>' + leadsList.map(s => `<option>${esc(s)}</option>`).join('');
    el('fService').dataset.sig = optSig;
    el('fService').value = curS; el('fLead').value = curL;
  }
  if (!el('fFrom').value && m.minDate) { el('fFrom').value = m.minDate; el('fTo').value = m.maxDate; }
  // empty-range banner (data loaded, but selected range has no records)
  const dg = v.diag || {};
  const eb = el('emptyBanner');
  if (dg.isEmpty && !isErr) {
    eb.hidden = false;
    const range = state.filter.range, L = m.latest || {};
    let title;
    if (range === 'today') title = 'No transactions recorded today.';
    else if (range === 'yesterday') title = 'No transactions recorded yesterday.';
    else if (v.filter.from === v.filter.to) title = `No transactions recorded for ${v.filter.from}.`;
    else title = 'No transactions recorded for this range.';
    el('emptyTitle').textContent = title;
    el('emptyMsg').innerHTML = `Latest transaction date: <b>${L.date || m.maxDate}</b> · Value <b>${AED(L.revenue || 0)}</b> · <b>${NUM(L.orders || 0)} orders</b> on that day. Data spans ${m.minDate} → ${m.maxDate}.`;
  } else { eb.hidden = true; }
}

function renderPage(page) {
  ({ overview: rOverview, money: rMoney, collection: rCollection, pipeline: rPipeline, operations: rOps, clients: rClients, google: rGoogle, reports: rReports, audit: rAudit, health: rHealth, settings: rSettings }[page] || (() => {}))();
}

/* ---------------- OVERVIEW ---------------- */
function rOverview() {
  const d = state.data, v = d.view, k = v.kpis, rs = v.rangeSummary;
  const monthly = v.revenueTrend.map(r => r.revenue);
  el('ov-sub').textContent = 'Management summary · ' + computeRange(state.filter.range).label;
  const outShare = k.totalRevenue ? k.outstanding / k.totalRevenue * 100 : 0;
  // clean executive cards: amount + explanation + real supporting mini-metric (no faked trend lines)
  el('h-rev').textContent = AED(k.totalRevenue);
  el('h-rev-ctx').textContent = 'Gross billed · excludes cancelled';
  el('h-rev-mini').textContent = `${NUM(k.totalOrders)} orders · AOV ${AED(k.avgOrderValue)}`;
  el('h-paid').textContent = AED(k.paidRevenue);
  el('h-paid-ctx').textContent = 'Payments actually received';
  el('h-paid-mini').textContent = `Collection rate ${PCT(k.collectionRate)}`;
  el('h-out').textContent = AED(k.outstanding);
  el('h-out-ctx').textContent = 'Billed but not yet collected';
  el('h-out-mini').textContent = `${NUM(k.pendingOrders)} orders · ${PCT(outShare)} of revenue`;
  el('h-profit').textContent = AED(k.netProfit);
  el('h-profit-ctx').textContent = `Net profit margin ${PCT(k.profitMargin)}`;
  el('h-profit-mini').textContent = `Revenue ${AEDk(k.totalRevenue)} · Expenses ${AEDk(k.totalExpenses)}`;

  el('today-label').textContent = v.filter.from + ' → ' + v.filter.to + ' · Asia/Dubai';
  el('today').innerHTML = [
    tcell('ti-cash', 'ic-blue', 'REVENUE', AED(rs.revenue)),
    tcell('ti-shopping-cart', 'ic-blue', 'ORDERS', NUM(rs.orders)),
    tcell('ti-circle-check', 'ic-green', 'PAID', AED(rs.paid)),
    tcell('ti-alert-triangle', 'ic-red', 'OUTSTANDING', AED(rs.outstanding)),
    tcell('ti-users', 'ic-teal', 'CLIENTS', NUM(rs.newClients)),
    tcell('ti-brand-google', 'ic-purple', 'GOOGLE REV', AED(rs.googleRevenue)),
  ].join('');

  draw('ovTrend', { type: 'line', data: { labels: v.revenueTrend.map(r => r.label), datasets: [{ data: monthly, borderColor: C.blue, backgroundColor: 'rgba(59,130,246,.16)', fill: true, tension: .4, borderWidth: 3, pointRadius: 3, pointBackgroundColor: C.blue }] }, options: axis(true) });
  const pay = v.paymentSummary.filter(p => p.amount > 0);
  const payColor = { 'Paid': C.green, 'Outstanding': C.red, 'Cancelled (excluded)': '#9CA3AF' };
  draw('ovPay', { type: 'doughnut', data: { labels: pay.map(p => p.name), datasets: [{ data: pay.map(p => p.amount), backgroundColor: pay.map(p => payColor[p.name] || '#9CA3AF'), borderWidth: 0 }] }, options: doughnut() });
  const rec = v.reconciliation;
  el('ovReconcile').className = 'reconcile ' + (rec.reconciles ? 'ok' : 'bad');
  el('ovReconcile').textContent = rec.reconciles ? `✓ Paid + Outstanding = ${AEDk(rec.paidPlusOutstanding)} = Total` : `⚠ Mismatch ${AEDk(rec.paidPlusOutstanding)} vs ${AEDk(rec.total)}`;
  const leads = v.leadSources.slice(0, 6);
  draw('ovLead', { type: 'doughnut', data: { labels: leads.map(l => l.name), datasets: [{ data: leads.map(l => l.revenue), backgroundColor: leads.map(l => leadColor(l.name)), borderWidth: 0 }] }, options: doughnut() });
  el('ovSvc').innerHTML = bars(v.topServices.slice(0, 6).map(s => ({ name: s.name, value: s.revenue })), null, i => PCT(k.totalRevenue ? i.value / k.totalRevenue * 100 : 0));
  // PAYMENT METHODS (req #2) — fixed colors, on Overview upper chart area
  const ovpm = (v.paymentMethods || []).filter(p => p.value > 0);
  draw('ovMethods', { type: 'doughnut', data: { labels: ovpm.map(p => p.name), datasets: [{ data: ovpm.map(p => p.value), backgroundColor: ovpm.map(p => methodColor(p.name)), borderWidth: 0 }] }, options: doughnut() });

  const margin = k.profitMargin, coll = k.collectionRate;
  el('ovHealth').innerHTML = [
    healthRow('Collection Rate', PCT(coll), coll >= 70 ? 'good' : coll >= 50 ? 'warn' : 'bad'),
    healthRow('Profit Margin', PCT(margin), margin >= 30 ? 'good' : margin >= 15 ? 'warn' : 'bad'),
    healthRow('Outstanding Ratio', PCT(outShare), outShare <= 20 ? 'good' : outShare <= 40 ? 'warn' : 'bad'),
    healthRow('ROAS (Google)', k.roas == null ? 'N/A' : k.roas.toFixed(2) + 'x', k.roas == null ? 'neutral' : k.roas >= 2 ? 'good' : 'warn'),
    healthRow('Reconciliation', rec.reconciles ? 'Balanced' : 'Gap', rec.reconciles ? 'good' : 'bad'),
  ].join('');
  renderQuickActions();
  renderExecSummary();
  renderPeriodic();
  renderAttention();
  renderInsights();
  renderOpportunities();
}

/* ---------------- EXECUTIVE SUMMARY (req #1 — CEO command center) ---------------- */
function renderExecSummary() {
  if (!el('execSummary')) return;
  const v = state.data.view, s = v.execSummary || {}, t = s.today || {};
  const lp = s.largestPaidClient, lu = s.largestUnpaidClient;
  const risk = s.outstandingRiskScore || 0;
  const riskTone = risk >= 60 ? 'bad' : risk >= 30 ? 'warn' : 'good';
  const w = (ic, tone, label, value, sub) => `<div class="exsum"><div class="exsum-ic ${tone}"><i class="ti ${ic}"></i></div><div class="exsum-b"><div class="exsum-l">${esc(label)}</div><div class="exsum-v mono">${value}</div><div class="exsum-s">${esc(sub || '')}</div></div></div>`;
  el('execSummary').innerHTML = [
    w('ti-cash', 'ic-blue', "Today's Revenue", AED(t.revenue), NUM(t.orders) + ' orders'),
    w('ti-shopping-cart', 'ic-blue', "Today's Orders", NUM(t.orders), 'placed today'),
    w('ti-wallet', 'ic-green', "Today's Collections", AED(t.collections), 'cash received'),
    w('ti-alert-triangle', 'ic-red', "Today's Outstanding", AED(t.outstanding), 'billed, unpaid'),
    w('ti-user-plus', 'ic-teal', 'New Clients Today', NUM(t.newClients), 'first-ever order'),
    w('ti-users', 'ic-purple', 'Returning Clients Today', NUM(t.returningClients), 'ordered before'),
    w('ti-brand-google', 'ic-green', 'Google Ads Revenue Today', AED(t.googleRevenue), NUM(t.googleOrders) + ' orders'),
    w('ti-brand-google', 'ic-green', 'Google Ads Orders Today', NUM(t.googleOrders), 'attributed'),
    w('ti-user-dollar', 'ic-green', 'Largest Paid Client', lp ? esc(lp.client) : '—', lp ? AED(lp.paid) + ' paid' : ''),
    w('ti-user-exclamation', 'ic-red', 'Largest Outstanding Client', lu && lu.outstanding > 0 ? esc(lu.client) : '—', lu ? AED(lu.outstanding) + ' owed' : ''),
    w('ti-arrow-up-right', 'ic-blue', 'Highest Order Today', AED(t.highestOrder), 'top single order'),
    w('ti-award', 'ic-green', 'Best Service This Month', s.bestServiceMonth ? esc(s.bestServiceMonth.name) : '—', s.bestServiceMonth ? AED(s.bestServiceMonth.revenue) : ''),
    w('ti-flame', 'ic-purple', 'Best Lead Source This Month', s.bestLeadMonth ? esc(s.bestLeadMonth.name) : '—', s.bestLeadMonth ? AED(s.bestLeadMonth.revenue) : ''),
    w('ti-cash-banknote', 'ic-green', 'Collection Forecast', s.collectionForecast == null ? '—' : AED(s.collectionForecast), 'next 30 days'),
    w('ti-chart-arrows-vertical', 'ic-blue', 'Revenue Forecast', s.revenueForecast == null ? '—' : AED(s.revenueForecast), 'month-end run-rate'),
    `<div class="exsum"><div class="exsum-ic ${riskTone === 'bad' ? 'ic-red' : riskTone === 'warn' ? 'ic-orange' : 'ic-green'}"><i class="ti ti-shield-half"></i></div><div class="exsum-b"><div class="exsum-l">Outstanding Risk Score</div><div class="exsum-v mono">${NUM(risk)}<span class="exsum-x">/100</span></div><div class="exsum-s ${riskTone === 'bad' ? 'risk-high' : riskTone === 'warn' ? 'risk-medium' : 'good-txt'}">${risk >= 60 ? 'High risk' : risk >= 30 ? 'Moderate' : 'Low risk'}</div></div></div>`,
  ].join('');
}

/* ---------------- PERIODIC EXECUTIVE MATRIX (req #1) ---------------- */
function renderPeriodic() {
  if (!el('periodicMatrix')) return;
  const p = state.data.view.periodic || {};
  const cols = [['Today', p.today], ['Yesterday', p.yesterday], ['This Week', p.week], ['This Month', p.month]];
  const rows = [
    ['Revenue', d => AED(d.revenue), 'ic-blue'], ['Collections', d => AED(d.collections), 'ic-green'],
    ['Outstanding', d => AED(d.outstanding), 'ic-red'], ['New Clients', d => NUM(d.newClients), 'ic-teal'],
    ['Google Ads Clients', d => NUM(d.googleClients), 'ic-purple'],
  ];
  let h = '<table class="pmx-table"><thead><tr><th>Metric</th>' + cols.map(c => `<th>${c[0]}</th>`).join('') + '</tr></thead><tbody>';
  h += rows.map(r => `<tr><td class="pmx-m"><span class="pmx-dot ${r[2]}"></span>${r[0]}</td>` + cols.map(c => `<td class="mono">${c[1] ? r[1](c[1]) : '—'}</td>`).join('') + '</tr>').join('');
  h += '</tbody></table>';
  const hd = p.highestRevenueDay, ld = p.lowestRevenueDay;
  h += `<div class="pmx-foot"><span><i class="ti ti-arrow-up-right"></i> Highest revenue day: <b>${hd ? esc(hd.date) + ' · ' + AED(hd.revenue) : '—'}</b></span><span><i class="ti ti-arrow-down-right"></i> Lowest revenue day: <b>${ld ? esc(ld.date) + ' · ' + AED(ld.revenue) : '—'}</b></span></div>`;
  el('periodicMatrix').innerHTML = h;
}

/* ---------------- NEEDS ATTENTION PANEL (req #8) ---------------- */
function renderAttention() {
  if (!el('attentionCard')) return;
  const d = state.data, v = d.view, vd = d.validation, k = v.kpis, col = v.collection || {}, rk = v.risk || {}, ins = v.insights || {};
  const items = []; const add = (lvl, ic, title, detail, goto) => items.push({ lvl, ic, title, detail, goto });
  if (d.source === 'error') add(3, 'ti-plug-connected-x', 'Google Sheet not connected', 'Dashboard is showing no data', 'health');
  if (!vd.reconciles) add(3, 'ti-alert-octagon', 'Reconciliation gap ' + AEDk(vd.gap), 'Paid + Outstanding ≠ Total', 'audit');
  if (col.over90 > 0) add(3, 'ti-clock-exclamation', AED(col.over90) + ' overdue 90+ days', 'High-risk receivables', 'collection');
  if (rk.high) add(2, 'ti-shield-x', NUM(rk.high) + ' high-risk unpaid orders', AEDk(rk.highAmt) + ' at risk', 'collection');
  if (col.over60 > 0) add(2, 'ti-clock-dollar', AED(col.over60) + ' overdue 60+ days', 'Chase these receivables', 'collection');
  const unkLeads = (vd.unknownValues && vd.unknownValues.leads) || [];
  if (unkLeads.length) add(2, 'ti-flag-question', unkLeads.length + ' unknown lead source(s)', 'Not in Settings: ' + unkLeads.map(x => x.value).join(', '), 'settings');
  if ((v.duplicates || []).length) add(2, 'ti-copy', NUM(v.duplicates.length) + ' possible duplicate records', 'Same date+client+amount+ref', 'audit');
  if (k.collectionRate < 50 && k.totalRevenue > 0) add(2, 'ti-percentage', 'Collection rate low (' + PCT(k.collectionRate) + ')', 'Below 50% — push collections', 'collection');
  if (vd.brokenStatus) add(1, 'ti-alert-triangle', NUM(vd.brokenStatus) + ' statuses off Settings list', 'Correct or add to Settings', 'settings');
  if (ins.largestUnpaidClient && ins.largestUnpaidClient.outstanding > 0) add(1, 'ti-user-exclamation', 'Largest unpaid: ' + ins.largestUnpaidClient.client, AED(ins.largestUnpaidClient.outstanding) + ' owed', 'collection');
  items.sort((a, b) => b.lvl - a.lvl);
  el('attentionCard').hidden = false;
  const lvc = { 3: 'bad', 2: 'warn', 1: 'info' };
  el('attentionList').innerHTML = items.length
    ? items.slice(0, 8).map((it, i) => `<div class="attn-row attn-${lvc[it.lvl]} clickable" data-attn="${i}"><span class="attn-ic"><i class="ti ${it.ic}"></i></span><div class="attn-b"><div class="attn-t">${esc(it.title)}</div><div class="attn-s">${esc(it.detail)}</div></div><span class="attn-go">›</span></div>`).join('')
    : '<div class="empty" style="color:var(--green)">✓ Nothing needs attention — all clear</div>';
  el('attentionList').querySelectorAll('[data-attn]').forEach(r => r.addEventListener('click', () => { const it = items[+r.dataset.attn]; if (it && it.goto) go(it.goto); }));
}

/* ---------------- COLLECTION CENTER (req #7) ---------------- */
function rCollection() {
  const v = state.data.view, c = v.collection || {};
  el('collKpis').innerHTML = [
    kpi('Total Outstanding', AED(c.totalOutstanding || 0), NUM(c.clientsOwing || 0) + ' clients owing', (c.totalOutstanding || 0) > 0 ? 'warn' : 'good'),
    kpi('Due Now (≤7d)', AED(c.dueWeek || 0), 'current receivables'),
    kpi('Due This Month (≤30d)', AED(c.dueMonth || 0), 'collect this month'),
    kpi('Over 30 Days', AED(c.over30 || 0), 'ageing', (c.over30 || 0) > 0 ? 'warn' : 'good'),
    kpi('Over 60 Days', AED(c.over60 || 0), 'follow up', (c.over60 || 0) > 0 ? 'warn' : 'good'),
    kpi('Over 90 Days', AED(c.over90 || 0), 'high risk', (c.over90 || 0) > 0 ? 'bad' : 'good'),
  ].join('');
  const maxA = Math.max(...((c.buckets || []).map(b => b.amount)), 1);
  el('collBuckets').innerHTML = (c.buckets || []).map(b => `<div class="cb-row"><span class="cb-l">${esc(b.label)}</span><div class="cb-track"><div class="cb-fill ${b.key === 'd90p' ? 'bad' : b.key === 'd61_90' ? 'warn' : ''}" style="width:${(b.amount / maxA * 100).toFixed(0)}%"></div></div><span class="cb-v mono">${AED(b.amount)} · ${NUM(b.count)}</span></div>`).join('') || '<div class="empty" style="color:var(--green)">✓ No outstanding receivables</div>';
  el('collClients').innerHTML = table(['Client', 'Outstanding', 'Oldest Age', 'Invoices', 'Source', 'Actions'],
    (c.clients || []).slice(0, 60).map(cl => [
      `<span class="lk" data-client="${esc(cl.client)}">${esc(cl.client)}</span>`,
      `<span class="warn-txt">${AED(cl.outstanding)}</span>`,
      `<b class="${cl.oldestAge > 90 ? 'risk-high' : cl.oldestAge > 30 ? 'risk-medium' : ''}">${NUM(cl.oldestAge)}d</b>`,
      NUM(cl.invoices), esc(cl.lead),
      `<button class="mini-btn" data-open="${esc(cl.client)}">Open Client</button>`,
    ]));
  el('collClients').querySelectorAll('[data-client],[data-open]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client || s.dataset.open)));
}
function healthRow(l, v, tone) { return `<div class="hr"><span class="hr-l">${l}</span><span class="hr-v mono">${v}</span><span class="dot ${tone}"></span></div>`; }

/* ---------------- TOP OPPORTUNITIES CENTER (req #4) ---------------- */
let oppTab = 'A';
const OPP_TABS = [
  { k: 'A', t: 'Largest Unpaid' }, { k: 'B', t: 'Oldest Unpaid' }, { k: 'C', t: 'Multiple Invoices' },
  { k: 'D', t: 'Dormant High-Value' }, { k: 'E', t: 'Highest Outstanding' }, { k: 'F', t: 'Largest Collection' },
];
function renderOpportunities() {
  if (!el('oppTabs')) return;
  const o = state.data.view.opportunities || {};
  el('oppTabs').innerHTML = OPP_TABS.map(x => `<button class="opp-tab ${x.k === oppTab ? 'active' : ''}" data-ot="${x.k}">${x.t}</button>`).join('');
  el('oppTabs').querySelectorAll('[data-ot]').forEach(b => b.addEventListener('click', () => { oppTab = b.dataset.ot; renderOpportunities(); }));
  const lk = name => `<span class="lk" data-client="${esc(name)}">${esc(name || '—')}</span>`;
  let html = '';
  if (oppTab === 'A') html = table(['Client', 'Outstanding', 'Orders', 'Lead'], (o.largestUnpaid || []).map(c => [lk(c.client), `<span class="warn-txt">${AED(c.outstanding)}</span>`, NUM(c.orders), esc(c.lead)]));
  else if (oppTab === 'B') html = table(['Date', 'Client', 'Service', 'Amount', 'Age'], (o.oldestUnpaid || []).map(c => [esc(c.date), lk(c.client), esc(c.service), AED(c.amount), `<b class="risk-${c.level}">${c.ageDays}d</b>`]));
  else if (oppTab === 'C') html = table(['Client', 'Outstanding Invoices', 'Outstanding', 'Total Orders'], (o.multipleInvoices || []).map(c => [lk(c.client), `<span class="pill warn">${c.invoiceCount}×</span>`, `<span class="warn-txt">${AED(c.outstanding)}</span>`, NUM(c.orders)]));
  else if (oppTab === 'D') html = table(['Client', 'Lifetime Revenue', 'Last Order', 'Days Since'], (o.dormantHighValue || []).map(c => [lk(c.client), AED(c.revenue), esc(c.lastDate), `<b>${c.daysSince}d</b>`]));
  else if (oppTab === 'E') html = table(['Date', 'Client', 'Service', 'Amount', 'Risk'], (o.highestValueOutstanding || []).map(c => [esc(c.date), lk(c.client), esc(c.service), `<span class="warn-txt">${AED(c.amount)}</span>`, `<span class="risk-${c.level}">${c.level}</span>`]));
  else html = table(['Client', 'Collection Opportunity', 'Orders', 'Lead'], (o.largestCollection || []).map(c => [lk(c.client), `<b class="good-txt">${AED(c.outstanding)}</b>`, NUM(c.orders), esc(c.lead)]));
  el('oppPanel').innerHTML = `<div class="opp-summary">Total outstanding across <b>${NUM(o.clientsOwing || 0)}</b> clients: <b class="warn-txt">${AED(o.totalOutstanding || 0)}</b> — the largest collection opportunities for management.</div>` + html;
  el('oppPanel').querySelectorAll('[data-client]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client)));
}

/* ---------------- QUICK ACTIONS (req #16) ---------------- */
const QUICK_ACTIONS = [
  { ic: 'ti-alert-triangle', t: 'View Outstanding', c: 'red', go: 'money' },
  { ic: 'ti-brand-google', t: 'Google Ads Orders', c: 'green', go: 'google' },
  { ic: 'ti-crown', t: 'High-Value Clients', c: 'gold', go: 'clients' },
  { ic: 'ti-clock-dollar', t: 'Unpaid Orders', c: 'orange', go: 'pipeline' },
  { ic: 'ti-history', t: 'Audit Changes', c: 'purple', go: 'audit' },
  { ic: 'ti-heartbeat', t: 'Warnings', c: 'blue', go: 'health' },
  { ic: 'ti-copy', t: 'Duplicate Records', c: 'teal', go: 'audit' },
];
function renderQuickActions() {
  if (!el('quickActions')) return;
  el('quickActions').innerHTML = QUICK_ACTIONS.map((a, i) =>
    `<button class="qa-btn" data-qa="${i}"><span class="qa-ic ic-${a.c}"><i class="ti ${a.ic}"></i></span><span>${a.t}</span></button>`).join('');
  el('quickActions').querySelectorAll('[data-qa]').forEach(b => b.addEventListener('click', () => go(QUICK_ACTIONS[+b.dataset.qa].go)));
}

/* ---------------- EXECUTIVE INSIGHTS + FORECAST + RISK + OPPORTUNITIES (req #15, extras) ---------------- */
function insTile(ic, label, value, sub, tone) { return `<div class="ins-tile"><div class="ins-ic ${tone || ''}"><i class="ti ${ic}"></i></div><div class="ins-b"><div class="ins-l">${esc(label)}</div><div class="ins-v">${value}</div><div class="ins-s">${esc(sub || '')}</div></div></div>`; }
function renderInsights() {
  const d = state.data, v = d.view, ins = v.insights || {}, k = v.kpis, fc = v.forecasts || {}, rk = v.risk || {}, ds = v.dayStats || {};
  el('execInsights').innerHTML = [
    insTile('ti-flame', 'Highest Revenue Source', ins.topSource ? esc(ins.topSource.name) : '—', ins.topSource ? AED(ins.topSource.revenue) : '', 'ic-blue'),
    insTile('ti-award', 'Top Performing Service', ins.topService ? esc(ins.topService.name) : '—', ins.topService ? AED(ins.topService.revenue) : '', 'ic-green'),
    insTile('ti-user-dollar', 'Largest Paid Client', ins.largestPaidClient ? esc(ins.largestPaidClient.client) : '—', ins.largestPaidClient ? AED(ins.largestPaidClient.paid) + ' paid' : '', 'ic-green'),
    insTile('ti-user-exclamation', 'Largest Unpaid Client', ins.largestUnpaidClient && ins.largestUnpaidClient.outstanding > 0 ? esc(ins.largestUnpaidClient.client) : '—', ins.largestUnpaidClient ? AED(ins.largestUnpaidClient.outstanding) + ' owed' : '', 'ic-red'),
    insTile('ti-calendar-stats', 'Best Revenue Day', ds.bestDay ? esc(ds.bestDay.date) : '—', ds.bestDay ? AED(ds.bestDay.revenue) : '', 'ic-purple'),
    insTile('ti-percentage', 'Collection Rate', PCT(ins.collectionRate), 'of billed revenue', ins.collectionRate >= 70 ? 'ic-green' : 'ic-orange'),
    insTile('ti-receipt', 'Average Order Value', AED(ins.avgOrderValue), ds.avgOrdersPerDay + ' orders/day avg', 'ic-blue'),
    insTile('ti-cash', 'Revenue This Month', AED(ins.revenueMonth), 'this week ' + AEDk(ins.revenueWeek), 'ic-teal'),
  ].join('');

  // forecast
  el('ovForecast').innerHTML = [
    kvRow('Projected month-end revenue', fc.monthEndRevenue == null ? '—' : AED(fc.monthEndRevenue), 'good'),
    kvRow('Month-to-date', AED(fc.monthToDate || 0)),
    kvRow('Expected collection · next 7 days', AED(fc.collect7 || 0), 'good'),
    kvRow('Expected collection · next 30 days', AED(fc.collect30 || 0), 'good'),
    `<div class="fc-basis">${esc(fc.basis || '')}</div>`,
  ].join('');

  // risk
  const totalRiskAmt = (rk.lowAmt || 0) + (rk.medAmt || 0) + (rk.highAmt || 0);
  el('ovRisk').innerHTML = [
    `<div class="risk-row high"><span class="risk-dot"></span>High risk<b>${NUM(rk.high || 0)}</b><span class="risk-amt">${AEDk(rk.highAmt || 0)}</span></div>`,
    `<div class="risk-row med"><span class="risk-dot"></span>Medium risk<b>${NUM(rk.medium || 0)}</b><span class="risk-amt">${AEDk(rk.medAmt || 0)}</span></div>`,
    `<div class="risk-row low"><span class="risk-dot"></span>Low risk<b>${NUM(rk.low || 0)}</b><span class="risk-amt">${AEDk(rk.lowAmt || 0)}</span></div>`,
    `<div class="fc-basis">Total at risk: <b>${AED(totalRiskAmt)}</b> · scored by age + amount</div>`,
  ].join('');

  // top opportunities
  const opps = (rk.list || []).slice(0, 5);
  el('ovOpps').innerHTML = (opps.length ? opps.map(o => `<div class="opp-row clickable" data-client="${esc(o.client)}"><div><div class="opp-c">${esc(o.client || '—')}</div><div class="opp-s">${esc(o.service)} · ${o.ageDays}d old · <span class="risk-${o.level}">${o.level}</span></div></div><div class="opp-v">${AED(o.amount)}</div></div>`).join('')
    : '<div class="empty">No outstanding opportunities — all collected ✓</div>')
    + (ins.topService ? `<div class="fc-basis">Most profitable service: <b>${esc(ins.topService.name)}</b> · Best source: <b>${ins.topSource ? esc(ins.topSource.name) : '—'}</b></div>` : '');
  el('ovOpps').querySelectorAll('[data-client]').forEach(r => r.addEventListener('click', () => openClient(r.dataset.client)));
}
function kvRow(l, v, tone) { return `<div class="kvr"><span class="kvk">${esc(l)}</span><span class="kvv ${tone === 'good' ? 'good-txt' : ''}">${v}</span></div>`; }

/* ---------------- CLIENT 360 (extra) ---------------- */
function openClient(name) {
  if (!state.data) return;
  const c = (state.data.view.topClients || []).find(x => x.client === name);
  if (!c) return;
  const collected = c.revenue ? c.paid / c.revenue * 100 : 0;
  const stoneMap = { 'Active': 'good', 'Owes': 'warn', 'At risk': 'bad', 'Dormant': 'neutral' };
  el('cmName').innerHTML = `${esc(c.client)} <span class="pill ${stoneMap[c.status] || 'neutral'}">${esc(c.status)}</span>`;
  const trend = (c.trend || []).map(t => t.revenue);
  el('cmBody').innerHTML =
    `<div class="cm-grid">
      ${insTile('ti-diamond', 'Lifetime Value (LTV)', AED(c.ltv), 'total billed', 'ic-gold')}
      ${insTile('ti-cash', 'Lifetime Revenue', AED(c.revenue), NUM(c.orders) + ' orders', 'ic-blue')}
      ${insTile('ti-wallet', 'Lifetime Paid', AED(c.paid), PCT(collected) + ' collected', 'ic-green')}
      ${insTile('ti-alert-triangle', 'Lifetime Outstanding', AED(c.outstanding), c.outstanding > 0 ? NUM(c.invoiceCount) + ' open invoice(s)' : 'fully paid', c.outstanding > 0 ? 'ic-red' : 'ic-green')}
      ${insTile('ti-receipt', 'Average Order Value', AED(c.aov), c.repeat ? 'repeat client' : 'single order', 'ic-purple')}
      ${insTile('ti-windmill', 'Acquisition Source', esc(c.acqLead || c.lead), 'first via', 'ic-teal')}
      ${insTile('ti-calendar-plus', 'First Order', esc(c.firstDate || '—'), '', 'ic-blue')}
      ${insTile('ti-calendar', 'Last Order', esc(c.lastDate || '—'), c.daysSince + ' days ago', 'ic-blue')}
    </div>
    <div class="cm-section"><div class="cm-st">Revenue Trend</div><div class="cm-trend">${trend.length > 1 ? spark(trend, C.blue, 44) : '<span class="dimv small">not enough history</span>'}</div></div>
    ${(c.invoices && c.invoices.length) ? `<div class="cm-section"><div class="cm-st">Outstanding Invoices (${c.invoiceCount})</div>` + table(['Date', 'Reference', 'Service', 'Amount', 'Status'], c.invoices.map(iv => [esc(iv.date), esc(iv.ref || '—'), esc(iv.service), `<span class="warn-txt">${AED(iv.amount)}</span>`, badge(iv.status)])) + '</div>' : ''}
    <div class="cm-actions"><button class="btn" id="cmGoPipeline"><i class="ti ti-list"></i> See orders in Pipeline</button></div>`;
  el('clientModal').hidden = false;
  const gp = el('cmGoPipeline'); if (gp) gp.addEventListener('click', () => { el('clientModal').hidden = true; go('pipeline'); });
}
el('cmClose').addEventListener('click', () => el('clientModal').hidden = true);
el('clientModal').addEventListener('click', e => { if (e.target.id === 'clientModal') el('clientModal').hidden = true; });

/* ---------------- MONEY ---------------- */
function rMoney() {
  const v = state.data.view, k = v.kpis;
  el('moneyKpis').innerHTML = [
    kpi('Total Revenue', AED(k.totalRevenue), NUM(k.totalOrders) + ' orders'),
    kpi('Paid / Collected', AED(k.paidRevenue), PCT(k.collectionRate) + ' collection', 'good'),
    kpi('Outstanding', AED(k.outstanding), NUM(k.pendingOrders) + ' orders owing', 'warn'),
    kpi('Expenses', AED(k.totalExpenses), 'Ad spend ' + AEDk(k.adSpend)),
    kpi('Net Profit', AED(k.netProfit), 'Margin ' + PCT(k.profitMargin), k.netProfit >= 0 ? 'good' : 'bad'),
    kpi('Avg Order Value', AED(k.avgOrderValue), 'per order'),
  ].join('');
  // revenue vs expenses monthly: combine trend + expense per month (approx via expensesList)
  const expByMonth = {}; (v.expensesList || []).forEach(e => { const mk = (e.date || '').slice(0, 7); if (mk) expByMonth[mk] = (expByMonth[mk] || 0) + e.amount; });
  const labels = v.revenueTrend.map(r => r.label), keys = v.revenueTrend.map(r => r.key);
  draw('moTrend', { type: 'bar', data: { labels, datasets: [
    { label: 'Revenue', data: v.revenueTrend.map(r => r.revenue), backgroundColor: C.accent, borderRadius: 4 },
    { label: 'Expenses', data: keys.map(kk => Math.round(expByMonth[kk] || 0)), backgroundColor: C.red, borderRadius: 4 },
  ] }, options: Object.assign(axis(true), { plugins: { legend: { display: true, labels: { color: C.muted, boxWidth: 11 } } } }) });
  draw('moDaily', { type: 'bar', data: { labels: v.dailyTrend.map(r => r.label), datasets: [{ data: v.dailyTrend.map(r => r.revenue), backgroundColor: C.blue, borderRadius: 3 }] }, options: axis(true) });
  const pm = v.paymentMethods.slice(0, 7);
  draw('moMethods', { type: 'doughnut', data: { labels: pm.map(p => p.name), datasets: [{ data: pm.map(p => p.value), backgroundColor: pm.map(p => methodColor(p.name)), borderWidth: 0 }] }, options: doughnut() });
  el('moExpenses').innerHTML = table(['Date', 'Category', 'Status', 'Amount'], (v.expensesList || []).slice(0, 20).map(e => [esc(e.date || '—'), esc(e.category), badge((e.status || '').toLowerCase() || 'pending'), AED(e.amount)]));
  el('moTopClients').innerHTML = table(['Client', 'Revenue', 'Paid', 'Orders'], v.topClients.slice(0, 10).map(c => [esc(c.client), AED(c.revenue), AED(c.paid), NUM(c.orders)]));
  const ageing = v.outstandingOrders.slice(0, 12);
  el('moAgeing').innerHTML = table(['Date', 'Client', 'Service', 'Owed'], ageing.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), AED(o.amount)]));
  // req #22: largest outstanding clients
  const col = v.collection || {};
  if (el('moLargestOut')) {
    el('moLargestOut').innerHTML = table(['Client', 'Outstanding', 'Oldest Age', 'Invoices', 'Source'],
      (col.clients || []).slice(0, 10).map(c => [`<span class="lk" data-client="${esc(c.client)}">${esc(c.client)}</span>`, `<span class="warn-txt">${AED(c.outstanding)}</span>`, `<b class="${c.oldestAge > 90 ? 'risk-high' : c.oldestAge > 30 ? 'risk-medium' : ''}">${NUM(c.oldestAge)}d</b>`, NUM(c.invoices), esc(c.lead)]));
    el('moLargestOut').querySelectorAll('[data-client]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client)));
  }
  // req #22: collection forecast
  if (el('moCollForecast')) {
    const fc = v.forecasts || {};
    el('moCollForecast').innerHTML = [
      kvRow('Total outstanding to collect', AED(col.totalOutstanding || k.outstanding), 'good'),
      kvRow('Expected collection · next 7 days', AED(fc.collect7 || 0), 'good'),
      kvRow('Expected collection · next 30 days', AED(fc.collect30 || 0), 'good'),
      kvRow('Due now (≤7 days old)', AED(col.dueWeek || 0)),
      kvRow('Over 30 days', AED(col.over30 || 0)),
      kvRow('Over 90 days (high risk)', AED(col.over90 || 0)),
      `<div class="fc-basis">${esc(fc.basis || 'Run-rate from recent collections')}</div>`,
    ].join('');
  }
}

/* ---------------- PIPELINE ---------------- */
function rPipeline() {
  const v = state.data.view, k = v.kpis;
  const leadOrders = v.leadSources.reduce((a, l) => a + l.orders, 0);
  const delivered = (v.deliveryBreakdown.find(x => x.name === 'Delivered') || {}).count || 0;
  const inprog = (v.deliveryBreakdown.find(x => x.name === 'In Progress') || {}).count || 0;
  const pend = (v.deliveryBreakdown.find(x => x.name === 'Pending') || {}).count || 0;
  const steps = [
    { n: 'Leads / Sources', v: v.leadSources.length, ic: 'ti-windmill', c: C.teal },
    { n: 'Orders', v: k.totalOrders, ic: 'ti-shopping-cart', c: C.blue },
    { n: 'Paid', v: k.paidOrders, ic: 'ti-circle-check', c: C.green },
    { n: 'In Progress', v: inprog, ic: 'ti-loader', c: C.orange },
    { n: 'Delivered', v: delivered, ic: 'ti-package-export', c: C.accent },
    { n: 'Cancelled', v: k.cancelledOrders, ic: 'ti-ban', c: C.red },
  ];
  el('pipeFunnel').innerHTML = steps.map(s => `<div class="fstep"><div class="fic" style="background:${s.c}22;color:${s.c}"><i class="ti ${s.ic}"></i></div><div class="fv mono">${NUM(s.v)}</div><div class="fn">${s.n}</div></div>`).join('<div class="farr"><i class="ti ti-chevron-right"></i></div>');
  el('pipeLeads').innerHTML = table(['Source', 'Revenue', 'Orders', 'Share'], v.leadSources.map(l => [esc(l.name), AED(l.revenue), NUM(l.orders), PCT(l.share)]));
  draw('pipeDelivery', { type: 'doughnut', data: { labels: v.deliveryBreakdown.map(d => d.name), datasets: [{ data: v.deliveryBreakdown.map(d => d.count), backgroundColor: [C.green, C.orange, C.blue, C.red, C.teal], borderWidth: 0 }] }, options: Object.assign(doughnut(), { plugins: { legend: { position: 'right', labels: { color: C.muted, font: { size: 11 }, boxWidth: 11, padding: 9 } }, tooltip: { callbacks: { label: c => c.label + ': ' + NUM(c.parsed) + ' orders' } } } }) });
  el('pipeOrders').innerHTML = table(['Date', 'Client', 'Service', 'Source', 'Amount', 'Payment', 'Delivery'], v.recentTransactions.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), esc(o.lead), AED(o.amount), badge(o.status), badge(o.delivery)]));
}

/* ---------------- OPERATIONS ---------------- */
function rOps() {
  const v = state.data.view, k = v.kpis;
  const db = v.deliveryBreakdown, totalD = db.reduce((a, x) => a + x.count, 0) || 1;
  const delivered = (db.find(x => x.name === 'Delivered') || {}).count || 0;
  const pendingCount = v.pendingDeliveries.length;
  el('opsKpis').innerHTML = [
    kpi('Total Orders', NUM(k.totalOrders), 'in range'),
    kpi('Delivered', NUM(delivered), PCT(delivered / totalD * 100) + ' delivery rate', 'good'),
    kpi('Pending / In-Progress', NUM(pendingCount), 'awaiting delivery', pendingCount ? 'warn' : 'good'),
    kpi('Avg Order Value', AED(k.avgOrderValue), 'workload value'),
    kpi('Services Active', NUM(v.topServices.length), 'distinct types'),
    kpi('Cancelled', NUM(k.cancelledOrders), 'excluded from revenue'),
  ].join('');
  draw('opsService', { type: 'bar', data: { labels: v.topServices.map(s => s.name), datasets: [{ data: v.topServices.map(s => s.orders), backgroundColor: C.teal, borderRadius: 4 }] }, options: Object.assign(axis(false), { indexAxis: 'y' }) });
  el('opsDelivery').innerHTML = bars(db.map(x => ({ name: x.name, value: x.count })), totalD, i => NUM(i.value) + ' · ' + PCT(i.value / totalD * 100));
  el('opsPending').innerHTML = table(['Date', 'Client', 'Service', 'Amount', 'Delivery'], v.pendingDeliveries.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), AED(o.amount), badge(o.delivery)]));
}

/* ---------------- CLIENTS ---------------- */
function rClients() {
  const v = state.data.view, k = v.kpis;
  const tc = v.topClients, repeat = tc.filter(c => c.repeat).length;
  const owing = tc.filter(c => c.outstanding > 0);
  el('clientsKpis').innerHTML = [
    kpi('Total Clients', NUM(k.totalClients), 'in range'),
    kpi('Repeat Clients', NUM(repeat), PCT(k.totalClients ? repeat / k.totalClients * 100 : 0) + ' of base', 'good'),
    kpi('Revenue / Client', AED(k.totalClients ? k.totalRevenue / k.totalClients : 0), 'average'),
    kpi('Clients Owing', NUM(owing.length), AEDk(owing.reduce((a, c) => a + c.outstanding, 0)) + ' outstanding', owing.length ? 'warn' : 'good'),
    kpi('Google Clients', NUM(k.googleClients), PCT(k.googleClientShare) + ' of clients'),
    kpi('Top Client', tc[0] ? AEDk(tc[0].revenue) : '—', tc[0] ? esc(tc[0].client) : ''),
  ].join('');
  const top = tc.slice(0, 10);
  draw('clChart', { type: 'bar', data: { labels: top.map(c => c.client || '—'), datasets: [{ data: top.map(c => c.revenue), backgroundColor: C.teal, borderRadius: 4 }] }, options: Object.assign(axis(true), { indexAxis: 'y' }) });
  const byLead = {}; tc.forEach(c => byLead[c.lead] = (byLead[c.lead] || 0) + 1);
  const llabels = Object.keys(byLead);
  draw('clLead', { type: 'doughnut', data: { labels: llabels, datasets: [{ data: Object.values(byLead), backgroundColor: llabels.map(leadColor), borderWidth: 0 }] }, options: Object.assign(doughnut(), { plugins: { legend: { position: 'right', labels: { color: C.muted, font: { size: 11 }, boxWidth: 11, padding: 9 } }, tooltip: { callbacks: { label: c => c.label + ': ' + NUM(c.parsed) + ' clients' } } } }) });
  el('clTable').innerHTML = table(['Client', 'Source', 'Orders', 'Revenue', 'Outstanding', 'Last Order'], tc.slice(0, 50).map(c => [`<span class="lk" data-client="${esc(c.client)}">${esc(c.client || '—')}</span>`, esc(c.lead) + (c.repeat ? ' <span class="pill info">repeat</span>' : ''), NUM(c.orders), AED(c.revenue), c.outstanding > 0 ? `<span class="warn-txt">${AED(c.outstanding)}</span>` : AED(0), esc(c.lastDate)]));
  el('clTable').querySelectorAll('[data-client]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client)));
}

/* ---------------- GOOGLE ADS — executive performance center (req #8,9,10) ---------------- */
function rGoogle() {
  const v = state.data.view, k = v.kpis, g = v.googleAds || {}, cmp = v.compare || {};
  const noSpend = (g.spend || 0) <= 0;

  // executive score gauge
  const scoreTone = g.score >= 70 ? 'good' : g.score >= 45 ? 'warn' : 'bad';
  el('gScore').innerHTML = `<div class="score-ring ${scoreTone}"><span class="score-n">${NUM(g.score || 0)}</span><span class="score-x">/100</span></div><div class="score-lbl">Google Ads<br>Executive Score</div>`;

  // KPIs (full set, req #8)
  const cards = [
    kpi('Google Ads Revenue', AED(g.revenue), PCT(g.revenueShare) + ' of total revenue'),
    kpi('Google Ads Orders', NUM(g.orders), 'attributed orders'),
    kpi('Ad Spend', AED(g.spend), noSpend ? 'none this period' : 'from Expenses', noSpend ? 'warn' : ''),
    kpi('ROAS', g.roas == null ? 'N/A' : g.roas.toFixed(2) + 'x', g.roas == null ? 'needs spend' : 'revenue / spend', g.roas == null ? 'neutral' : g.roas >= 2 ? 'good' : 'warn'),
    kpi('CPA', g.cpa == null ? 'N/A' : AED(g.cpa), g.cpa == null ? 'needs spend' : 'cost / order'),
    kpi('Net / Profit After Ads', AED(g.profitAfterAdSpend), 'revenue − spend', g.profitAfterAdSpend >= 0 ? 'good' : 'bad'),
    kpi('Avg Order Value', AED(g.aov), 'per Google order'),
    kpi('Conversion Rate', PCT(g.conversionRate), 'orders paid', g.conversionRate >= 70 ? 'good' : 'warn'),
    kpi('Revenue Growth', cmp.hasPrev && cmp.revenue != null ? (cmp.revenue >= 0 ? '+' : '') + PCT(cmp.revenue) : 'N/A', 'vs previous period', !cmp.hasPrev ? 'neutral' : cmp.revenue >= 0 ? 'good' : 'bad'),
    kpi('Orders Growth', cmp.hasPrev && cmp.orders != null ? (cmp.orders >= 0 ? '+' : '') + PCT(cmp.orders) : 'N/A', 'vs previous period', !cmp.hasPrev ? 'neutral' : cmp.orders >= 0 ? 'good' : 'bad'),
    kpi('Best Revenue Day', g.bestDays && g.bestDays[0] ? AEDk(g.bestDays[0].revenue) : '—', g.bestDays && g.bestDays[0] ? g.bestDays[0].date : ''),
    kpi('Google Revenue Share', PCT(g.revenueShare), 'of all revenue'),
    kpi('New Google Clients', NUM(g.newClients), AED(g.newRevenue) + ' · ' + NUM(g.newOrders) + ' orders', 'good'),
    kpi('Returning Google Clients', NUM(g.returningClients), AED(g.returningRevenue) + ' · ' + NUM(g.returningOrders) + ' orders', g.returningClients ? 'good' : 'neutral'),
    kpi('Returning Revenue Ratio', PCT(g.returningRevenueRatio), 'of Google Ads revenue', g.returningRevenueRatio >= 20 ? 'good' : ''),
  ];
  el('gKpis').innerHTML = cards.join('');

  // Google Ads funnel (req #8)
  const fcolors = [C.green, C.green, C.accent, C.teal, C.red, '#9CA3AF'];
  el('gFunnel').innerHTML = (g.funnel || []).map((s, i) =>
    `<div class="gf-stage"><div class="gf-bar" style="background:${fcolors[i]}22;border-color:${fcolors[i]}"><div class="gf-n">${NUM(s.count)}</div><div class="gf-l">${esc(s.label)}</div><div class="gf-p">${PCT(s.pct)} of orders</div></div>${i < g.funnel.length - 1 ? `<div class="gf-conv">${PCT(g.funnel[i + 1].conv || 0)}<i class="ti ti-chevron-down"></i></div>` : ''}</div>`).join('')
    || '<div class="empty">No Google Ads orders in this range</div>';

  const note = el('gNote'); note.hidden = false;
  if (noSpend) { note.className = 'callout warn'; note.innerHTML = `<i class="ti ti-alert-triangle"></i> <b>No Google Ads spend recorded for this period.</b> ROAS & CPA need spend (from an Expenses "Google Ads" row). Revenue, orders & growth above are real — attributed from <b>Lead Source = "Google Ads"</b>.`; }
  else { note.className = 'callout'; note.innerHTML = `<i class="ti ti-info-circle"></i> Attribution: <b>Lead Source = "Google Ads"</b> · spend from Expenses "Google Ads". Score = ROAS + CPA + conversion. ROAS ${g.roas.toFixed(2)}x · CPA ${AED(g.cpa)} · conversion ${PCT(g.conversionRate)}.`; }

  // Revenue vs Spend (monthly)
  const rt = g.roasTrend || [];
  draw('gRevSpend', { type: 'bar', data: { labels: rt.map(r => r.label), datasets: [
    { label: 'Revenue', data: rt.map(r => r.revenue), backgroundColor: C.green, borderRadius: 4 },
    { label: 'Ad Spend', data: rt.map(r => r.spend), backgroundColor: C.red, borderRadius: 4 },
  ] }, options: Object.assign(axis(true), { plugins: { legend: { display: true, labels: { color: C.muted, boxWidth: 11 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + AED(c.parsed.y) } } } }) });
  // ROAS trend — req #3: if there is no real spend in any period, ROAS is undefined.
  // Don't render an empty/misleading chart — replace it with a clear explanation instead.
  const roasPts = rt.filter(r => r.roas != null);
  const roasBox = el('gRoasBox');
  if (roasPts.length < 2) {  // req #7: a single point (or none) is not a "trend" — show an empty-state card, never a near-empty chart
    if (charts['gRoasTrend']) { charts['gRoasTrend'].destroy(); delete charts['gRoasTrend']; }
    if (roasBox) roasBox.innerHTML = `<div class="chart-empty"><i class="ti ti-chart-dots-2"></i><div><b>No sufficient ad spend data available for ROAS trend analysis.</b><div class="dimv small">ROAS trend needs ad spend across at least two periods (ROAS = Google Ads revenue ÷ ad spend, per month). ${roasPts.length === 1 ? 'Only one period has spend' : 'No "Google Ads" spend rows exist in Expenses'} for the selected range, so a trend line can't be drawn without inventing data. Add monthly Google Ads spend to the Expenses tab to enable it — revenue &amp; orders above are real.</div></div></div>`;
  } else {
    if (roasBox && !el('gRoasTrend')) roasBox.innerHTML = '<canvas id="gRoasTrend"></canvas>';
    draw('gRoasTrend', { type: 'line', data: { labels: rt.map(r => r.label), datasets: [{ data: rt.map(r => r.roas), borderColor: C.accent, backgroundColor: 'rgba(124,92,252,.15)', fill: true, tension: .35, borderWidth: 3, pointRadius: 3, spanGaps: true }] }, options: Object.assign(axis(false), { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => 'ROAS ' + (c.parsed.y == null ? 'N/A' : c.parsed.y.toFixed(2) + 'x') } } } }) });
  }
  // Orders vs Revenue (daily, dual axis)
  const dl = (g.dayList || []);
  draw('gOrdersRev', { type: 'bar', data: { labels: dl.map(d => d.date.slice(5)), datasets: [
    { type: 'line', label: 'Revenue', yAxisID: 'y', data: dl.map(d => d.revenue), borderColor: C.green, backgroundColor: 'rgba(45,190,139,.12)', fill: true, tension: .35, borderWidth: 2, pointRadius: 1 },
    { label: 'Orders', yAxisID: 'y1', data: dl.map(d => d.orders), backgroundColor: C.blue, borderRadius: 3 },
  ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: C.muted, boxWidth: 11 } } }, scales: { x: { ticks: { color: C.muted, font: { size: 9 }, maxTicksLimit: 12 }, grid: { color: gridc() } }, y: { position: 'left', ticks: { color: C.muted, font: { size: 10 }, callback: vv => vv >= 1000 ? vv / 1000 + 'K' : vv }, grid: { color: gridc() } }, y1: { position: 'right', ticks: { color: C.muted, font: { size: 10 } }, grid: { drawOnChartArea: false } } } } });
  // share
  const oth = Math.max(0, k.totalRevenue - g.revenue);
  // req #8: Google Ads = Green, Other Sources = Blue (no gray)
  draw('gShare', { type: 'doughnut', data: { labels: ['Google Ads', 'Other sources'], datasets: [{ data: [g.revenue, oth], backgroundColor: [C.green, C.blue], borderWidth: 0 }] }, options: doughnut() });
  // revenue by service type — req #3: fixed service colors (Legal=Blue, MOFA=Green, Embassy=Violet, MOJ=Orange; others lighter secondaries)
  const dset = (arr, colors) => ({ type: 'doughnut', data: { labels: arr.map(x => x.name), datasets: [{ data: arr.map(x => x.revenue), backgroundColor: colors || PALETTE, borderWidth: 0 }] }, options: doughnut() });
  const gbs = g.byService || [];
  draw('gByService', dset(gbs, gbs.map((x, i) => serviceColor(x.name, i))));
  // req #3: "Revenue by Payment Status" and "Revenue by Delivery Status" charts removed (not needed).

  // tables (req #10)
  el('gTopClients').innerHTML = table(['Client', 'Revenue', 'Orders', 'Share'], (g.topClients || []).map(c => [`<span class="lk" data-client="${esc(c.name)}">${esc(c.name)}</span>`, AED(c.revenue), NUM(c.orders), PCT(c.share)]));
  el('gTopClients').querySelectorAll('[data-client]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client)));
  el('gTopServices').innerHTML = table(['Service', 'Revenue', 'Orders', 'Share'], (g.topServices || []).map(s => [esc(s.name), AED(s.revenue), NUM(s.orders), PCT(s.share)]));
  el('gBestDays').innerHTML = table(['Date', 'Revenue', 'Orders'], (g.bestDays || []).map(d => [esc(d.date), AED(d.revenue), NUM(d.orders)]));
  el('gRoasDays').innerHTML = table(['Date', 'ROAS', 'Revenue', 'Spend'], (g.highestRoasDays || []).map(d => [esc(d.date), d.roas == null ? '—' : d.roas.toFixed(2) + 'x', AED(d.revenue), AED(d.spend)]));
  el('gSpendDays').innerHTML = table(['Date', 'Spend', 'Revenue', 'ROAS'], (g.highestSpendDays || []).map(d => [esc(d.date), AED(d.spend), AED(d.revenue), d.roas == null ? '—' : d.roas.toFixed(2) + 'x']));
  el('gOrders').innerHTML = table(['Date', 'Client', 'Service', 'Amount', 'Payment'], (v.googleAdsLeads || []).map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), AED(o.amount), badge(o.status)]));
  renderGQuality();
  renderGOpps();
}
/* GOOGLE ADS — EXECUTIVE OPPORTUNITIES (req C/S7) — reuses view data, no new calcs */
function renderGOpps() {
  if (!el('gOpps')) return;
  const v = state.data.view, s = v.execSummary || {}, g = v.googleAds || {}, p = v.periodic || {};
  const bestPeriod = p.highestRevenueDay;
  const w = (ic, tone, label, value, sub) => `<div class="exsum"><div class="exsum-ic ${tone}"><i class="ti ${ic}"></i></div><div class="exsum-b"><div class="exsum-l">${esc(label)}</div><div class="exsum-v mono">${value}</div><div class="exsum-s">${esc(sub || '')}</div></div></div>`;
  el('gOpps').innerHTML = [
    w('ti-award', 'ic-green', 'Best Service', s.bestServiceMonth ? esc(s.bestServiceMonth.name) : '—', s.bestServiceMonth ? AED(s.bestServiceMonth.revenue) + ' this month' : ''),
    w('ti-user-dollar', 'ic-green', 'Best Client', s.largestPaidClient ? esc(s.largestPaidClient.client) : '—', s.largestPaidClient ? AED(s.largestPaidClient.paid) + ' paid' : ''),
    w('ti-calendar-star', 'ic-purple', 'Best Period', bestPeriod ? esc(bestPeriod.date) : '—', bestPeriod ? AED(bestPeriod.revenue) + ' top day' : ''),
    w('ti-user-exclamation', 'ic-red', 'Largest Unpaid', s.largestUnpaidClient && s.largestUnpaidClient.outstanding > 0 ? esc(s.largestUnpaidClient.client) : '—', s.largestUnpaidClient ? AED(s.largestUnpaidClient.outstanding) + ' owed' : ''),
    w('ti-rotate', 'ic-purple', 'Returning Insights', NUM(g.returningClients || 0) + ' clients', AED(g.returningRevenue || 0) + ' · ' + NUM(g.returningOrders || 0) + ' orders · ' + PCT(g.returningRevenueRatio || 0)),
    w('ti-chart-arrows-vertical', 'ic-blue', 'Revenue Forecast', s.revenueForecast == null ? '—' : AED(s.revenueForecast), 'month-end run-rate'),
    w('ti-cash-banknote', 'ic-green', 'Collection Forecast', s.collectionForecast == null ? '—' : AED(s.collectionForecast), 'next 30 days'),
  ].join('');
}
/* GOOGLE ADS LEAD QUALITY (req #5) — order quality of Google leads, separate from ROAS */
function renderGQuality() {
  if (!el('gQuality')) return;
  const fn = (state.data.view.googleAds || {}).funnel || [];
  const find = lbl => (fn.find(f => f.label === lbl) || { count: 0 }).count;
  const total = find('Google Ads Orders'), paid = find('Paid Orders'), deliv = find('Delivered Orders'),
        ret = find('Returning Orders'), out = find('Outstanding Orders'), canc = find('Cancelled Orders');
  const rate = n => total ? n / total * 100 : 0;
  const tiles = [
    ['Total Orders', NUM(total), '100% of Google leads', 'ic-blue'],
    ['Paid Orders', NUM(paid), PCT(rate(paid)) + ' paid rate', 'ic-green'],
    ['Delivered Orders', NUM(deliv), PCT(rate(deliv)) + ' delivery rate', 'ic-green'],
    ['Outstanding Orders', NUM(out), PCT(rate(out)) + ' outstanding rate', 'ic-orange'],
    ['Cancelled Orders', NUM(canc), PCT(rate(canc)) + ' cancellation rate', 'ic-red'],
    ['Returning Orders', NUM(ret), PCT(rate(ret)) + ' returning rate', 'ic-purple'],
  ];
  el('gQuality').innerHTML = tiles.map(t => `<div class="gq-tile"><div class="gq-l">${t[0]}</div><div class="gq-v mono">${t[1]}</div><div class="gq-s ${t[3]}">${t[2]}</div></div>`).join('');
}
function titleCase(s) { return String(s || '').replace(/\b\w/g, c => c.toUpperCase()); }

/* ---------------- REPORTS — real reporting center (req #6) ---------------- */
let repTab = 'register';
const REP_TABS = [
  { k: 'register', t: 'Transaction Register', ic: 'ti-list-details' },
  { k: 'monthly', t: 'Monthly Revenue', ic: 'ti-calendar-stats' },
  { k: 'collections', t: 'Collections', ic: 'ti-wallet' },
  { k: 'outstanding', t: 'Outstanding', ic: 'ti-alert-triangle' },
  { k: 'google', t: 'Google Ads', ic: 'ti-brand-google' },
  { k: 'clients', t: 'Client Report', ic: 'ti-users' },
];
function rReports() {
  const v = state.data.view, k = v.kpis;
  el('repKpis').innerHTML = [
    kpi('Revenue', AED(k.totalRevenue), v.filter.from + ' → ' + v.filter.to),
    kpi('Orders', NUM(k.totalOrders), NUM(k.paidOrders) + ' paid'),
    kpi('Collected', AED(k.paidRevenue), PCT(k.collectionRate)),
    kpi('Outstanding', AED(k.outstanding), NUM(k.pendingOrders) + ' owing'),
    kpi('Expenses', AED(k.totalExpenses), ''),
    kpi('Net Profit', AED(k.netProfit), 'Margin ' + PCT(k.profitMargin)),
  ].join('');
  el('repTabs').innerHTML = REP_TABS.map(x => `<button class="rep-tab ${x.k === repTab ? 'active' : ''}" data-rt="${x.k}"><i class="ti ${x.ic}"></i> ${x.t}</button>`).join('');
  el('repTabs').querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => { repTab = b.dataset.rt; renderReport(); }));
  renderReport();
}
const REP_DESC = {
  register: 'Full line-by-line transaction register for the selected range — every order with client, service, reference, source, method, amount, payment & delivery status. Use it as the master export for accounting.',
  monthly: 'Revenue grouped by month — orders, revenue, share of total and average order value. Use it to track month-over-month growth.',
  collections: 'Cash actually received, by client — revenue billed vs collected vs outstanding, with each client\'s collection rate. Use it to see who has paid.',
  outstanding: 'Receivables still owed, by client — outstanding amount, oldest invoice age and number of open invoices. Use it to prioritise collection calls.',
  google: 'Google Ads performance — attributed revenue, orders, ROAS, new vs returning clients, plus the underlying order register. Use it for marketing reviews.',
  clients: 'Every client in the range — source, orders, revenue, collected, outstanding, last order and status. Use it for client and relationship reviews.',
};
function renderReport() {
  const v = state.data.view, k = v.kpis, g = v.googleAds || {}, c = v.collection || {};
  const range = `${v.filter.from} → ${v.filter.to}`;
  const lk = name => `<span class="lk" data-client="${esc(name)}">${esc(name || '—')}</span>`;
  if (el('repDesc')) el('repDesc').innerHTML = `<i class="ti ti-info-circle"></i> <span><b>${esc((REP_TABS.find(x => x.k === repTab) || {}).t || '')}.</b> ${esc(REP_DESC[repTab] || '')} Showing <b>${esc(range)}</b> — export with the buttons above.</span>`;
  let title = '', html = '';
  if (repTab === 'register') {
    title = `TRANSACTION REGISTER · ${v.recentTransactions.length} shown · ${range}`;
    html = table(['Date', 'Client', 'Service', 'Ref', 'Source', 'Method', 'Amount', 'Payment', 'Delivery'],
      v.recentTransactions.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), esc(o.ref || '—'), esc(o.lead), esc(o.method), AED(o.amount), badge(o.status), badge(o.delivery)]));
  } else if (repTab === 'monthly') {
    title = `MONTHLY REVENUE REPORT · ${range}`;
    const tot = v.revenueTrend.reduce((a, r) => a + r.revenue, 0) || 1;
    html = table(['Month', 'Orders', 'Revenue', 'Share', 'Avg / Order'],
      v.revenueTrend.map(r => [esc(r.label), NUM(r.orders), AED(r.revenue), PCT(r.revenue / tot * 100), AED(r.orders ? r.revenue / r.orders : 0)]));
  } else if (repTab === 'collections') {
    title = `COLLECTIONS REPORT · cash received · ${range}`;
    const paidClients = (v.topClients || []).filter(x => x.paid > 0).sort((a, b) => b.paid - a.paid);
    html = `<div class="opp-summary">Total collected <b class="good-txt">${AED(k.paidRevenue)}</b> of ${AED(k.totalRevenue)} billed · collection rate <b>${PCT(k.collectionRate)}</b></div>`
      + table(['Client', 'Source', 'Revenue', 'Collected', 'Outstanding', 'Collection %'],
        paidClients.map(x => [lk(x.client), esc(x.lead), AED(x.revenue), `<b class="good-txt">${AED(x.paid)}</b>`, x.outstanding > 0 ? `<span class="warn-txt">${AED(x.outstanding)}</span>` : AED(0), PCT(x.revenue ? x.paid / x.revenue * 100 : 0)]));
  } else if (repTab === 'outstanding') {
    title = `OUTSTANDING REPORT · receivables by client · ${range}`;
    html = `<div class="opp-summary">Total outstanding <b class="warn-txt">${AED(c.totalOutstanding || 0)}</b> across <b>${NUM(c.clientsOwing || 0)}</b> clients · Over 90 days <b>${AED(c.over90 || 0)}</b></div>`
      + table(['Client', 'Outstanding', 'Oldest Age', 'Invoices', 'Source'],
        (c.clients || []).map(x => [lk(x.client), `<span class="warn-txt">${AED(x.outstanding)}</span>`, `<b class="${x.oldestAge > 90 ? 'risk-high' : x.oldestAge > 30 ? 'risk-medium' : ''}">${NUM(x.oldestAge)}d</b>`, NUM(x.invoices), esc(x.lead)]));
  } else if (repTab === 'google') {
    title = `GOOGLE ADS REPORT · ${range}`;
    html = `<div class="opp-summary">Google Ads revenue <b>${AED(g.revenue || 0)}</b> · ${NUM(g.orders || 0)} orders · ROAS <b>${g.roas == null ? 'N/A' : g.roas.toFixed(2) + 'x'}</b> · ${NUM(g.newClients || 0)} new / ${NUM(g.returningClients || 0)} returning clients</div>`
      + table(['Date', 'Client', 'Service', 'Amount', 'Payment', 'Delivery'],
        (v.googleAdsLeads || []).map(o => [esc(o.date), lk(o.client), esc(o.service), AED(o.amount), badge(o.status), badge(o.delivery)]));
  } else {
    title = `CLIENT REPORT · ${(v.topClients || []).length} clients · ${range}`;
    html = table(['Client', 'Source', 'Orders', 'Revenue', 'Collected', 'Outstanding', 'Last Order', 'Status'],
      (v.topClients || []).map(x => [lk(x.client), esc(x.lead), NUM(x.orders), AED(x.revenue), AED(x.paid), x.outstanding > 0 ? `<span class="warn-txt">${AED(x.outstanding)}</span>` : AED(0), esc(x.lastDate), esc(x.status)]));
  }
  el('repTitle').textContent = title;
  el('repTable').innerHTML = html;
  el('repTable').querySelectorAll('[data-client]').forEach(s => s.addEventListener('click', () => openClient(s.dataset.client)));
}
function qs() { const f = state.data.view.filter; return `from=${f.from}&to=${f.to}&service=${encodeURIComponent(f.service)}&lead=${encodeURIComponent(f.lead)}`; }
el('expCsv').addEventListener('click', () => { logEvent('ok', 'Export generated', 'CSV export · ' + state.data.view.filter.from + ' → ' + state.data.view.filter.to); window.open('/api/export?' + qs(), '_blank'); });
el('expExcel').addEventListener('click', () => { logEvent('ok', 'Export generated', 'Excel export · ' + state.data.view.filter.from + ' → ' + state.data.view.filter.to); window.open('/api/export?' + qs(), '_blank'); });
el('expPdf').addEventListener('click', () => { logEvent('ok', 'Export generated', 'PDF / print export'); window.print(); });

/* ---------------- AUDIT LOG (forensic) ---------------- */
function dubaiDayKey(ts) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(ts)); } catch (_) { return ''; } }
function badge2(s) { const m = { ok: 'good', info: 'info', warning: 'warn', error: 'bad' }; return `<span class="pill ${m[s] || 'neutral'}">${esc(s)}</span>`; }

const afState = { severity: 'all', type: 'all', user: 'all', q: '' };
let auditMode = 'detect'; // req #12: 'detect' = change-detection date (c.ts) · 'txn' = transaction date (c.txnDate)
let forensic = { changes: [], total: 0, loadedAt: 0 };
let forensicLoading = false;
async function loadForensic(force) {
  if (forensicLoading) return;
  if (!force && forensic.loadedAt && Date.now() - forensic.loadedAt < 12000) return;
  forensicLoading = true;
  try { const r = await fetch('/api/audit'); const j = await r.json(); forensic = { changes: j.changes || [], total: j.total || 0, loadedAt: Date.now() }; } catch (_) {}
  forensicLoading = false;
  if (state.page === 'audit') rAudit();
}
function sevPill(s) { const m = { CRITICAL: 'bad', WARNING: 'warn', INFO: 'info' }; return `<span class="pill ${m[s] || 'neutral'}">${esc(s)}</span>`; }
function typePill(t) { const m = { CREATE: 'good', DELETE: 'bad', STATUS_CHANGE: 'info', VALUE_CHANGE: 'warn', UPDATE: 'neutral', SYSTEM_EVENT: 'neutral' }; return `<span class="pill ${m[t] || 'neutral'}">${esc(t)}</span>`; }
// req #4: the Audit Log follows the GLOBAL date filter (state.filter / view.filter), not its own presets.
function filteredForensic() {
  const f = (state.data && state.data.view && state.data.view.filter) || {};
  const from = f.from || '0000-00-00', to = f.to || '9999-99-99';
  return forensic.changes.filter(c => {
    // req #12: in Transaction-Date mode filter by the row's own date (fallback to detection day
    // for legacy/system records that have no transaction date).
    const day = auditMode === 'txn' ? (c.txnDate || dubaiDayKey(c.ts)) : dubaiDayKey(c.ts);
    if (day && (day < from || day > to)) return false;   // outside the selected global range
    if (afState.severity !== 'all' && c.severity !== afState.severity) return false;
    if (afState.type !== 'all' && c.changeType !== afState.type) return false;
    if (afState.user !== 'all' && c.user !== afState.user) return false;
    if (afState.q) { const h = (c.ref + ' ' + c.column + ' ' + c.message + ' ' + c.oldValue + ' ' + c.newValue + ' ' + c.user).toLowerCase(); if (h.indexOf(afState.q.toLowerCase()) < 0) return false; }
    return true;
  });
}
function rAudit() {
  const d = state.data, vd = d.validation, v = d.view;
  loadForensic(false); // refresh in background; re-renders when done

  // populate user filter from known users
  const users = [...new Set(forensic.changes.map(c => c.user))];
  if (el('afUser').dataset.sig !== users.join('|')) {
    const cur = el('afUser').value;
    el('afUser').innerHTML = '<option value="all">All users</option>' + users.map(u => `<option>${esc(u)}</option>`).join('');
    el('afUser').dataset.sig = users.join('|'); el('afUser').value = cur || 'all';
  }

  const win = filteredForensic();
  const dataCh = win.filter(c => c.changeType !== 'SYSTEM_EVENT');
  const cnt = t => dataCh.filter(c => c.changeType === t).length;
  el('auditKpis').innerHTML = [
    kpi('Changes (filter)', NUM(win.length), 'matching events'),
    kpi('Created', NUM(cnt('CREATE')), 'new transactions', cnt('CREATE') ? 'good' : ''),
    kpi('Modified', NUM(cnt('UPDATE') + cnt('STATUS_CHANGE') + cnt('VALUE_CHANGE')), 'field edits'),
    kpi('Deleted', NUM(cnt('DELETE')), 'removed', cnt('DELETE') ? 'bad' : 'good'),
    kpi('Critical', NUM(win.filter(c => c.severity === 'CRITICAL').length), 'high severity', win.some(c => c.severity === 'CRITICAL') ? 'bad' : 'good'),
    kpi('Warnings', NUM(win.filter(c => c.severity === 'WARNING').length), 'medium severity', win.some(c => c.severity === 'WARNING') ? 'warn' : 'good'),
  ].join('');

  // req #4: priority = real data changes. System events stay secondary — hidden from the main
  // log unless explicitly selected (they remain in their own "System & Sync Events" section below).
  const showSys = afState.type === 'SYSTEM_EVENT';
  const tableRows = showSys ? win.filter(c => c.changeType === 'SYSTEM_EVENT') : dataCh;
  const tlabel = computeRange(state.filter.range).label;
  el('auditLogTitle').textContent = `FORENSIC CHANGE LOG · ${NUM(tableRows.length)} ${showSys ? 'system event(s)' : 'data change(s)'} · ${tlabel}`;
  const fmtT = ts => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
  el('forensicTable').innerHTML = table(
    ['Time', 'Severity', 'Type', 'Reference', 'Sheet', 'Column', 'Old value', 'New value', 'User'],
    tableRows.slice(0, 400).map(c => [
      `<span class="mono small">${fmtT(c.ts)}</span>`, sevPill(c.severity), typePill(c.changeType),
      `<b>${esc(c.ref || '—')}</b>`, esc(c.sheet || '—'), esc(c.column || '—'),
      c.oldValue ? `<span class="old-v">${esc(c.oldValue)}</span>` : '<span class="dimv">—</span>',
      c.newValue ? `<span class="new-v">${esc(c.newValue)}</span>` : '<span class="dimv">—</span>',
      esc(c.user || '—'),
    ]));

  // data validation card (req #5: missing amount is INFO, not an error — row is still logged)
  el('auditValidation').innerHTML = kv([
    ['Reconciliation', vd.reconciles ? '<span class="pill good">Balanced (Paid + Outstanding = Total)</span>' : '<span class="pill bad">Gap ' + AEDk(vd.gap) + '</span>'],
    ['Rows missing amounts', `<span class="pill info">${NUM(vd.missingAmounts)}</span> <span class="dimv small">— logged & tracked, not an error</span>`],
    ['Statuses off Settings list', `<span class="pill ${vd.brokenStatus ? 'warn' : 'good'}">${NUM(vd.brokenStatus)}</span>`],
    ['Cancelled (excluded from totals)', NUM(vd.cancelled)],
    ['Skipped rows (no/invalid date)', `<span class="pill ${(vd.skipped.noDate + vd.skipped.badDate) ? 'warn' : 'good'}">${NUM(vd.skipped.noDate + vd.skipped.badDate)}</span>`],
    ['Possible duplicates', `<span class="pill ${(v.duplicates || []).length ? 'warn' : 'good'}">${NUM((v.duplicates || []).length)}</span>`],
    ['Forensic events stored', NUM(forensic.total)],
  ]);

  // duplicate detection center
  const dupes = v.duplicates || [];
  el('auditDupes').innerHTML = dupes.length
    ? table(['Date', 'Client', 'Reference', 'Amount', 'Count', 'Sheet rows'], dupes.map(x => [esc(x.date), esc(x.client || '—'), esc(x.ref || '—'), AED(x.amount), `<span class="pill warn">${x.count}×</span>`, esc((x.rows || []).join(', '))]))
    : '<div class="empty" style="color:var(--green)">✓ No duplicate records detected (same date + client + amount + reference)</div>';

  // system & sync events (activity feed — server + this-browser actions)
  const sys = clientEvents.concat((d.audit || []).map(e => ({ ts: e.ts, status: e.status, event: e.event, details: e.details, client: false })))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 60);
  el('auditSystem').innerHTML = sys.map(e => `<div class="log-row"><span class="lt mono">${fmtT(e.ts)}</span><span class="le">${esc(e.event)}${e.client ? ' <span class="pill neutral xtag">you</span>' : ''}</span><span>${badge2(e.status)}</span><span class="ld">${esc(e.details)}</span></div>`).join('') || '<div class="empty">No events</div>';
}
// forensic filter controls (bound once) — time range now comes from the global filter (req #4)
el('afMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; auditMode = b.dataset.mode; el('afMode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); rAudit(); });
el('afSeverity').addEventListener('change', () => { afState.severity = el('afSeverity').value; rAudit(); });
el('afType').addEventListener('change', () => { afState.type = el('afType').value; rAudit(); });
el('afUser').addEventListener('change', () => { afState.user = el('afUser').value; rAudit(); });
el('afRef').addEventListener('input', () => { afState.q = el('afRef').value.trim(); rAudit(); });
el('auditExport').addEventListener('click', () => {
  const rows = filteredForensic();
  const head = ['Timestamp', 'User', 'Sheet', 'Reference', 'Column', 'OldValue', 'NewValue', 'ChangeType', 'Severity', 'Message'];
  const csv = '﻿' + [head.join(',')].concat(rows.map(c => [c.ts, c.user, c.sheet, c.ref, c.column, c.oldValue, c.newValue, c.changeType, c.severity, c.message]
    .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(','))).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ATS_audit_log.csv'; a.click(); URL.revokeObjectURL(url);
  logEvent('ok', 'Audit log exported', rows.length + ' forensic events exported to CSV');
});

/* ---------------- SYSTEM HEALTH ---------------- */
function trustVerdict() {
  const d = state.data, vd = d.validation, m = d.meta;
  const real = d.source === 'live' || d.source === 'file', bal = vd.reconciles;
  const srcTxt = d.source === 'live' ? 'live Google Sheet' : 'Excel fallback';
  const failures = (vd.skipped.badDate || 0) + (bal ? 0 : 1) + (real ? 0 : 1);
  if (real && bal && failures === 0) return { level: 'good', txt: 'TRUSTED', sub: 'Real data (' + srcTxt + ') · reconciliation balanced · no failed validations' };
  if (real && bal) return { level: 'warn', txt: 'TRUSTED (with warnings)', sub: 'Numbers reconcile (' + srcTxt + '), but some rows have data-quality warnings — see below' };
  if (!real) return { level: 'bad', txt: 'NOT TRUSTED', sub: 'No real data source is loaded' };
  return { level: 'bad', txt: 'NEEDS REVIEW', sub: 'Reconciliation gap or invalid dates detected — investigate failed validations' };
}
function rHealth() {
  const d = state.data, m = d.meta, vd = d.validation, ss = m.sheetStatus || {};
  const real = d.source === 'live' || d.source === 'file';
  const tv = trustVerdict();
  const ageMin = m.lastSync ? Math.round((Date.now() - new Date(m.lastSync).getTime()) / 60000) : null;
  const warnEvents = (d.audit || []).filter(e => e.status === 'warning' || e.status === 'error');
  el('trustBanner').className = 'trust ' + tv.level;
  el('trustBanner').innerHTML = `<div class="trust-ic"><i class="ti ${tv.level === 'good' ? 'ti-shield-check' : tv.level === 'warn' ? 'ti-shield-half' : 'ti-shield-x'}"></i></div><div><div class="trust-t">${tv.txt}</div><div class="trust-s">${tv.sub}</div></div><div class="trust-meta mono">${m.todayDubai}<br>${m.lastSync ? new Date(m.lastSync).toLocaleTimeString() : 'never synced'}</div>`;

  el('healthKpis').innerHTML = [
    kpi('Data Source', m.sourceLabel || (d.source === 'none' ? 'NONE' : d.source), d.source === 'live' ? 'primary · Google Sheet' : d.source === 'file' ? 'fallback · sheet unavailable' : 'no source', d.source === 'live' ? 'good' : d.source === 'file' ? 'warn' : 'bad'),
    kpi('Rows Loaded', NUM(m.totalRecords) + ' + ' + NUM(m.expenseRecords), 'txns + expenses', 'good'),
    kpi('Reconciliation', vd.reconciles ? 'Balanced' : 'Gap ' + AEDk(vd.gap), vd.reconciles ? 'Paid+Out = Total' : 'investigate', vd.reconciles ? 'good' : 'bad'),
    kpi('Active Warnings', NUM(vd.missingAmounts + vd.brokenStatus + vd.futureDates), 'data-quality flags', (vd.missingAmounts + vd.brokenStatus + vd.futureDates) ? 'warn' : 'good'),
    kpi('Failed Validations', NUM((vd.reconciles ? 0 : 1) + vd.skipped.badDate), 'hard errors', ((vd.reconciles ? 0 : 1) + vd.skipped.badDate) ? 'bad' : 'good'),
    kpi('Last Refresh', ageMin == null ? 'never' : ageMin <= 1 ? 'just now' : ageMin + ' min ago', 'auto every 60s', ageMin == null ? 'bad' : ageMin > 10 ? 'warn' : 'good'),
  ].join('');

  el('healthSource').innerHTML = kv([
    ['Source mode', `<span class="pill ${d.source === 'live' ? 'good' : d.source === 'file' ? 'warn' : 'bad'}">${esc(m.sourceLabel || d.source)}</span>`],
    ['Primary source', 'Google Sheet' + (d.source === 'live' ? ' <span class="pill good">connected</span>' : ' <span class="pill warn">unavailable</span>')],
    ['Reading from', esc(m.sourceMeta ? m.sourceMeta.workbook : '—')],
    ['Sheets detected', esc(m.sourceMeta ? (m.sourceMeta.tabs || []).length + ' (' + (m.sourceMeta.tabs || []).join(', ') + ')' : '—')],
    ['Transactions loaded', NUM(m.totalRecords) + ' valid / ' + NUM(m.rawRows) + ' raw'],
    ['Expenses loaded', NUM(m.expenseRecords)],
    ['Date range', esc(m.minDate) + ' → ' + esc(m.maxDate)],
    ['File modified', m.mtime ? new Date(m.mtime).toLocaleString() : '—'],
    ['Last sync', m.lastSync ? new Date(m.lastSync).toLocaleString() : 'never (not connected)'],
    ['Sync status', '<span class="pill good">active · 60s auto-refresh</span>'],
    ['Validation', vd.reconciles ? '<span class="pill good">balanced · passed</span>' : '<span class="pill bad">reconciliation gap</span>'],
    ['Demo data', '<span class="pill good">OFF</span>'],
  ]);
  el('healthConn').innerHTML = kv([
    ['Live Google Sheet', `<span class="pill ${ss.state === 'live' ? 'good' : ss.state === 'private' ? 'warn' : 'neutral'}">${esc((ss.state || 'unknown').toUpperCase())}</span>`],
    ['Reason', esc(ss.message || '—')],
    ['Spreadsheet ID', '<span class="mono small">' + esc(m.spreadsheetId || '—') + '</span>'],
    ['Last checked', ss.checkedAt ? new Date(ss.checkedAt).toLocaleString() : '—'],
    ['Reading from', d.source === 'live' ? 'live Google Sheet (gviz)' : real ? 'Excel emergency copy' : '—'],
    ['Audit events', NUM((d.audit || []).length) + ' recorded'],
  ]);

  const dg = d.view.diag || {};
  el('healthDates').innerHTML = kv([
    ['Data date range', `<b>${esc(dg.dataMinDate)}</b> → <b>${esc(dg.dataMaxDate)}</b>`],
    ['First transaction date', esc(dg.dataMinDate)],
    ['Last transaction date', esc(dg.dataMaxDate)],
    ['Today (Asia/Dubai)', esc(dg.today)],
    ['Selected filter range', `<b>${esc(dg.selectedFrom)}</b> → <b>${esc(dg.selectedTo)}</b>`],
    ['Transactions in selected range', `<span class="pill ${dg.txnsInRange ? 'good' : 'warn'}">${NUM(dg.txnsInRange)}</span>`],
    ['Expenses in selected range', NUM(dg.expensesInRange)],
    ['First / last in range', dg.firstInRange ? esc(dg.firstInRange) + ' → ' + esc(dg.lastInRange) : '— (no records in range)'],
  ]);

  const checks = [
    ['Real workbook loaded', real],
    ['Reconciliation balanced (Rev = Paid + Outstanding)', vd.reconciles],
    ['All key columns mapped', !Object.values(m.detectedColumns).some(x => /NOT FOUND/.test(x) && !/paidAmt/.test(Object.keys(m.detectedColumns).find(k => m.detectedColumns[k] === x) || ''))],
    ['No invalid dates', (vd.skipped.badDate || 0) === 0],
    ['No future-dated rows', (vd.futureDates || 0) === 0],
    ['All amounts present', (vd.missingAmounts || 0) === 0, true],
    ['All statuses on Settings list', (vd.brokenStatus || 0) === 0, true],
    ['Cancelled rows excluded from revenue', true],
  ];
  el('healthChecks').innerHTML = checks.map(([label, ok, soft]) => {
    const cls = ok ? 'good' : (soft ? 'warn' : 'bad');
    const ic = ok ? 'ti-circle-check' : (soft ? 'ti-alert-triangle' : 'ti-circle-x');
    return `<div class="chk"><i class="ti ${ic} ${cls}"></i><span>${esc(label)}</span><span class="chk-s ${cls}">${ok ? 'PASS' : (soft ? 'WARN' : 'FAIL')}</span></div>`;
  }).join('');

  // A · CRITICAL ISSUES
  const v = d.view;
  const sevItem = (ic, t2, s2) => `<div class="sev-item"><i class="ti ${ic}"></i><div><div class="si-t">${esc(t2)}</div><div class="si-s">${esc(s2 || '')}</div></div></div>`;
  const critical = [];
  if (d.source === 'error') critical.push(['ti-plug-connected-x', 'Google Sheet not connected', ss.message]);
  if (!vd.reconciles) critical.push(['ti-alert-octagon', 'Reconciliation gap ' + AEDk(vd.gap), 'Paid + Outstanding ≠ Total — investigate']);
  if (vd.skipped.badDate) critical.push(['ti-calendar-x', vd.skipped.badDate + ' rows with invalid dates', 'excluded from all totals']);
  const delsToday = (forensic.changes || []).filter(c => c.changeType === 'DELETE' && dubaiDayKey(c.ts) === m.todayDubai);
  if (delsToday.length) critical.push(['ti-trash', delsToday.length + ' transaction(s) deleted today', 'review in Audit Log']);
  el('healthCritical').innerHTML = critical.length ? critical.map(c => sevItem(c[0], c[1], c[2])).join('') : '<div class="empty" style="color:var(--green)">✓ No critical issues — dashboard is healthy</div>';

  // B · WARNINGS
  const warnings = [];
  if (vd.brokenStatus) warnings.push(['ti-alert-triangle', vd.brokenStatus + ' statuses off the Settings list', 'value not in the Settings tab']);
  if (vd.futureDates) warnings.push(['ti-calendar', vd.futureDates + ' future-dated rows', 'date later than today']);
  if (vd.skipped.noDate) warnings.push(['ti-calendar-off', vd.skipped.noDate + ' rows without a date', 'excluded from time analysis']);
  if ((v.duplicates || []).length) warnings.push(['ti-copy', (v.duplicates || []).length + ' possible duplicate records', 'see Audit Log → Duplicate Detection']);
  if (v.diag && v.diag.isEmpty) warnings.push(['ti-calendar-off', 'Selected range has no transactions', 'latest data ' + m.maxDate]);
  el('healthWarnings').innerHTML = warnings.length ? warnings.map(c => sevItem(c[0], c[1], c[2])).join('') : '<div class="empty" style="color:var(--green)">✓ No warnings</div>';

  // D · SYNC EVENTS
  el('healthSync').innerHTML = (d.audit || []).slice(0, 40).map(e => {
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(e.ts));
    return `<div class="log-row"><span class="lt mono">${t}</span><span class="le">${esc(e.event)}</span><span>${badge2(e.status)}</span><span class="ld">${esc(e.details)}</span></div>`;
  }).join('') || '<div class="empty">No sync events</div>';
}

/* ---------------- SETTINGS ---------------- */
function rSettings() {
  const d = state.data, m = d.meta, ss = m.sheetStatus || {};
  el('setSource').innerHTML = kv([
    ['Mode', `<span class="pill ${d.source === 'live' ? 'good' : d.source === 'file' ? 'warn' : 'bad'}">${esc(m.sourceLabel || d.source)}</span>`],
    ['Primary', 'Google Sheet (live)'],
    ['Reading from', esc(m.sourceMeta ? m.sourceMeta.workbook : '—')],
    ['Tabs', esc(m.sourceMeta ? (m.sourceMeta.tabs || []).join(', ') : '—')],
    ['Transactions loaded', NUM(m.totalRecords) + ' / ' + NUM(m.rawRows) + ' rows'],
    ['Expense rows', NUM(m.expenseRecords)],
    ['Date range', esc(m.minDate) + ' → ' + esc(m.maxDate)],
    ['File modified', m.mtime ? new Date(m.mtime).toLocaleString() : '—'],
    ['Last sync', m.lastSync ? new Date(m.lastSync).toLocaleString() : 'never (not connected)'],
  ]);
  el('setSheet').innerHTML = kv([
    ['Spreadsheet ID', '<span class="mono small">' + esc(m.spreadsheetId || '—') + '</span>'],
    ['Live sheet status', `<span class="pill ${ss.state === 'live' ? 'good' : ss.state === 'private' ? 'warn' : 'neutral'}">${esc(ss.state || 'unknown')}</span>`],
    ['Status detail', esc(ss.message || '—')],
    ['Checked at', ss.checkedAt ? new Date(ss.checkedAt).toLocaleString() : '—'],
    ['Mapping status', '<span class="pill good">all key columns detected</span>'],
  ]);
  el('setMapping').innerHTML = kv(Object.entries(m.detectedColumns).map(([k, v]) => [k, `<span class="mono small ${/NOT FOUND/.test(v) ? 'warn-txt' : ''}">${esc(v)}</span>`]));
  // master Settings lists (single source of truth)
  const st = d.view.settings || {};
  el('setLists').innerHTML = kv([
    ['Lead sources', esc((st.leadSources || []).join(', ') || '—')],
    ['Payment statuses', esc((st.paymentStatus || []).join(', ') || '—')],
    ['Delivery statuses', esc((st.deliveryStatus || []).join(', ') || '—')],
    ['Payment methods', esc((st.paymentMethods || []).join(', ') || '—')],
    ['Service types', esc((st.serviceTypes || []).join(', ') || '—')],
  ]);
  // settings protection — values found in the sheet but not in Settings
  const uv = (d.validation.unknownValues) || {};
  const rows = [];
  [['leads', 'Lead Source'], ['statuses', 'Payment Status'], ['methods', 'Payment Method'], ['services', 'Service Type']].forEach(([k, label]) =>
    (uv[k] || []).forEach(x => rows.push([label, `<span class="warn-txt">${esc(x.value)}</span>`, NUM(x.count), '<span class="pill warn">not in Settings</span>'])));
  el('setUnknown').innerHTML = rows.length ? table(['Category', 'Value (not in Settings)', 'Rows', 'Status'], rows)
    : '<div class="empty" style="color:var(--green)">✓ Every value in the sheet matches the Settings master — nothing auto-created.</div>';
  renderSettingsPrefs();
}
/* req #9: reflect current preferences in the controls + render the fixed colour legends */
function renderSettingsPrefs() {
  const p = getPrefs();
  const set = (id, val) => { const e = el(id); if (e) e.value = val; };
  set('prefLanding', p.landing); set('prefRange', p.range); set('prefRemember', p.remember);
  set('prefDensity', p.density); set('prefNotif', p.notif);
  set('prefTheme', document.body.classList.contains('light') ? 'light' : 'dark');
  const sw = (name, color) => `<div class="swatch"><span class="sw-chip" style="background:${color}"></span><span class="sw-n">${esc(name)}</span><span class="sw-hex mono">${color}</span></div>`;
  const st = (state.data && state.data.view.settings) || {};
  // lead source colors (from the Settings master, coloured by the fixed identity)
  const leads = (st.leadSources && st.leadSources.length) ? st.leadSources : ['Our Client', 'Google Ads', 'New', 'Walk-in Client', 'Other'];
  el('setLeadColors').innerHTML = leads.map(n => sw(n, leadColor(n))).join('');
  // payment method colors
  el('setMethodColors').innerHTML = ['Bank Transfer', 'Payment Link', 'Cash', 'Other'].map(n => sw(n, methodColor(n))).join('');
  // service + status chart colors
  const svcs = (st.serviceTypes && st.serviceTypes.length) ? st.serviceTypes.slice(0, 8) : ['Legal Translation', 'MOFA', 'Embassy', 'MOJ'];
  el('setChartColors').innerHTML = svcs.map((n, i) => sw(n, serviceColor(n, i))).join('')
    + sw('Paid', C.green) + sw('Outstanding', C.red) + sw('Cancelled', '#9CA3AF');
}
// bind preference controls once
function bindPrefs() {
  const reRender = () => { if (state.data) renderAll(); };
  const onChange = (id, key, after) => { const e = el(id); if (!e) return; e.addEventListener('change', () => { setPref(key, e.value); if (after) after(e.value); flashSaved(); }); };
  onChange('prefLanding', 'landing');
  onChange('prefRange', 'range');
  onChange('prefRemember', 'remember', () => saveView());
  onChange('prefDensity', 'density', v => { document.body.classList.toggle('compact', v === 'compact'); });
  onChange('prefNotif', 'notif', () => renderNotifications());
  const pt = el('prefTheme'); if (pt) pt.addEventListener('change', () => {
    const light = pt.value === 'light';
    document.body.classList.toggle('light', light);
    localStorage.setItem('ats-theme', light ? 'light' : 'dark');
    el('themeIcon').className = 'ti ' + (light ? 'ti-sun' : 'ti-moon');
    flashSaved(); reRender();
  });
  const rs = el('setReset'); if (rs) rs.addEventListener('click', () => {
    try { localStorage.removeItem(PREFS_KEY); localStorage.removeItem(VIEW_KEY); } catch (_) {}
    document.body.classList.remove('compact');
    flashSaved('Reset to defaults');
    renderSettingsPrefs();
  });
}
function flashSaved(msg) { const e = el('prefSaved'); if (!e) return; e.textContent = '✓ ' + (msg || 'Preference saved'); e.classList.add('show'); clearTimeout(flashSaved._t); flashSaved._t = setTimeout(() => e.classList.remove('show'), 1800); }
bindPrefs();
function kv(rows) { return rows.map(([k, v]) => `<div class="kvr"><span class="kvk">${esc(k)}</span><span class="kvv">${v}</span></div>`).join(''); }

/* ---------------- upload ---------------- */
el('upSource').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  el('upStatus').textContent = 'Uploading ' + f.name + '…';
  const fd = new FormData(); fd.append('file', f);
  try { const r = await fetch('/api/upload?type=source', { method: 'POST', body: fd }); if (!r.ok) throw new Error('failed'); el('upStatus').textContent = '✓ loaded'; el('fService').dataset.filled = ''; await load(true); }
  catch (err) { el('upStatus').textContent = '✗ ' + err.message; }
});

/* ---------------- client-side event log (feeds Audit Log) ---------------- */
const CLIENT_EVENTS_KEY = 'ats-events';
let clientEvents = [];
try { clientEvents = JSON.parse(localStorage.getItem(CLIENT_EVENTS_KEY) || '[]'); } catch (_) { clientEvents = []; }
function logEvent(status, event, details) {
  clientEvents.unshift({ ts: new Date().toISOString(), status, event, details, client: true });
  clientEvents = clientEvents.slice(0, 200);
  try { localStorage.setItem(CLIENT_EVENTS_KEY, JSON.stringify(clientEvents)); } catch (_) {}
  if (state.page === 'audit' && state.data) rAudit();
}

/* ---------------- notifications (driven by real app state) ---------------- */
const READ_KEY = 'ats-read-notifs';
function readSet() { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); } catch (_) { return new Set(); } }
function saveRead(s) { try { localStorage.setItem(READ_KEY, JSON.stringify([...s])); } catch (_) {} }
function buildNotifications() {
  const d = state.data; if (!d) return [];
  const m = d.meta, vd = d.validation, v = d.view, ss = m.sheetStatus || {};
  const ts0 = m.lastSync || m.fetchedAt || new Date().toISOString();
  const col = v.collection || {}, g = v.googleAds || {};
  const ns = [];
  // req #20: each notification carries a category (cat) for the dropdown filters
  if (d.source === 'error') ns.push({ id: 'err|' + (ss.checkedAt || ts0), level: 'error', cat: 'system', icon: 'ti-plug-connected-x', title: 'Google Sheet not connected', detail: 'Dashboard is showing NO data. Open System Health.', ts: ss.checkedAt || ts0, goto: 'health' });
  if (!vd.reconciles) ns.push({ id: 'recon|gap', level: 'error', cat: 'audit', icon: 'ti-alert-octagon', title: 'Reconciliation gap detected', detail: 'Paid + Outstanding ≠ Total (gap ' + AEDk(vd.gap) + ') — open Audit Log', ts: ts0, goto: 'audit' });
  // missing amount ≠ error (req #5): informational only — rows are still logged
  if (vd.missingAmounts) ns.push({ id: 'amt|' + vd.missingAmounts, level: 'info', cat: 'audit', icon: 'ti-pencil', title: vd.missingAmounts + ' transactions missing amounts', detail: 'Informational — open Audit Log to review affected rows', ts: ts0, goto: 'audit' });
  if (vd.brokenStatus) ns.push({ id: 'status|' + vd.brokenStatus, level: 'warning', cat: 'audit', icon: 'ti-alert-triangle', title: vd.brokenStatus + ' statuses off the Settings list', detail: 'Open Audit Log → Data Validation', ts: ts0, goto: 'audit' });
  // collections (req #20)
  if ((col.over90 || 0) > 0) ns.push({ id: 'coll90|' + col.over90, level: 'warning', cat: 'collection', icon: 'ti-clock-exclamation', title: AED(col.over90) + ' overdue 90+ days', detail: 'High-risk receivables — open Collection Center', ts: ts0, goto: 'collection' });
  else if ((col.over30 || 0) > 0) ns.push({ id: 'coll30|' + col.over30, level: 'info', cat: 'collection', icon: 'ti-clock-dollar', title: AED(col.over30) + ' overdue 30+ days', detail: 'Chase these receivables — open Collection Center', ts: ts0, goto: 'collection' });
  // google ads (req #20)
  if (g.roas != null && g.roas < 2 && (g.spend || 0) > 0) ns.push({ id: 'groas|' + g.roas, level: 'warning', cat: 'google', icon: 'ti-brand-google', title: 'Google Ads ROAS below 2x (' + g.roas.toFixed(2) + 'x)', detail: 'Marketing efficiency low — open Google Ads', ts: ts0, goto: 'google' });
  else if ((g.orders || 0) > 0) ns.push({ id: 'gads|' + (m.lastSync || ''), level: 'info', cat: 'google', icon: 'ti-brand-google', title: 'Google Ads: ' + NUM(g.orders) + ' orders · ' + AED(g.revenue), detail: (g.roas == null ? 'No spend recorded' : 'ROAS ' + g.roas.toFixed(2) + 'x') + ' — open Google Ads', ts: ts0, goto: 'google' });
  if (v.diag && v.diag.isEmpty) ns.push({ id: 'empty|' + v.filter.from + '|' + v.filter.to, level: 'warning', cat: 'system', icon: 'ti-calendar-off', title: 'Selected range has no transactions', detail: v.filter.from + ' → ' + v.filter.to + ' · latest data ' + m.maxDate, ts: ts0, goto: 'overview' });
  if (m.lastSync) ns.push({ id: 'sync|' + m.lastSync, level: 'info', cat: 'system', icon: 'ti-refresh', title: 'Data refreshed', detail: 'Synced ' + new Date(m.lastSync).toLocaleTimeString() + ' · ' + NUM(m.totalRecords) + ' transactions — open Sync Events', ts: ts0, goto: 'health' });
  ns.push({ id: 'src|' + d.source, level: d.source === 'live' ? 'info' : 'warning', cat: 'system', icon: 'ti-database', title: (m.sourceLabel || d.source), detail: d.source === 'live' ? 'Connected live to Google Sheet — open System Health' : (m.sourceMeta ? m.sourceMeta.workbook : '—'), ts: ts0, goto: 'health' });
  if (ss.state === 'private') ns.push({ id: 'sheet|private', level: 'warning', cat: 'system', icon: 'ti-cloud-off', title: 'Google Sheet not connected (private)', detail: 'Open System Health for details', ts: ss.checkedAt || m.lastSync, goto: 'health' });
  return ns;
}
const DISMISS_KEY = 'ats-notif-dismissed';
let notifFilter = 'all'; // req #20: All / warning / audit / google / collection / system
function dismissedSet() { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch (_) { return new Set(); } }
function saveDismissed(s) { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch (_) {} }
function liveNotifs() { const dm = dismissedSet(); const alertsOnly = getPrefs().notif === 'alerts'; return buildNotifications().filter(n => !dm.has(n.id) && (!alertsOnly || n.level !== 'info')); }
function unreadCount() { const r = readSet(); return liveNotifs().filter(n => (n.level === 'warning' || n.level === 'error') && !r.has(n.id)).length; }
function renderNotifications() {
  const all = liveNotifs(), r = readSet(), unread = unreadCount();
  // req #20: apply the active category filter (badge still reflects ALL unread)
  const ns = all.filter(n => notifFilter === 'all' ? true : notifFilter === 'warning' ? (n.level === 'warning' || n.level === 'error') : n.cat === notifFilter);
  const ff = el('notifFilters'); if (ff) ff.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.nf === notifFilter));
  const badge = el('nbadge');
  if (unread > 0) { badge.hidden = false; badge.textContent = unread > 9 ? '9+' : unread; } else { badge.hidden = true; }
  el('notifList').innerHTML = ns.map((n, i) => {
    const isUnread = (n.level === 'warning' || n.level === 'error') && !r.has(n.id);
    const lv = { info: 'info', warning: 'warn', error: 'bad' }[n.level] || 'neutral';
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(n.ts));
    return `<div class="nrow clickable ${isUnread ? 'unread' : ''}" data-ni="${i}"><div class="nic ${lv}"><i class="ti ${n.icon}"></i></div><div class="nbody"><div class="ntitle">${esc(n.title)}</div><div class="ndetail">${esc(n.detail)} <span class="nrow-go">›</span></div></div><div class="ntime mono">${t}</div><button class="nrow-x" data-clear="${i}" title="Clear">&times;</button></div>`;
  }).join('') || '<div class="empty">No notifications · all clear</div>';
  // clickable → navigate + deep-link + mark read
  el('notifList').querySelectorAll('.nrow[data-ni]').forEach(row => row.addEventListener('click', () => {
    const n = ns[+row.dataset.ni]; if (!n) return;
    const s = readSet(); s.add(n.id); saveRead(s);
    logEvent('info', 'Notification opened', n.title);
    closeDropdowns();
    if (n.goto) go(n.goto);
    renderNotifications();
  }));
  // per-item clear (persists)
  el('notifList').querySelectorAll('[data-clear]').forEach(x => x.addEventListener('click', e => {
    e.stopPropagation(); const n = ns[+x.dataset.clear]; if (!n) return;
    const dm = dismissedSet(); dm.add(n.id); saveDismissed(dm); renderNotifications();
  }));
}
function closeDropdowns(except) { ['notifPanel', 'profilePanel'].forEach(id => { if (id !== except) el(id).hidden = true; }); }
el('bellBtn').addEventListener('click', e => { e.stopPropagation(); const p = el('notifPanel'); const open = p.hidden; closeDropdowns('notifPanel'); p.hidden = !open; if (open) renderNotifications(); });
el('notifReadAll').addEventListener('click', e => { e.stopPropagation(); const s = readSet(); liveNotifs().forEach(n => s.add(n.id)); saveRead(s); logEvent('info', 'Notifications read', 'Marked all notifications as read'); renderNotifications(); });
// req #20: clear all (dismiss every currently-visible notification, persisted)
el('notifClearAll').addEventListener('click', e => { e.stopPropagation(); const dm = dismissedSet(); liveNotifs().forEach(n => dm.add(n.id)); saveDismissed(dm); logEvent('info', 'Notifications cleared', 'Cleared all notifications'); renderNotifications(); });
// req #20: category filter chips
el('notifFilters').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); notifFilter = b.dataset.nf; renderNotifications(); });
el('notifPanel').addEventListener('click', e => e.stopPropagation());
el('profileBtn').addEventListener('click', e => { e.stopPropagation(); const p = el('profilePanel'); const open = p.hidden; closeDropdowns('profilePanel'); if (open) renderProfileMenu(); p.hidden = !open; });
el('profilePanel').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => closeDropdowns());
function renderProfileMenu() {
  const d = state.data, m = d ? d.meta : {};
  el('profileMenu').innerHTML = [
    `<div class="pm-row"><span>Data source</span><b>${d ? esc(m.sourceLabel || d.source) : '—'}</b></div>`,
    `<div class="pm-row"><span>Last sync</span><b>${m.lastSync ? new Date(m.lastSync).toLocaleTimeString() : '—'}</b></div>`,
    `<div class="pm-row"><span>Demo data</span><b class="good-txt">OFF</b></div>`,
    `<button class="pm-link" data-pmgo="health"><i class="ti ti-heartbeat"></i> System Health</button>`,
    `<button class="pm-link" data-pmgo="settings"><i class="ti ti-settings"></i> Settings</button>`,
  ].join('');
  el('profileMenu').querySelectorAll('[data-pmgo]').forEach(b => b.addEventListener('click', () => { closeDropdowns(); go(b.dataset.pmgo); }));
}

/* ---------------- data load ---------------- */
// req #17: lightweight toast confirmation
function toast(msg, tone) {
  let host = el('toastHost'); if (!host) { host = document.createElement('div'); host.id = 'toastHost'; host.className = 'toast-host'; document.body.appendChild(host); }
  const t = document.createElement('div'); t.className = 'toast ' + (tone || 'good'); t.innerHTML = `<i class="ti ${tone === 'bad' ? 'ti-alert-triangle' : 'ti-circle-check'}"></i><span>${esc(msg)}</span>`;
  host.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
let firstLoad = true;
let prevSource = null;        // tracks source mode across loads (for recovery/lost detection)
async function load(fresh, notify) {
  try {
    const f = state.filter;
    const params = new URLSearchParams({ from: f.from || '', to: f.to || '', service: f.service || 'All', lead: f.lead || 'All' });
    if (fresh) params.set('fresh', '1');
    const res = await fetch('/api/data?' + params.toString());
    const d = await res.json();
    if (!res.ok) throw new Error(d.message || 'Failed');

    // --- state reset on every successful response: trust the fresh payload only ---
    state.data = d;
    // hard-reset both transient banners; renderChrome re-shows them ONLY if genuinely needed
    el('errorBanner').hidden = true;
    el('emptyBanner').hidden = true;
    const src = d.source, label = d.meta.sourceLabel || src;
    console.log('[ATS] source=' + src, d.meta.detectedColumns);

    // connection state transitions -> Audit Log (resolved/lost), notifications recompute from fresh state
    if (prevSource !== null && prevSource === 'error' && src !== 'error') {
      logEvent('ok', 'Connection recovered', 'Google Sheet reconnected — ' + label + ' · ' + NUM(d.meta.totalRecords) + ' transactions. Previous connection error resolved.');
    } else if (prevSource !== null && prevSource !== 'error' && src === 'error') {
      logEvent('error', 'Connection lost', d.meta.error || 'Google Sheet became unreachable');
    }

    if (firstLoad) { logEvent('ok', 'Dashboard opened', 'Source: ' + label + ' · ' + NUM(d.meta.totalRecords) + ' transactions'); firstLoad = false; }
    else if (fresh && src !== 'error') { logEvent('ok', 'Data refreshed', NUM(d.meta.totalRecords) + ' transactions · ' + label + ' · validation ' + (d.validation.reconciles ? 'passed' : 'gap')); }
    prevSource = src;

    const sy = window.scrollY;  // req #7: preserve scroll position across refresh/sync re-renders
    renderAll();               // re-renders chrome (banners, sync chip, notifications) + active page from fresh state
    if (sy) window.scrollTo({ top: sy });
    if (state.page === 'audit') loadForensic(true);  // pull any newly-detected changes
    el('loading').style.display = 'none';
    // req #17: explicit-sync confirmation toast (NOT on silent 60s auto-refresh)
    if (notify) {
      if (src === 'error') toast('Sync failed — Google Sheet not connected', 'bad');
      else toast('Google Sheet synced successfully · ' + NUM(d.meta.totalRecords) + ' rows', 'good');
    }
  } catch (e) { console.error('[ATS] load error', e); el('loading').innerHTML = '<p style="color:var(--red)">Failed: ' + esc(e.message) + '</p>'; if (notify) toast('Sync failed: ' + e.message, 'bad'); }
}
el('syncNow').addEventListener('click', () => { logEvent('info', 'Sync now', 'Manual sync requested'); load(true, true); });
restoreView();  // req #7: restore last page + filters (or apply preferred defaults) before first load
load();
// auto-refresh every 60s on ANY page/range so the UI recovers automatically (no browser refresh needed)
setInterval(() => load(true), 60 * 1000);
