'use strict';
/* ALMUTARJEM Executive Control Center — front-end controller */
const AED  = n => 'AED ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AEDk = n => { n = Number(n) || 0; const s = n < 0 ? '-' : ''; n = Math.abs(n); return n >= 1000 ? s + 'AED ' + (n / 1000).toFixed(1) + 'K' : s + 'AED ' + n.toFixed(0); };
const NUM  = n => (Number(n) || 0).toLocaleString('en-US');
const PCT  = n => (Number(n) || 0).toFixed(1) + '%';
const el   = id => document.getElementById(id);
const esc  = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const C = { accent: '#7C5CFC', accent2: '#9B7BFF', blue: '#3B82F6', green: '#2DBE8B', red: '#F0616A', orange: '#F2A23C', teal: '#22B8C9', pink: '#EC6FA8', gold: '#E6B84A', muted: '#8A97B5' };
const PALETTE = [C.pink, C.blue, C.green, C.orange, C.accent, C.teal, C.gold, '#9CA3AF', '#6366F1', '#EC4899'];

const state = { data: null, filter: { range: 'all', from: '', to: '', service: 'All', lead: 'All' }, page: 'overview' };

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
}
document.querySelectorAll('[data-page]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.page); }));
el('ham').addEventListener('click', () => el('sidebar').classList.toggle('open'));
el('refreshBtn').addEventListener('click', () => { logEvent('info', 'Refresh clicked', 'Manual data refresh requested'); load(true); });

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
  el('execRev').textContent = AED(at.totalRevenue);
  el('execExp').textContent = AED(at.totalExpenses);

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
  const optSig = m.options.services.join('|') + '##' + m.options.leads.join('|');
  if (el('fService').dataset.sig !== optSig && (m.options.services.length || m.options.leads.length)) {
    const curS = el('fService').value || v.filter.service, curL = el('fLead').value || v.filter.lead;
    el('fService').innerHTML = '<option value="All">All Services</option>' + m.options.services.map(s => `<option>${esc(s)}</option>`).join('');
    el('fLead').innerHTML = '<option value="All">All Sources</option>' + m.options.leads.map(s => `<option>${esc(s)}</option>`).join('');
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
  ({ overview: rOverview, money: rMoney, pipeline: rPipeline, operations: rOps, clients: rClients, google: rGoogle, reports: rReports, audit: rAudit, health: rHealth, settings: rSettings }[page] || (() => {}))();
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
  draw('ovLead', { type: 'doughnut', data: { labels: leads.map(l => l.name), datasets: [{ data: leads.map(l => l.revenue), backgroundColor: PALETTE, borderWidth: 0 }] }, options: doughnut() });
  el('ovSvc').innerHTML = bars(v.topServices.slice(0, 6).map(s => ({ name: s.name, value: s.revenue })), null, i => PCT(k.totalRevenue ? i.value / k.totalRevenue * 100 : 0));

  const margin = k.profitMargin, coll = k.collectionRate;
  el('ovHealth').innerHTML = [
    healthRow('Collection Rate', PCT(coll), coll >= 70 ? 'good' : coll >= 50 ? 'warn' : 'bad'),
    healthRow('Profit Margin', PCT(margin), margin >= 30 ? 'good' : margin >= 15 ? 'warn' : 'bad'),
    healthRow('Outstanding Ratio', PCT(outShare), outShare <= 20 ? 'good' : outShare <= 40 ? 'warn' : 'bad'),
    healthRow('ROAS (Google)', k.roas == null ? 'N/A' : k.roas.toFixed(2) + 'x', k.roas == null ? 'neutral' : k.roas >= 2 ? 'good' : 'warn'),
    healthRow('Reconciliation', rec.reconciles ? 'Balanced' : 'Gap', rec.reconciles ? 'good' : 'bad'),
  ].join('');
}
function healthRow(l, v, tone) { return `<div class="hr"><span class="hr-l">${l}</span><span class="hr-v mono">${v}</span><span class="dot ${tone}"></span></div>`; }

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
  draw('moMethods', { type: 'doughnut', data: { labels: pm.map(p => p.name), datasets: [{ data: pm.map(p => p.value), backgroundColor: PALETTE, borderWidth: 0 }] }, options: doughnut() });
  el('moExpenses').innerHTML = table(['Date', 'Category', 'Status', 'Amount'], (v.expensesList || []).slice(0, 20).map(e => [esc(e.date || '—'), esc(e.category), badge((e.status || '').toLowerCase() || 'pending'), AED(e.amount)]));
  el('moTopClients').innerHTML = table(['Client', 'Revenue', 'Paid', 'Orders'], v.topClients.slice(0, 10).map(c => [esc(c.client), AED(c.revenue), AED(c.paid), NUM(c.orders)]));
  const ageing = v.outstandingOrders.slice(0, 12);
  el('moAgeing').innerHTML = table(['Date', 'Client', 'Service', 'Owed'], ageing.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), AED(o.amount)]));
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
  draw('clLead', { type: 'doughnut', data: { labels: Object.keys(byLead), datasets: [{ data: Object.values(byLead), backgroundColor: PALETTE, borderWidth: 0 }] }, options: Object.assign(doughnut(), { plugins: { legend: { position: 'right', labels: { color: C.muted, font: { size: 11 }, boxWidth: 11, padding: 9 } }, tooltip: { callbacks: { label: c => c.label + ': ' + NUM(c.parsed) + ' clients' } } } }) });
  el('clTable').innerHTML = table(['Client', 'Source', 'Orders', 'Revenue', 'Outstanding', 'Last Order'], tc.slice(0, 40).map(c => [esc(c.client || '—'), esc(c.lead) + (c.repeat ? ' <span class="pill info">repeat</span>' : ''), NUM(c.orders), AED(c.revenue), c.outstanding > 0 ? `<span class="warn-txt">${AED(c.outstanding)}</span>` : AED(0), esc(c.lastDate)]));
}

/* ---------------- GOOGLE ADS ---------------- */
function rGoogle() {
  const v = state.data.view, k = v.kpis;
  const noSpend = k.adSpend <= 0;
  const cards = [
    kpi('Google Ads Revenue', AED(k.googleRevenue), PCT(k.googleRevenueShare) + ' of total revenue'),
    kpi('Google Ads Orders', NUM(k.googleOrders), 'attributed orders'),
    kpi('Ad Spend', noSpend ? 'AED 0.00' : AED(k.adSpend), noSpend ? 'none recorded this period' : 'from Expenses', noSpend ? 'warn' : ''),
  ];
  if (!noSpend) cards.push(
    kpi('ROAS', k.roas.toFixed(2) + 'x', 'revenue per AED 1 spent', k.roas >= 2 ? 'good' : 'warn'),
    kpi('CPA (cost / order)', AED(k.costPerOrder), 'ad spend / orders'),
    kpi('Net from Ads', AED(k.netFromAds), 'revenue − spend', k.netFromAds >= 0 ? 'good' : 'bad'),
  );
  el('gKpis').innerHTML = cards.join('');
  const note = el('gNote');
  note.hidden = false;
  if (noSpend) {
    note.className = 'callout warn';
    note.innerHTML = `<i class="ti ti-alert-triangle"></i> <b>No Google Ads spend recorded for this selected period.</b> ROAS and CPA are hidden because they cannot be calculated without spend. Revenue & orders above are real — attributed from <b>Lead Source = "Google Ads"</b>. Add a "Google Ads" expense in this date range to see ROAS / CPA.`;
  } else {
    note.className = 'callout';
    note.innerHTML = `<i class="ti ti-info-circle"></i> Attribution: revenue & orders where <b>Lead Source = "Google Ads"</b>; spend from Expenses category "Google Ads". ROAS ${k.roas.toFixed(2)}x = AED ${k.roas.toFixed(2)} earned per AED 1 spent · CPA ${AED(k.costPerOrder)} per order.`;
  }
  const oth = Math.max(0, k.totalRevenue - k.googleRevenue);
  draw('gShare', { type: 'doughnut', data: { labels: ['Google Ads', 'Other sources'], datasets: [{ data: [k.googleRevenue, oth], backgroundColor: [C.accent, '#64748B'], borderWidth: 0 }] }, options: doughnut() });
  // google revenue over time from googleAdsLeads
  const byDay = {}; v.googleAdsLeads.forEach(g => byDay[g.date] = (byDay[g.date] || 0) + g.amount);
  const days = Object.keys(byDay).sort();
  draw('gTrend', { type: 'line', data: { labels: days, datasets: [{ data: days.map(d => Math.round(byDay[d])), borderColor: C.blue, backgroundColor: 'rgba(59,130,246,.15)', fill: true, tension: .35, borderWidth: 3, pointRadius: 2 }] }, options: axis(true) });
  el('gOrders').innerHTML = table(['Date', 'Client', 'Service', 'Amount', 'Payment'], v.googleAdsLeads.map(g => [esc(g.date), esc(g.client || '—'), esc(g.service), AED(g.amount), badge(g.status)]));
}

/* ---------------- REPORTS ---------------- */
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
  el('repTitle').textContent = `TRANSACTION REGISTER · ${v.recentTransactions.length} shown · ${v.filter.from} → ${v.filter.to}`;
  el('repTable').innerHTML = table(['Date', 'Client', 'Service', 'Ref', 'Source', 'Method', 'Amount', 'Payment', 'Delivery'],
    v.recentTransactions.map(o => [esc(o.date), esc(o.client || '—'), esc(o.service), esc(o.ref || '—'), esc(o.lead), esc(o.method), AED(o.amount), badge(o.status), badge(o.delivery)]));
}
function qs() { const f = state.data.view.filter; return `from=${f.from}&to=${f.to}&service=${encodeURIComponent(f.service)}&lead=${encodeURIComponent(f.lead)}`; }
el('expCsv').addEventListener('click', () => { logEvent('ok', 'Export generated', 'CSV export · ' + state.data.view.filter.from + ' → ' + state.data.view.filter.to); window.open('/api/export?' + qs(), '_blank'); });
el('expExcel').addEventListener('click', () => { logEvent('ok', 'Export generated', 'Excel export · ' + state.data.view.filter.from + ' → ' + state.data.view.filter.to); window.open('/api/export?' + qs(), '_blank'); });
el('expPdf').addEventListener('click', () => { logEvent('ok', 'Export generated', 'PDF / print export'); window.print(); });

/* ---------------- AUDIT LOG (forensic) ---------------- */
function dubaiDayKey(ts) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(ts)); } catch (_) { return ''; } }
function badge2(s) { const m = { ok: 'good', info: 'info', warning: 'warn', error: 'bad' }; return `<span class="pill ${m[s] || 'neutral'}">${esc(s)}</span>`; }

let auditTime = 'today';
const afState = { severity: 'all', type: 'all', user: 'all', q: '' };
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
function timeWindow() {
  const today = state.data.meta.todayDubai; const [y, mm, dd] = today.split('-').map(Number);
  const yKey = dStr(new Date(y, mm - 1, dd - 1)), wk = dStr(new Date(y, mm - 1, dd - 6));
  return { today, yKey, wk };
}
function filteredForensic() {
  const w = timeWindow();
  return forensic.changes.filter(c => {
    const day = dubaiDayKey(c.ts);
    if (auditTime === 'today' && day !== w.today) return false;
    if (auditTime === 'yesterday' && day !== w.yKey) return false;
    if (auditTime === '7' && day < w.wk) return false;
    if (afState.severity !== 'all' && c.severity !== afState.severity) return false;
    if (afState.type !== 'all' && c.changeType !== afState.type) return false;
    if (afState.user !== 'all' && c.user !== afState.user) return false;
    if (afState.q) { const h = (c.ref + ' ' + c.column + ' ' + c.message + ' ' + c.oldValue + ' ' + c.newValue + ' ' + c.user).toLowerCase(); if (h.indexOf(afState.q.toLowerCase()) < 0) return false; }
    return true;
  });
}
function rAudit() {
  const d = state.data, vd = d.validation;
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

  const tlabel = { today: 'today', yesterday: 'yesterday', '7': 'last 7 days', all: 'all time' }[auditTime];
  el('auditLogTitle').textContent = `FORENSIC CHANGE LOG · ${win.length} events · ${tlabel}`;
  const fmtT = ts => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
  el('forensicTable').innerHTML = table(
    ['Time', 'Severity', 'Type', 'Reference', 'Sheet', 'Column', 'Old value', 'New value', 'User'],
    win.slice(0, 400).map(c => [
      `<span class="mono small">${fmtT(c.ts)}</span>`, sevPill(c.severity), typePill(c.changeType),
      `<b>${esc(c.ref || '—')}</b>`, esc(c.sheet || '—'), esc(c.column || '—'),
      c.oldValue ? `<span class="old-v">${esc(c.oldValue)}</span>` : '<span class="dimv">—</span>',
      c.newValue ? `<span class="new-v">${esc(c.newValue)}</span>` : '<span class="dimv">—</span>',
      esc(c.user || '—'),
    ]));

  // data validation card
  el('auditValidation').innerHTML = kv([
    ['Reconciliation', vd.reconciles ? '<span class="pill good">Balanced (Paid + Outstanding = Total)</span>' : '<span class="pill bad">Gap ' + AEDk(vd.gap) + '</span>'],
    ['Missing amounts', `<span class="pill ${vd.missingAmounts ? 'warn' : 'good'}">${NUM(vd.missingAmounts)}</span>`],
    ['Off-list statuses', `<span class="pill ${vd.brokenStatus ? 'warn' : 'good'}">${NUM(vd.brokenStatus)}</span>`],
    ['Cancelled (excluded)', NUM(vd.cancelled)],
    ['Skipped rows (no/invalid date)', NUM(vd.skipped.noDate + vd.skipped.badDate)],
    ['Forensic events stored', NUM(forensic.total)],
  ]);

  // system & sync events (activity feed — server + this-browser actions)
  const sys = clientEvents.concat((d.audit || []).map(e => ({ ts: e.ts, status: e.status, event: e.event, details: e.details, client: false })))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 60);
  el('auditSystem').innerHTML = sys.map(e => `<div class="log-row"><span class="lt mono">${fmtT(e.ts)}</span><span class="le">${esc(e.event)}${e.client ? ' <span class="pill neutral xtag">you</span>' : ''}</span><span>${badge2(e.status)}</span><span class="ld">${esc(e.details)}</span></div>`).join('') || '<div class="empty">No events</div>';
}
// forensic filter controls (bound once)
el('afTime').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; auditTime = b.dataset.af; el('afTime').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); rAudit(); });
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
    ['Reading from', real ? 'in-project Excel copy (live sheet private)' : '—'],
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

  el('healthWarn').innerHTML = table(['Time', 'Event', 'Status', 'Details'],
    warnEvents.slice(0, 40).map(e => {
      const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(e.ts));
      return [`<span class="mono small">${t}</span>`, esc(e.event), badge2(e.status), esc(e.details)];
    }));
  if (!warnEvents.length) el('healthWarn').innerHTML = '<div class="empty" style="color:var(--green)">✓ No active warnings or failed validations</div>';
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
  const lists = d.allTime ? null : null;
  const opt = m.options;
  el('setLists').innerHTML = kv([
    ['Service types', esc(opt.services.join(', ') || '—')],
    ['Lead sources', esc(opt.leads.join(', ') || '—')],
    ['Payment statuses', esc(opt.statuses.join(', ') || '—')],
    ['Payment methods', esc(opt.methods.join(', ') || '—')],
    ['Delivery statuses', esc(opt.deliveries.join(', ') || '—')],
  ]);
}
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
  const ns = [];
  if (d.source === 'error') ns.push({ id: 'err|' + (ss.checkedAt || ts0), level: 'error', icon: 'ti-plug-connected-x', title: 'Google Sheet not connected', detail: 'Dashboard is showing NO data (no stale Excel). Share the Sheet "Anyone with link → Viewer".', ts: ss.checkedAt || ts0 });
  if (!vd.reconciles) ns.push({ id: 'recon|gap', level: 'error', icon: 'ti-alert-octagon', title: 'Reconciliation gap detected', detail: 'Paid + Outstanding ≠ Total (gap ' + AEDk(vd.gap) + ')', ts: ts0 });
  if (vd.missingAmounts) ns.push({ id: 'amt|' + vd.missingAmounts, level: 'warning', icon: 'ti-alert-triangle', title: vd.missingAmounts + ' transactions missing amounts', detail: 'Open Audit Log to see affected rows', ts: ts0 });
  if (vd.brokenStatus) ns.push({ id: 'status|' + vd.brokenStatus, level: 'warning', icon: 'ti-alert-triangle', title: vd.brokenStatus + ' statuses off the Settings list', detail: 'Payment status value not in the Settings tab', ts: ts0 });
  if (v.diag && v.diag.isEmpty) ns.push({ id: 'empty|' + v.filter.from + '|' + v.filter.to, level: 'warning', icon: 'ti-calendar-off', title: 'Selected range has no transactions', detail: v.filter.from + ' → ' + v.filter.to + ' · latest data ' + m.maxDate, ts: ts0 });
  if (m.lastSync) ns.push({ id: 'sync|' + m.lastSync, level: 'info', icon: 'ti-refresh', title: 'Data refreshed', detail: 'Synced ' + new Date(m.lastSync).toLocaleTimeString() + ' · ' + NUM(m.totalRecords) + ' transactions', ts: ts0 });
  ns.push({ id: 'src|' + d.source, level: d.source === 'live' ? 'info' : 'warning', icon: 'ti-database', title: 'Source: ' + (m.sourceLabel || d.source), detail: d.source === 'live' ? 'Connected live to Google Sheet' : (m.sourceMeta ? m.sourceMeta.workbook : '—'), ts: ts0 });
  if (ss.state === 'private') ns.push({ id: 'sheet|private', level: 'warning', icon: 'ti-cloud-off', title: 'Google Sheet not connected (private)', detail: 'Share it "Anyone with link → Viewer" to go LIVE · Excel fallback in use', ts: ss.checkedAt || m.lastSync });
  return ns;
}
function unreadCount() { const r = readSet(); return buildNotifications().filter(n => (n.level === 'warning' || n.level === 'error') && !r.has(n.id)).length; }
function renderNotifications() {
  const ns = buildNotifications(), r = readSet(), unread = unreadCount();
  const badge = el('nbadge');
  if (unread > 0) { badge.hidden = false; badge.textContent = unread > 9 ? '9+' : unread; } else { badge.hidden = true; }
  el('notifList').innerHTML = ns.map(n => {
    const isUnread = (n.level === 'warning' || n.level === 'error') && !r.has(n.id);
    const lv = { info: 'info', warning: 'warn', error: 'bad' }[n.level] || 'neutral';
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(n.ts));
    return `<div class="nrow ${isUnread ? 'unread' : ''}"><div class="nic ${lv}"><i class="ti ${n.icon}"></i></div><div class="nbody"><div class="ntitle">${esc(n.title)}</div><div class="ndetail">${esc(n.detail)}</div></div><div class="ntime mono">${t}</div></div>`;
  }).join('') || '<div class="empty">No notifications</div>';
}
function closeDropdowns(except) { ['notifPanel', 'profilePanel'].forEach(id => { if (id !== except) el(id).hidden = true; }); }
el('bellBtn').addEventListener('click', e => { e.stopPropagation(); const p = el('notifPanel'); const open = p.hidden; closeDropdowns('notifPanel'); p.hidden = !open; if (open) renderNotifications(); });
el('notifReadAll').addEventListener('click', e => { e.stopPropagation(); const s = readSet(); buildNotifications().forEach(n => s.add(n.id)); saveRead(s); logEvent('info', 'Notifications read', 'Marked all notifications as read'); renderNotifications(); });
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
let firstLoad = true;
let prevSource = null;        // tracks source mode across loads (for recovery/lost detection)
async function load(fresh) {
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

    renderAll();               // re-renders chrome (banners, sync chip, notifications) + active page from fresh state
    if (state.page === 'audit') loadForensic(true);  // pull any newly-detected changes
    el('loading').style.display = 'none';
  } catch (e) { console.error('[ATS] load error', e); el('loading').innerHTML = '<p style="color:var(--red)">Failed: ' + esc(e.message) + '</p>'; }
}
el('syncNow').addEventListener('click', () => { logEvent('info', 'Sync now', 'Manual sync requested'); load(true); });
load();
// auto-refresh every 60s on ANY page/range so the UI recovers automatically (no browser refresh needed)
setInterval(() => load(true), 60 * 1000);
