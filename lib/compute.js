'use strict';
/**
 * ALMUTARJEM dashboard calculation engine. Pure functions over the raw workbook.
 *
 * Pipeline:
 *   parseAll(transTable, expTable, settingsTable, now)
 *       -> normalised records + expenses + settings + meta + audit log
 *   analyze(parsed, filter)
 *       -> KPIs / charts / tables computed over the FILTERED date+facet range
 *
 * Business rules (per spec, unchanged):
 *  - Cancelled / refunded rows are excluded from revenue, orders, Google Ads, ROAS.
 *  - Total Revenue must reconcile to Paid + Outstanding (gaps are flagged in audit).
 *  - "Unpaid"/"Not Paid" are NEVER counted as Paid (substring 'paid' trap avoided).
 *  - Amounts handle 158 / "AED 158.00" / "1,580.00" / Arabic-indic digits.
 *  - Dates resolved on the Asia/Dubai calendar; columns detected from headers.
 */

const TZ = 'Asia/Dubai';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ----------------------------- column detection ---------------------------- */
function norm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }

function findCol(headers, aliases, exclude) {
  const H = headers.map(norm);
  const ex = (exclude || []).map(norm);
  const blocked = i => ex.some(e => H[i].includes(e));
  for (const a of aliases) { const k = norm(a); for (let i = 0; i < H.length; i++) if (H[i] === k && !blocked(i)) return i; }
  for (const a of aliases) { const k = norm(a); for (let i = 0; i < H.length; i++) if (H[i].includes(k) && !blocked(i)) return i; }
  return -1;
}

function detectColumns(headers) {
  const c = {};
  c.date    = findCol(headers, ['date', 'transaction date', 'التاريخ', 'تاريخ', 'day']);
  c.ref     = findCol(headers, ['refrence number', 'reference number', 'reference', 'ref', 'file name', 'document', 'الرقم المرجعي']);
  c.amount  = findCol(headers, ['amount (aed)', 'amount', 'aed', 'total amount', 'total', 'price', 'value', 'المبلغ', 'القيمة']);
  c.paidAmt = findCol(headers, ['paid amount', 'amount paid', 'المبلغ المدفوع']);
  c.delivery= findCol(headers, ['delivery status', 'file status', 'order status', 'حالة الملف', 'حالة التسليم', 'delivery']);
  c.payment = findCol(headers, ['payment status', 'payment_status', 'paymentstatus', 'حالة الدفع', 'الدفع'], ['delivery', 'file']);
  if (c.payment < 0) c.payment = findCol(headers, ['status', 'الحالة'], ['delivery', 'file', 'order']);
  c.method  = findCol(headers, ['payment method', 'method', 'طريقة الدفع']);
  c.lead    = findCol(headers, ['lead source', 'lead_source', 'leadsource', 'source', 'channel', 'المصدر']);
  c.client  = findCol(headers, ['company or client name', 'client name', 'client', 'customer', 'company', 'العميل', 'الاسم', 'name']);
  c.phone   = findCol(headers, ['phone number', 'phone', 'mobile', 'رقم', 'الهاتف']);
  c.service = findCol(headers, ['service type', 'service', 'نوع الخدمة', 'الخدمة', 'description', 'الوصف']);
  c.notes   = findCol(headers, ['notes', 'note', 'remarks', 'ملاحظات']);
  return c;
}

/* ------------------------------- primitives -------------------------------- */
function parseAmount(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim(); if (!s) return 0;
  s = s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
function hasAmount(v) { // distinguishes "missing" from "zero"
  if (v == null) return false;
  if (typeof v === 'number') return true;
  return String(v).trim() !== '' && /\d/.test(String(v));
}
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function dateKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function todayKeyDubai(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

/* -------------------------- status normalization --------------------------- */
function normalizePayment(raw) {
  let s = norm(raw);
  if (!s) return 'outstanding';
  if (/\bcancel|cancelled|canceled|refund|refunded|ملغ|الغاء|إلغاء|مسترد|مرتجع/.test(s)) return 'cancelled';
  if (/partial|part paid|deposit|advance|جزئ|دفعة/.test(s)) return 'partial';
  if (/unpaid|un paid|not paid|notpaid|no paid|pending|outstanding|due|overdue|غير مدفوع|لم يدفع|معلق|قيد|متأخر|آجل/.test(s)) return 'outstanding';
  if (/paid|settled|received|cleared|complete|completed|done|مدفوع|تم الدفع|محصل/.test(s)) return 'paid';
  return 'outstanding';
}
function normalizeDelivery(raw) {
  const s = norm(raw);
  if (!s) return 'pending';
  if (/cancel|ملغ|الغاء/.test(s)) return 'cancelled';
  if (/deliver|complete|done|sent|تم التسليم|مكتمل/.test(s)) return 'delivered';
  if (/progress|working|processing|قيد|جار/.test(s)) return 'in progress';
  if (/pending|waiting|queue|معلق|انتظار/.test(s)) return 'pending';
  return 'pending';
}
function isGoogleLead(s) { s = norm(s); return s.includes('google') || s.includes('ادز') || s.includes('جوجل') || s.includes('قوقل'); }
// Canonical lead identity (req #2/#3): collapse to the 5 known buckets so unknown
// sources (e.g. "Direct") are NEVER shown as their own slice — they fold into "Other"
// (and are still logged in validation.unknownValues / Settings Protection). Display-only;
// the raw lead text is preserved on each record for attribution/audit.
function canonLead(raw) {
  const s = norm(raw);
  if (!s) return 'Other';
  if (s.includes('google') || s.includes('ادز') || s.includes('جوجل') || s.includes('قوقل')) return 'Google Ads';
  if (s.includes('walk')) return 'Walk-in Client';
  if (s.includes('our') || s.includes('existing') || (s.includes('client') && !s.includes('new'))) return 'Our Client';
  if (s.includes('new')) return 'New';
  return 'Other';
}
// req #4/#10: approved lead-source aliases → canonical display label. Known synonyms are
// normalized (NOT pushed into "Other"); Settings stays master, and genuinely-unknown values
// are still flagged in Settings Protection. Display-only — raw lead text stays on each record.
//   Our Client / Existing → "Client"      ·  any "walk…" → "Walk-in Client"
//   New / New Client → "New"              ·  any Google variant → "Google Ads"
//   exact Settings value (Referral, Instagram, WhatsApp, …) → kept as-is
function aliasLead(raw, allowed) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return 'Other';
  const n = norm(v);
  // Keep "Google Ads Returning" as its own bucket (must be tested BEFORE the generic Google merge),
  // so returning Google clients are not silently folded into direct "Google Ads".
  if (n.includes('return') && (n.includes('google') || n.includes('ads'))) return 'Google Ads Returning';
  if (isGoogleLead(v)) return 'Google Ads';
  if (n === 'our client' || n === 'existing client' || n === 'existing' || n === 'our clients' || n === 'client') return 'Our Client';
  if (n.includes('walk')) return 'Walk-in Client';
  if (n === 'new' || n === 'new client') return 'New Client';
  if (allowed && allowed.size && allowed.has(n)) return v; // exact Settings master value
  return 'Other';
}

/* ------------------------------- settings ---------------------------------- */
function parseSettings(table) {
  const out = { leadSources: [], paymentStatus: [], deliveryStatus: [], paymentMethods: [], expenseCategories: [], serviceTypes: [] };
  if (!table || !table.headers) return out;
  const map = {
    leadSources: ['lead source', 'lead sources'], paymentStatus: ['payment status'],
    deliveryStatus: ['delivery status'], paymentMethods: ['payment method', 'payment methods'],
    expenseCategories: ['expense categor'], serviceTypes: ['service type', 'service types'],
  };
  const H = table.headers.map(norm);
  for (const key in map) {
    let ci = -1;
    for (const alias of map[key]) { ci = H.findIndex(h => h.includes(alias)); if (ci >= 0) break; }
    if (ci < 0) continue;
    const vals = [];
    for (const r of table.rows) { const v = r[ci]; if (v != null && String(v).trim() !== '') vals.push(String(v).trim()); }
    out[key] = vals;
  }
  return out;
}

/* ============================== PARSE ALL ================================== */
function parseAll(transTable, expTable, settingsTable, now) {
  now = now || new Date();
  const tHeaders = (transTable && transTable.headers) || [];
  const tRows = (transTable && transTable.rows) || [];
  const col = detectColumns(tHeaders);
  const settings = parseSettings(settingsTable);
  const today = todayKeyDubai(now);

  const records = [];
  const audit = [];
  const skipped = { empty: 0, noDate: 0, badDate: 0 };
  const dupKeys = {};
  let missingAmounts = 0, brokenStatus = 0, futureDates = 0;
  const allowedPay = new Set(settings.paymentStatus.map(norm));
  // Settings protection (req #7): detect values NOT defined in the Settings sheet (never auto-create)
  const allowedLead = new Set(settings.leadSources.map(norm));
  const allowedSvc = new Set(settings.serviceTypes.map(norm));
  const allowedMethod = new Set(settings.paymentMethods.map(norm));
  const unknownValues = { leads: {}, services: {}, methods: {}, statuses: {} };
  const flagUnknown = (bucket, allowed, raw) => { const v = String(raw || '').trim(); if (v && allowed.size && !allowed.has(norm(v)) && !/^(other|returning)$/i.test(v) && !/google ads returning/i.test(v)) unknownValues[bucket][v] = (unknownValues[bucket][v] || 0) + 1; };

  for (let i = 0; i < tRows.length; i++) {
    const row = tRows[i];
    const sheetRow = i + 2; // 1-based incl header
    if (!row || !row.some(v => v !== null && v !== '' && v !== undefined)) { skipped.empty++; continue; }

    const rawDate = col.date >= 0 ? row[col.date] : null;
    const d = toDate(rawDate);
    if (rawDate == null || rawDate === '') { skipped.noDate++; audit.push(ev('warning', 'Missing date', `Row ${sheetRow}: transaction has no date — excluded from totals`)); continue; }
    if (!d) { skipped.badDate++; audit.push(ev('error', 'Invalid date', `Row ${sheetRow}: unreadable date "${rawDate}" — excluded`)); continue; }

    const amountRaw = col.amount >= 0 ? row[col.amount] : null;
    const amount = parseAmount(amountRaw);
    const rawPay = col.payment >= 0 ? row[col.payment] : '';
    const payment = normalizePayment(rawPay);
    const rawDel = col.delivery >= 0 ? row[col.delivery] : '';
    const delivery = normalizeDelivery(rawDel);
    const client = col.client >= 0 ? String(row[col.client] == null ? '' : row[col.client]).trim() : '';
    const service = (col.service >= 0 ? String(row[col.service] == null ? '' : row[col.service]).trim() : '') || 'Unspecified';
    const rawLeadStr = col.lead >= 0 ? String(row[col.lead] == null ? '' : row[col.lead]).trim() : '';
    const lead = rawLeadStr || 'Other';
    const method = (col.method >= 0 ? String(row[col.method] == null ? '' : row[col.method]).trim() : '') || 'Other';
    const phone = col.phone >= 0 ? String(row[col.phone] == null ? '' : row[col.phone]).trim() : '';
    const ref = col.ref >= 0 ? String(row[col.ref] == null ? '' : row[col.ref]).trim() : '';
    const notes = col.notes >= 0 ? String(row[col.notes] == null ? '' : row[col.notes]).trim() : '';

    // validation flags
    if (payment !== 'cancelled' && !hasAmount(amountRaw)) { missingAmounts++; audit.push(ev('warning', 'Missing amount', `Row ${sheetRow}: ${client || 'client'} (${payment}) has no amount`)); }
    if (allowedPay.size && rawPay && !allowedPay.has(norm(rawPay))) { brokenStatus++; audit.push(ev('warning', 'Unknown payment status', `Row ${sheetRow}: "${rawPay}" not in Settings list`)); flagUnknown('statuses', allowedPay, rawPay); }
    // req #10: only flag leads that resolve to NO known canonical category (true unknowns).
    const _rawLead = col.lead >= 0 ? row[col.lead] : '';
    if (aliasLead(_rawLead, allowedLead) === 'Other') { const lv = String(_rawLead || '').trim(); if (lv && !/^(other|returning)$/i.test(lv) && !/google ads returning/i.test(lv)) unknownValues.leads[lv] = (unknownValues.leads[lv] || 0) + 1; }
    flagUnknown('services', allowedSvc, col.service >= 0 ? row[col.service] : ''); flagUnknown('methods', allowedMethod, col.method >= 0 ? row[col.method] : '');
    if (dateKey(d) > today) { futureDates++; audit.push(ev('warning', 'Future date', `Row ${sheetRow}: date ${dateKey(d)} is in the future`)); }
    const dk = `${dateKey(d)}|${norm(client)}|${amount}|${norm(ref)}`;
    if (dupKeys[dk]) audit.push(ev('warning', 'Possible duplicate', `Row ${sheetRow}: same date+client+amount+ref as row ${dupKeys[dk]}`));
    else dupKeys[dk] = sheetRow;

    records.push({
      sheetRow, date: d, dateKey: dateKey(d), monthKey: monthKey(d),
      rawDateStr: rawDate instanceof Date ? rawDate.toDateString() : String(rawDate),
      ref, client, phone, service, amount,
      payment, rawPayment: String(rawPay || '').trim(),
      delivery, rawDelivery: String(rawDel || '').trim(),
      method, lead, leadTagged: !!rawLeadStr, notes, isGoogle: isGoogleLead(lead), isReturning: /return/i.test(lead),
    });
  }

  /* ---- auto Returning-client detection (req #6) ----
   * A client whose FIRST-ever order came via Google Ads, who later places ANOTHER order,
   * is flagged isReturning=true (acquisition source stays Google). This needs no manual
   * Lead-Source edit. It does NOT change revenue/orders/reconciliation — only the Google
   * funnel's new-vs-returning split reads isReturning. */
  const clientFirstSeen = {};
  for (const r of records) { if (!r.client) continue; const f = clientFirstSeen[r.client]; if (!f || r.dateKey < f.dateKey) clientFirstSeen[r.client] = { dateKey: r.dateKey, lead: r.lead, isGoogle: r.isGoogle }; }
  for (const r of records) { if (!r.client) continue; const f = clientFirstSeen[r.client]; if (f && f.isGoogle && r.dateKey > f.dateKey) r.isReturning = true; }

  /* ---- expenses ---- */
  const eHeaders = (expTable && expTable.headers) || [];
  const eRows = (expTable && expTable.rows) || [];
  let eDateCol = findCol(eHeaders, ['date', 'التاريخ']);
  const eAmtCol = findCol(eHeaders, ['amount (aed)', 'amount', 'aed', 'cost', 'total', 'value', 'المبلغ', 'التكلفة']);
  const eCatCol = findCol(eHeaders, ['category', 'type', 'description', 'item', 'expense', 'الفئة', 'البيان']);
  const eStatusCol = findCol(eHeaders, ['status', 'الحالة']);
  const eMethodCol = findCol(eHeaders, ['payment method', 'method', 'طريقة']);
  const expenses = [];
  for (let i = 0; i < eRows.length; i++) {
    const r = eRows[i];
    if (!r || !r.some(v => v !== null && v !== '' && v !== undefined)) continue;
    let amt = eAmtCol >= 0 ? parseAmount(r[eAmtCol]) : 0;
    if (amt === 0) for (let c2 = 0; c2 < r.length; c2++) { const a = parseAmount(r[c2]); if (a > 0) { amt = a; break; } }
    if (amt <= 0) continue;
    // expense date: header 'date' col, else first column if it parses as a date
    let ed = eDateCol >= 0 ? toDate(r[eDateCol]) : null;
    if (!ed) ed = toDate(r[0]);
    const cat = (eCatCol >= 0 ? String(r[eCatCol] == null ? '' : r[eCatCol]).trim() : '') || 'Uncategorised';
    const status = eStatusCol >= 0 ? String(r[eStatusCol] == null ? '' : r[eStatusCol]).trim() : '';
    const method = eMethodCol >= 0 ? String(r[eMethodCol] == null ? '' : r[eMethodCol]).trim() : '';
    expenses.push({
      date: ed, dateKey: ed ? dateKey(ed) : null, monthKey: ed ? monthKey(ed) : null,
      category: cat, amount: amt, status, method,
      isAdSpend: /google|ads|ادز|اعلان|إعلان/.test(norm(cat)),
    });
  }

  /* ---- meta + range ---- */
  const dks = records.map(r => r.dateKey).sort();
  const minDate = dks[0] || null, maxDate = dks[dks.length - 1] || null;
  // latest business day summary (independent of any filter) for Today/Yesterday empty states
  const latestRecs = records.filter(r => r.dateKey === maxDate && r.payment !== 'cancelled');
  const latest = {
    date: maxDate,
    revenue: round2(latestRecs.reduce((a, r) => a + r.amount, 0)),
    orders: latestRecs.length,
    paid: round2(latestRecs.filter(r => r.payment === 'paid').reduce((a, r) => a + r.amount, 0)),
  };
  const options = {
    services: uniq(records.map(r => r.service)),
    leads: uniq(records.map(r => r.lead)),
    statuses: uniq(records.map(r => r.rawPayment).filter(Boolean)),
    methods: uniq(records.map(r => r.method)),
    deliveries: uniq(records.map(r => r.rawDelivery).filter(Boolean)),
  };

  /* ---- audit summary (prepended) ---- */
  const summary = [];
  summary.push(ev('ok', 'Workbook loaded', `${records.length} valid transactions · ${expenses.length} expense rows · ${tRows.length} raw rows scanned`));
  if (skipped.empty) summary.push(ev('info', 'Blank rows skipped', `${skipped.empty} empty rows ignored`));
  if (skipped.noDate) summary.push(ev('warning', 'Rows without dates', `${skipped.noDate} rows excluded (no date)`));
  if (skipped.badDate) summary.push(ev('error', 'Unreadable dates', `${skipped.badDate} rows excluded (bad date)`));
  if (missingAmounts) summary.push(ev('warning', 'Missing amounts', `${missingAmounts} non-cancelled rows have no amount`));
  if (brokenStatus) summary.push(ev('warning', 'Statuses off-list', `${brokenStatus} rows use a payment status not in Settings`));

  const cancelled = records.filter(r => r.payment === 'cancelled');
  if (cancelled.length) summary.push(ev('info', 'Cancelled excluded', `${cancelled.length} cancelled order(s) (AED ${round2(cancelled.reduce((a, r) => a + r.amount, 0))}) removed from revenue & ROAS`));

  // reconciliation over ALL non-cancelled
  const nc = records.filter(r => r.payment !== 'cancelled');
  const totR = nc.reduce((a, r) => a + r.amount, 0);
  const paidR = nc.filter(r => r.payment === 'paid').reduce((a, r) => a + r.amount, 0);
  const outR = nc.filter(r => r.payment === 'outstanding' || r.payment === 'partial').reduce((a, r) => a + r.amount, 0);
  const gap = round2(totR - paidR - outR);
  if (Math.abs(gap) < 0.01) summary.push(ev('ok', 'Reconciliation passed', `Paid + Outstanding = Total Revenue (AED ${round2(totR)})`));
  else summary.push(ev('error', 'Reconciliation gap', `Total ${round2(totR)} ≠ Paid ${round2(paidR)} + Outstanding ${round2(outR)} (gap AED ${gap}). Caused by rows with a blank payment status.`));

  return {
    now, today, col, settings, records, expenses, clientFirstSeen,
    meta: { minDate, maxDate, latest, totalRecords: records.length, expenseRecords: expenses.length, rawRows: tRows.length, options,
            detectedColumns: Object.keys(col).reduce((o, k) => (o[k] = col[k] >= 0 ? `${tHeaders[col[k]]} [${col[k]}]` : 'NOT FOUND', o), {}) },
    audit: summary.concat(audit).slice(0, 200),
    validation: { reconciles: Math.abs(gap) < 0.01, gap, missingAmounts, brokenStatus, futureDates, skipped, cancelled: cancelled.length,
      unknownValues: Object.keys(unknownValues).reduce((o, b) => (o[b] = Object.keys(unknownValues[b]).map(v => ({ value: v, count: unknownValues[b][v] })), o), {}) },
  };
}

/* =============================== ANALYZE =================================== */
// filter: { from, to, service, lead }  (from/to inclusive yyyy-mm-dd; '' = open)
function analyze(parsed, filter) {
  filter = filter || {};
  const from = filter.from || parsed.meta.minDate || '0000-00-00';
  const to = filter.to || parsed.meta.maxDate || '9999-99-99';
  const svc = filter.service && filter.service !== 'All' ? filter.service : null;
  const lead = filter.lead && filter.lead !== 'All' ? filter.lead : null;

  // req #4/#10: canonical lead label (alias-aware). Defined up-front so the lead FILTER matches
  // the same canonical labels shown in charts/dropdowns (fixes filtering when the sheet uses
  // synonyms like "Our Client" while Settings says "Client").
  const _allowedLead = new Set((parsed.settings.leadSources || []).map(norm));
  const leadLabel = raw => aliasLead(raw, _allowedLead);

  const inRange = r => r.dateKey >= from && r.dateKey <= to
    && (!svc || r.service === svc) && (!lead || leadLabel(r.lead) === lead);
  const recs = parsed.records.filter(inRange);
  const nonCanc = recs.filter(r => r.payment !== 'cancelled');
  const exps = parsed.expenses.filter(e => !e.dateKey || (e.dateKey >= from && e.dateKey <= to));

  const K = blankKpis();
  const clientMap = {}, googleClients = {}, monthMap = {}, dayMap = {}, serviceMap = {}, leadMap = {}, methodMap = {}, deliveryMap = {};
  let cancRev = 0;

  for (const r of recs) {
    if (r.payment === 'cancelled') { K.cancelledOrders++; cancRev += r.amount; continue; }
    K.totalRevenue += r.amount; K.totalOrders++;
    let paidPart = 0, outPart = 0;
    if (r.payment === 'paid') { paidPart = r.amount; K.paidOrders++; }
    else if (r.payment === 'partial') { K.partialOrders++; K.pendingOrders++; outPart = r.amount; }
    else { outPart = r.amount; K.pendingOrders++; }
    K.paidRevenue += paidPart; K.outstanding += outPart;

    bump(monthMap, r.monthKey, r.amount);
    bump(dayMap, r.dateKey, r.amount);
    bumpRO(serviceMap, r.service, r.amount);
    bumpRO(leadMap, leadLabel(r.lead), r.amount); // req #2/#9: Settings sources kept; unknown ("Direct") -> "Other"
    methodMap[r.method] = (methodMap[r.method] || 0) + r.amount;
    deliveryMap[r.delivery] = (deliveryMap[r.delivery] || 0) + 1;

    if (r.client) {
      const c = clientMap[r.client] || (clientMap[r.client] = { client: r.client, revenue: 0, orders: 0, paid: 0, outstanding: 0, lastDate: '', firstDate: r.dateKey, lead: leadLabel(r.lead), acqLead: leadLabel(r.lead), phone: r.phone, months: {}, invoices: [] });
      c.revenue += r.amount; c.orders++; c.paid += paidPart; c.outstanding += outPart;
      c.months[r.monthKey] = (c.months[r.monthKey] || 0) + r.amount;
      if (r.dateKey > c.lastDate) { c.lastDate = r.dateKey; c.lead = leadLabel(r.lead); }
      if (r.dateKey < c.firstDate) { c.firstDate = r.dateKey; c.acqLead = leadLabel(r.lead); }
      if (outPart > 0) c.invoices.push({ date: r.dateKey, ref: r.ref, service: r.service, amount: round2(r.amount), status: r.payment });
    }
    if (r.isGoogle) { K.googleRevenue += r.amount; K.googleOrders++; if (r.client) googleClients[r.client] = true; }
  }

  K.totalClients = Object.keys(clientMap).length;
  K.googleClients = Object.keys(googleClients).length;
  K.avgOrderValue = K.totalOrders ? K.totalRevenue / K.totalOrders : 0;
  K.collectionRate = K.totalRevenue ? (K.paidRevenue / K.totalRevenue) * 100 : 0;
  K.totalExpenses = exps.reduce((a, e) => a + e.amount, 0);
  K.adSpend = exps.filter(e => e.isAdSpend).reduce((a, e) => a + e.amount, 0);
  K.netProfit = K.totalRevenue - K.totalExpenses;
  K.profitMargin = K.totalRevenue ? (K.netProfit / K.totalRevenue) * 100 : 0;
  K.googleRevenueShare = K.totalRevenue ? (K.googleRevenue / K.totalRevenue) * 100 : 0;
  K.googleClientShare = K.totalClients ? (K.googleClients / K.totalClients) * 100 : 0;
  K.roas = K.adSpend > 0 ? K.googleRevenue / K.adSpend : null;
  K.costPerOrder = (K.adSpend > 0 && K.googleOrders > 0) ? K.adSpend / K.googleOrders : null;
  K.netFromAds = K.googleRevenue - K.adSpend;

  // series
  const revenueTrend = Object.keys(monthMap).sort().map(k => {
    const [y, m] = k.split('-'); return { key: k, label: MONTHS[+m - 1] + ' ' + y.slice(2), revenue: round2(monthMap[k].revenue), orders: monthMap[k].orders };
  });
  // daily trend across the active window (cap to 60 buckets, zero-filled)
  const dailyTrend = buildDaily(from, to, dayMap, parsed.today);
  // monthly expense series (for the sidebar mini-chart)
  const expMonthMap = {}; exps.forEach(e => { if (e.monthKey) expMonthMap[e.monthKey] = (expMonthMap[e.monthKey] || 0) + e.amount; });
  const expenseTrend = Object.keys(expMonthMap).sort().map(k => { const [y, m] = k.split('-'); return { key: k, label: MONTHS[+m - 1] + ' ' + y.slice(2), expense: round2(expMonthMap[k]) }; });
  const topServices = toShareList(serviceMap, K.totalRevenue).slice(0, 8);
  const leadSources = toShareList(leadMap, K.totalRevenue);
  // payment methods bucketed to the allowed Settings set (Bank Transfer / Payment Link / Cash / Other)
  const methodBuckets = { 'Bank Transfer': 0, 'Payment Link': 0, 'Cash': 0, 'Other': 0 };
  for (const n in methodMap) methodBuckets[methodBucket(n)] += methodMap[n];
  const paymentMethods = Object.keys(methodBuckets).map(n => ({ name: n, value: round2(methodBuckets[n]) })).filter(m => m.value > 0).sort((a, b) => b.value - a.value);
  const deliveryBreakdown = Object.keys(deliveryMap).map(n => ({ name: titm(n), count: deliveryMap[n] })).sort((a, b) => b.count - a.count);
  const paymentSummary = [
    { name: 'Paid', amount: round2(K.paidRevenue), orders: K.paidOrders },
    { name: 'Outstanding', amount: round2(K.outstanding), orders: K.pendingOrders },
    { name: 'Cancelled (excluded)', amount: round2(cancRev), orders: K.cancelledOrders },
  ];

  // tables
  const sortByDateDesc = (a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : b.amount - a.amount);
  const recentTransactions = nonCanc.slice().sort(sortByDateDesc).slice(0, 60).map(slim);
  const outstandingOrders = nonCanc.filter(r => r.payment === 'outstanding' || r.payment === 'partial')
    .sort((a, b) => b.amount - a.amount).map(slim);
  const googleAdsLeads = nonCanc.filter(r => r.isGoogle).sort(sortByDateDesc).slice(0, 50).map(slim);
  const pendingDeliveries = recs.filter(r => r.delivery === 'pending' || r.delivery === 'in progress')
    .sort(sortByDateDesc).map(slim);
  const maxDate2 = parsed.meta.maxDate;
  const daysBetween = (a, b) => (a && b) ? Math.round((toDate(b) - toDate(a)) / 86400000) : 0;
  const topClients = Object.values(clientMap).map(c => {
    const daysSince = daysBetween(c.lastDate, maxDate2);
    const status = c.outstanding > 0 ? (daysSince > 30 ? 'At risk' : 'Owes') : (daysSince > 45 ? 'Dormant' : 'Active');
    const trend = Object.keys(c.months).sort().slice(-6).map(mk => { const [y, m] = mk.split('-'); return { label: MONTHS[+m - 1], revenue: round2(c.months[mk]) }; });
    return {
      client: c.client, revenue: round2(c.revenue), orders: c.orders, paid: round2(c.paid),
      outstanding: round2(c.outstanding), lastDate: c.lastDate, firstDate: c.firstDate, lead: c.lead, acqLead: c.acqLead, phone: c.phone,
      repeat: c.orders > 1, aov: round2(c.orders ? c.revenue / c.orders : 0),
      ltv: round2(c.revenue), status, daysSince, invoiceCount: c.invoices.length,
      invoices: c.invoices.sort((a, b) => b.amount - a.amount).slice(0, 12), trend,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // period-over-period comparison (real data only) — same length window immediately before `from`
  const compare = buildCompare(parsed, from, to, svc, lead, _allowedLead);

  /* ===================== EXECUTIVE ANALYTICS (UI only — no totals changed) ===================== */
  // per-day stats from real per-day data
  const dayEntries = Object.keys(dayMap).map(k => ({ date: k, revenue: round2(dayMap[k].revenue), orders: dayMap[k].orders })).sort((a, b) => b.revenue - a.revenue);
  const activeDays = dayEntries.length || 1;
  const dayStats = {
    bestDay: dayEntries[0] || null,
    worstDay: dayEntries.length ? dayEntries[dayEntries.length - 1] : null,
    avgRevenuePerDay: round2(K.totalRevenue / activeDays),
    avgOrdersPerDay: round1(K.totalOrders / activeDays),
    activeDays,
  };

  // GOOGLE ADS executive block
  const gRecs = nonCanc.filter(r => r.isGoogle);
  const gByDay = {}; gRecs.forEach(r => { (gByDay[r.dateKey] = gByDay[r.dateKey] || { revenue: 0, orders: 0 }); gByDay[r.dateKey].revenue += r.amount; gByDay[r.dateKey].orders++; });
  const gSpendByDay = {}; exps.filter(e => e.isAdSpend && e.dateKey).forEach(e => gSpendByDay[e.dateKey] = (gSpendByDay[e.dateKey] || 0) + e.amount);
  const gSpendByMonth = {}; exps.filter(e => e.isAdSpend && e.monthKey).forEach(e => gSpendByMonth[e.monthKey] = (gSpendByMonth[e.monthKey] || 0) + e.amount);
  const gMonth = {}; gRecs.forEach(r => { (gMonth[r.monthKey] = gMonth[r.monthKey] || { revenue: 0, orders: 0 }); gMonth[r.monthKey].revenue += r.amount; gMonth[r.monthKey].orders++; });
  const gRoasTrend = Object.keys(gMonth).sort().map(k => { const [y, m] = k.split('-'); const sp = gSpendByMonth[k] || 0; return { label: MONTHS[+m - 1] + ' ' + y.slice(2), revenue: round2(gMonth[k].revenue), spend: round2(sp), roas: sp > 0 ? round2(gMonth[k].revenue / sp) : null, orders: gMonth[k].orders }; });
  const gDayList = Object.keys(gByDay).map(k => ({ date: k, revenue: round2(gByDay[k].revenue), orders: gByDay[k].orders, spend: round2(gSpendByDay[k] || 0), roas: gSpendByDay[k] > 0 ? round2(gByDay[k].revenue / gSpendByDay[k]) : null }));
  const gAOV = K.googleOrders ? K.googleRevenue / K.googleOrders : 0;
  const gPaid = gRecs.filter(r => r.payment === 'paid').reduce((a, r) => a + r.amount, 0);
  const gConv = gRecs.length ? gRecs.filter(r => r.payment === 'paid').length / gRecs.length * 100 : 0;
  // NEW vs RETURNING Google Ads attribution (req #1) — returning still counts as Google-acquired
  const gNewR = gRecs.filter(r => !r.isReturning), gRetR = gRecs.filter(r => r.isReturning);
  const sumAmt = arr => round2(arr.reduce((a, r) => a + r.amount, 0));
  const distinct = arr => new Set(arr.filter(r => r.client).map(r => r.client)).size;
  const gNewRev = sumAmt(gNewR), gRetRev = sumAmt(gRetR);
  const returningRatio = K.googleRevenue > 0 ? round1(gRetRev / K.googleRevenue * 100) : 0;
  // GOOGLE ADS FUNNEL (req #8) — full google set incl cancelled
  const gAll = recs.filter(r => r.isGoogle);
  const fstage = (label, n) => ({ label, count: n, pct: gAll.length ? round1(n / gAll.length * 100) : 0 });
  const gFunnel = [
    fstage('Google Ads Orders', gAll.length),
    fstage('Paid Orders', gAll.filter(r => r.payment === 'paid').length),
    fstage('Delivered Orders', gAll.filter(r => r.delivery === 'delivered').length),
    fstage('Returning Orders', gAll.filter(r => r.isReturning).length),
    fstage('Outstanding Orders', gAll.filter(r => r.payment === 'outstanding' || r.payment === 'partial').length),
    fstage('Cancelled Orders', gAll.filter(r => r.payment === 'cancelled').length),
  ];
  for (let i = 1; i < gFunnel.length; i++) gFunnel[i].conv = gFunnel[i - 1].count ? round1(gFunnel[i].count / gFunnel[i - 1].count * 100) : 0;
  // executive score /100: ROAS (45) + CPA (25) + conversion (30)
  let gScore = 0;
  if (K.roas != null) gScore += Math.max(0, Math.min(45, (K.roas / 4) * 45));
  if (K.costPerOrder != null) gScore += Math.max(0, Math.min(25, (1 - Math.min(1, K.costPerOrder / 150)) * 25)); else gScore += 12;
  gScore += Math.max(0, Math.min(30, gConv / 100 * 30));
  const googleAds = {
    revenue: round2(K.googleRevenue), orders: K.googleOrders, spend: round2(K.adSpend),
    roas: K.roas, cpa: K.costPerOrder, netFromAds: round2(K.netFromAds), revenueShare: round1(K.googleRevenueShare),
    aov: round2(gAOV), paidRevenue: round2(gPaid), conversionRate: round1(gConv),
    profitAfterAdSpend: round2(K.googleRevenue - K.adSpend),
    score: Math.round(gScore),
    newClients: distinct(gNewR), returningClients: distinct(gRetR),
    newRevenue: gNewRev, returningRevenue: gRetRev, newOrders: gNewR.length, returningOrders: gRetR.length,
    returningRevenueRatio: returningRatio, funnel: gFunnel,
    byService: aggList(gRecs, 'service'), byStatus: aggList(gRecs, 'payment'), byDelivery: aggList(gRecs, 'delivery'),
    topClients: topAgg(gRecs, 'client', 8), topServices: topAgg(gRecs, 'service', 8),
    bestDays: gDayList.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    worstDays: gDayList.slice().filter(d => d.revenue > 0).sort((a, b) => a.revenue - b.revenue).slice(0, 8),
    highestRoasDays: gDayList.filter(d => d.roas != null).sort((a, b) => b.roas - a.roas).slice(0, 8),
    highestSpendDays: gDayList.filter(d => d.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 8),
    roasTrend: gRoasTrend, dayList: gDayList.sort((a, b) => (a.date < b.date ? -1 : 1)),
  };

  // EXECUTIVE INSIGHTS (current calendar periods + leaders)
  const t = parsed.today; const tD = toDate(t);
  const wkFrom = tD ? dateKey(new Date(tD.getTime() - 6 * 86400000)) : t;
  const monthFrom = t.slice(0, 7) + '-01';
  const insights = {
    topSource: leadSources[0] || null,
    topService: topServices[0] || null,
    largestPaidClient: topClients.slice().sort((a, b) => b.paid - a.paid)[0] || null,
    largestUnpaidClient: topClients.slice().sort((a, b) => b.outstanding - a.outstanding)[0] || null,
    collectionRate: round1(K.collectionRate), avgOrderValue: round2(K.avgOrderValue),
    revenueToday: round2(windowAgg(parsed, t, t).revenue),
    revenueWeek: round2(windowAgg(parsed, wkFrom, t).revenue),
    revenueMonth: round2(windowAgg(parsed, monthFrom, t).revenue),
    topGrowthCategory: compare.hasPrev && compare.revenue != null ? { name: leadSources[0] ? leadSources[0].name : '—', growth: compare.revenue } : null,
  };

  // FORECASTS (run-rate, real data)
  const maxD = parsed.meta.maxDate ? toDate(parsed.meta.maxDate) : tD;
  let forecasts = { monthEndRevenue: null, monthToDate: 0, collect7: 0, collect30: 0, basis: '' };
  if (parsed.meta.maxDate) {
    const mFrom = parsed.meta.maxDate.slice(0, 7) + '-01';
    const mtd = windowAgg(parsed, mFrom, parsed.meta.maxDate).revenue;
    const dayOfMonth = maxD.getDate();
    const daysInMonth = new Date(maxD.getFullYear(), maxD.getMonth() + 1, 0).getDate();
    forecasts.monthToDate = round2(mtd);
    forecasts.monthEndRevenue = dayOfMonth > 0 ? round2(mtd / dayOfMonth * daysInMonth) : null;
    const avgDailyPaid = K.paidRevenue / activeDays;
    forecasts.collect7 = round2(Math.min(K.outstanding, avgDailyPaid * 7));
    forecasts.collect30 = round2(Math.min(K.outstanding, avgDailyPaid * 30));
    forecasts.basis = `run-rate from ${activeDays} active days · month-to-date ${MONTHS[maxD.getMonth()]} (${dayOfMonth}/${daysInMonth} days)`;
  }

  // OUTSTANDING RISK SCORING (age + amount)
  const riskList = nonCanc.filter(r => r.payment === 'outstanding' || r.payment === 'partial').map(r => {
    const age = maxD && r.date ? Math.round((maxD - r.date) / 86400000) : 0;
    let level = 'low';
    if (age > 30 || r.amount >= 1000) level = 'high';
    else if (age > 14 || r.amount >= 500) level = 'medium';
    return { date: r.dateKey, client: r.client, service: r.service, ref: r.ref, amount: round2(r.amount), ageDays: age, level };
  }).sort((a, b) => b.amount - a.amount);
  const risk = { low: 0, medium: 0, high: 0, lowAmt: 0, medAmt: 0, highAmt: 0, list: riskList.slice(0, 40) };
  riskList.forEach(r => { risk[r.level]++; risk[(r.level === 'low' ? 'lowAmt' : r.level === 'medium' ? 'medAmt' : 'highAmt')] += r.amount; });
  ['lowAmt', 'medAmt', 'highAmt'].forEach(k => risk[k] = round2(risk[k]));

  // DUPLICATE DETECTION (same date+client+amount+ref appearing more than once)
  const dupMap = {};
  nonCanc.forEach(r => { const key = `${r.dateKey}|${norm(r.client)}|${r.amount}|${norm(r.ref)}`; (dupMap[key] = dupMap[key] || []).push(r); });
  const duplicates = Object.values(dupMap).filter(g => g.length > 1).map(g => ({
    date: g[0].dateKey, client: g[0].client, ref: g[0].ref, amount: round2(g[0].amount), count: g.length, rows: g.map(x => x.sheetRow),
  })).sort((a, b) => b.amount - a.amount);

  // TOP OPPORTUNITIES CENTER (req #4)
  const owingClients = topClients.filter(c => c.outstanding > 0);
  const revMedian = topClients.length ? topClients[Math.floor(topClients.length / 2)].revenue : 0;
  const opportunities = {
    largestUnpaid: owingClients.slice().sort((a, b) => b.outstanding - a.outstanding).slice(0, 8),
    oldestUnpaid: riskList.slice().sort((a, b) => b.ageDays - a.ageDays).slice(0, 8),
    multipleInvoices: owingClients.filter(c => c.invoiceCount > 1).sort((a, b) => b.invoiceCount - a.invoiceCount).slice(0, 8),
    dormantHighValue: topClients.filter(c => c.daysSince > 30 && c.revenue >= revMedian && c.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    highestValueOutstanding: riskList.slice().sort((a, b) => b.amount - a.amount).slice(0, 8),
    largestCollection: owingClients.slice().sort((a, b) => b.outstanding - a.outstanding).slice(0, 8),
    totalOutstanding: round2(owingClients.reduce((a, c) => a + c.outstanding, 0)),
    clientsOwing: owingClients.length,
  };

  /* ===== EXECUTIVE PERIODIC MATRIX (req #1) — fixed calendar windows anchored to today
   * (Asia/Dubai), independent of the page filter. New clients = clients whose FIRST-ever
   * order is in the window; Google clients = those acquired via Google. No totals changed. */
  const cfs = parsed.clientFirstSeen || {};
  function periodAgg(pf, pt) {
    let revenue = 0, paid = 0, outst = 0;
    for (const r of parsed.records) {
      if (r.payment === 'cancelled' || r.dateKey < pf || r.dateKey > pt) continue;
      revenue += r.amount; if (r.payment === 'paid') paid += r.amount; else outst += r.amount;
    }
    let nc = 0, gc = 0;
    for (const cl in cfs) { const f = cfs[cl]; if (f.dateKey >= pf && f.dateKey <= pt) { nc++; if (f.isGoogle) gc++; } }
    return { revenue: round2(revenue), collections: round2(paid), outstanding: round2(outst), newClients: nc, googleClients: gc };
  }
  const _t = parsed.today, _tD = toDate(_t);
  const _yest = _tD ? dateKey(new Date(_tD.getTime() - 86400000)) : _t;
  const _wk = _tD ? dateKey(new Date(_tD.getTime() - 6 * 86400000)) : _t;
  const _mo = _t.slice(0, 7) + '-01';
  const periodic = {
    today: periodAgg(_t, _t), yesterday: periodAgg(_yest, _yest),
    week: periodAgg(_wk, _t), month: periodAgg(_mo, _t),
    highestRevenueDay: dayEntries[0] || null,
    lowestRevenueDay: dayEntries.length ? dayEntries[dayEntries.length - 1] : null,
  };

  /* ===== COLLECTION CENTER (req #7) — AR aging of outstanding/partial invoices by age
   * (days since order vs latest data date) + per-client rollup. View-only. ===== */
  const _refD = maxD || _tD;
  const _ageOf = r => (_refD && r.date) ? Math.round((_refD - r.date) / 86400000) : 0;
  const _outRecs = nonCanc.filter(r => r.payment === 'outstanding' || r.payment === 'partial');
  const _bk = { current: { count: 0, amount: 0 }, d8_30: { count: 0, amount: 0 }, d31_60: { count: 0, amount: 0 }, d61_90: { count: 0, amount: 0 }, d90p: { count: 0, amount: 0 } };
  const _cc = {};
  _outRecs.forEach(r => {
    const a = _ageOf(r); const b = a <= 7 ? 'current' : a <= 30 ? 'd8_30' : a <= 60 ? 'd31_60' : a <= 90 ? 'd61_90' : 'd90p';
    _bk[b].count++; _bk[b].amount += r.amount;
    const c = _cc[r.client] || (_cc[r.client] = { client: r.client || '—', outstanding: 0, oldestAge: 0, invoices: 0, lead: leadLabel(r.lead) });
    c.outstanding += r.amount; c.oldestAge = Math.max(c.oldestAge, a); c.invoices++;
  });
  const _bkLabel = { current: 'Current (≤7d)', d8_30: '8–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90p: 'Over 90 days' };
  const sumAge = (cmp) => round2(_outRecs.filter(r => cmp(_ageOf(r))).reduce((a, r) => a + r.amount, 0));
  const collection = {
    buckets: Object.keys(_bk).map(k => ({ key: k, label: _bkLabel[k], count: _bk[k].count, amount: round2(_bk[k].amount) })),
    dueToday: sumAge(a => a <= 0), dueWeek: sumAge(a => a <= 7), dueMonth: sumAge(a => a <= 30),
    over30: sumAge(a => a > 30), over60: sumAge(a => a > 60), over90: sumAge(a => a > 90),
    clients: Object.values(_cc).map(c => ({ client: c.client, outstanding: round2(c.outstanding), oldestAge: c.oldestAge, invoices: c.invoices, lead: c.lead })).sort((a, b) => b.outstanding - a.outstanding),
    totalOutstanding: round2(_outRecs.reduce((a, r) => a + r.amount, 0)), clientsOwing: Object.keys(_cc).length,
  };

  /* ===== EXECUTIVE SUMMARY (req #1) — today snapshot (Asia/Dubai) + month leaders + forecast/risk.
   * View-only; reads the same records, changes no totals/reconciliation. ===== */
  const _cfs = parsed.clientFirstSeen || {};
  function daySnap(pf, pt) {
    let revenue = 0, paid = 0, outst = 0, orders = 0, gRev = 0, gOrd = 0, highest = 0; const seen = new Set();
    for (const r of parsed.records) {
      if (r.payment === 'cancelled' || r.dateKey < pf || r.dateKey > pt) continue;
      revenue += r.amount; orders++;
      if (r.payment === 'paid') paid += r.amount; else outst += r.amount;
      if (r.amount > highest) highest = r.amount;
      if (r.isGoogle) { gRev += r.amount; gOrd++; }
      if (r.client) seen.add(r.client);
    }
    let newC = 0, retC = 0;
    for (const cl of seen) { const f = _cfs[cl]; if (f && f.dateKey >= pf && f.dateKey <= pt) newC++; else retC++; }
    return { revenue: round2(revenue), collections: round2(paid), outstanding: round2(outst), orders, googleRevenue: round2(gRev), googleOrders: gOrd, newClients: newC, returningClients: retC, highestOrder: round2(highest) };
  }
  const _moRecs = parsed.records.filter(r => r.payment !== 'cancelled' && r.dateKey >= _mo && r.dateKey <= _t);
  const _moSvc = {}, _moLead = {};
  _moRecs.forEach(r => { _moSvc[r.service] = (_moSvc[r.service] || 0) + r.amount; const ll = leadLabel(r.lead); _moLead[ll] = (_moLead[ll] || 0) + r.amount; });
  const _topOf = m => { const k = Object.keys(m).sort((a, b) => m[b] - m[a])[0]; return k ? { name: k, revenue: round2(m[k]) } : null; };
  // outstanding risk score 0-100 (higher = riskier): weighted by 90+ / 60+ share of AR + AR ratio
  const _riskScore = (() => {
    const out = K.outstanding || 0; if (out <= 0) return 0;
    const w90 = (collection.over90 || 0) / out, w60 = (collection.over60 || 0) / out;
    const ratio = K.totalRevenue ? K.outstanding / K.totalRevenue : 0;
    return Math.max(0, Math.min(100, Math.round(w90 * 55 + w60 * 25 + Math.min(1, ratio) * 20)));
  })();
  const execSummary = {
    today: daySnap(_t, _t),
    largestPaidClient: insights.largestPaidClient, largestUnpaidClient: insights.largestUnpaidClient,
    bestServiceMonth: _topOf(_moSvc), bestLeadMonth: _topOf(_moLead),
    collectionForecast: forecasts.collect30, revenueForecast: forecasts.monthEndRevenue,
    outstandingRiskScore: _riskScore,
  };

  /* ===== NET PROFIT EXPENSE-COVERAGE GUARDRAIL (display-only — does NOT change K.netProfit) =====
   * The dashboard sums dated expenses for the range (no per-day pro-rata of monthly fixed costs),
   * so a confident Net Profit is only shown for whole-month / All-Time ranges whose active months
   * all have expense data. Otherwise the UI shows "—" + the reason (never a misleading number). */
  const _revMonths = new Set(nonCanc.map(r => r.monthKey));
  const _expMonths = new Set(exps.filter(e => e.monthKey).map(e => e.monthKey));
  let _coveredM = 0; _revMonths.forEach(m => { if (_expMonths.has(m)) _coveredM++; });
  const _hasExp = K.totalExpenses > 0;
  const _isAllTime = !filter.from && !filter.to;            // no explicit dates => spans all recorded months
  const _monthAligned = (() => {
    if (_isAllTime) return true;                            // All Time always spans whole months — no pro-rating
    if (!from || !to) return false;
    if (String(from).slice(8) !== '01') return false;       // must START on day 01 (whole-month range)
    const [ty, tm] = String(to).split('-'); const lastDay = new Date(+ty, +tm, 0).getDate();
    const endsMonth = (+String(to).slice(8) === lastDay);   // ends on a calendar month-end
    // ...or runs through the latest available data / today (month-to-date) — robust when the
    // sheet's last row lags the clock (e.g. data ends 17th but "today" is the 18th).
    const throughLatest = (to >= (parsed.meta.maxDate || '0')) || (to >= parsed.today);
    return endsMonth || throughLatest;
  })();
  const _allCovered = _revMonths.size > 0 && _coveredM === _revMonths.size;
  /* Trigger rule: Net Profit is reliable for any MONTH-ALIGNED range (All Time, This/Last Month,
   * This Year, month-to-date) because we sum REAL recorded expenses — no per-day pro-rating needed.
   * It is only suppressed for sub-month ranges (Last 7 Days, Today, mid-month custom) where a fixed
   * monthly cost would have to be split across days. Per-month expense gaps (_allCovered) are kept as
   * an INFORMATIONAL signal for System Health, NOT a blocker — they don't require pro-rating. */
  const profitCoverage = {
    reliable: _hasExp && _monthAligned,
    hasExpenses: _hasExp, monthAligned: _monthAligned, allMonthsHaveExpenses: _allCovered,
    activeMonths: _revMonths.size, coveredMonths: _coveredM, recordedExpenses: round2(K.totalExpenses),
    reason: !_hasExp ? 'No expenses recorded for this period'
      : !_monthAligned ? 'Whole-month / All-Time ranges only — monthly costs can’t be split per day'
        : '',
  };

  /* ===== GOOGLE ADS ATTRIBUTION COMPLETENESS — untagged Lead Source orders can't be split ===== */
  const _untagged = nonCanc.filter(r => !r.leadTagged).length;
  const attribution = { untaggedOrders: _untagged, totalOrders: nonCanc.length, complete: _untagged === 0, taggedShare: nonCanc.length ? round1((nonCanc.length - _untagged) / nonCanc.length * 100) : 100 };

  /* ===== OFFICE PAYMENTS (derived, read-only) — outgoing office expenses from the Expenses tab.
   * Presentational rollup of parsed.expenses (already parsed + filtered for the range). Does NOT
   * change any KPI, revenue, paid/outstanding, net profit, or reconciliation. ===== */
  const _opByCat = {}, _opByMethod = {}, _opByMonth = {};
  exps.forEach(e => {
    const _c = e.category || 'Uncategorised'; _opByCat[_c] = (_opByCat[_c] || 0) + e.amount;
    const _m = e.method || 'Other'; _opByMethod[_m] = (_opByMethod[_m] || 0) + e.amount;
    if (e.monthKey) _opByMonth[e.monthKey] = (_opByMonth[e.monthKey] || 0) + e.amount;
  });
  const _opTotal = round2(exps.reduce((a, e) => a + e.amount, 0));
  const officePayments = {
    total: _opTotal, count: exps.length,
    byCategory: Object.keys(_opByCat).map(nm => ({ name: nm, amount: round2(_opByCat[nm]), share: _opTotal ? round1(_opByCat[nm] / _opTotal * 100) : 0 })).sort((a, b) => b.amount - a.amount),
    byMethod: Object.keys(_opByMethod).map(nm => ({ name: nm, amount: round2(_opByMethod[nm]) })).sort((a, b) => b.amount - a.amount),
    monthlyTrend: Object.keys(_opByMonth).sort().map(k => { const [y, m] = k.split('-'); return { key: k, label: MONTHS[+m - 1] + ' ' + y.slice(2), amount: round2(_opByMonth[k]) }; }),
    recent: exps.slice().sort((a, b) => (String(a.dateKey) < String(b.dateKey) ? 1 : String(a.dateKey) > String(b.dateKey) ? -1 : 0)).slice(0, 30).map(e => ({ date: e.dateKey || '—', category: e.category, amount: round2(e.amount), method: e.method, status: e.status })),
  };

  roundK(K);
  const reconciles = Math.abs((K.paidRevenue + K.outstanding) - K.totalRevenue) < 0.01;

  // date/filter diagnostics
  const inRangeKeys = recs.map(r => r.dateKey).sort();
  const diag = {
    dataMinDate: parsed.meta.minDate, dataMaxDate: parsed.meta.maxDate,
    selectedFrom: from, selectedTo: to,
    txnsInRange: recs.length, nonCancelledInRange: nonCanc.length, expensesInRange: exps.length,
    firstInRange: inRangeKeys[0] || null, lastInRange: inRangeKeys[inRangeKeys.length - 1] || null,
    isEmpty: recs.length === 0, today: parsed.today,
  };
  // date debug sample (raw -> parsed -> normalized -> matched), spread across the data
  const step = Math.max(1, Math.ceil(parsed.records.length / 18));
  const dateDebug = parsed.records.filter((_, i) => i % step === 0).slice(0, 18).map(r => ({
    sheetRow: r.sheetRow, raw: r.rawDateStr, parsed: r.date.toISOString(), normalized: r.dateKey,
    matched: r.dateKey >= from && r.dateKey <= to && (!svc || r.service === svc) && (!lead || r.lead === lead),
  }));

  return {
    filter: { from, to, service: svc || 'All', lead: lead || 'All' },
    diag, dateDebug, compare,
    kpis: K,
    rangeSummary: { revenue: K.totalRevenue, orders: K.totalOrders, paid: K.paidRevenue, outstanding: K.outstanding, googleRevenue: K.googleRevenue, googleOrders: K.googleOrders, newClients: K.totalClients },
    revenueTrend, dailyTrend, expenseTrend, topServices, leadSources, paymentSummary, paymentMethods, deliveryBreakdown,
    recentTransactions, outstandingOrders, googleAdsLeads, pendingDeliveries, topClients,
    expensesList: exps.map(e => ({ date: e.dateKey, category: e.category, amount: round2(e.amount), status: e.status, method: e.method })).sort((a, b) => (a.date < b.date ? 1 : -1)),
    reconciliation: { total: K.totalRevenue, paidPlusOutstanding: round2(K.paidRevenue + K.outstanding), reconciles },
    dayStats, googleAds, insights, forecasts, risk, duplicates, opportunities,
    periodic, collection, execSummary, profitCoverage, attribution, officePayments,
    settings: parsed.settings,
  };
}

/* -------------------------------- helpers ---------------------------------- */
// Aggregate headline figures over an arbitrary [from,to] window with the same facet filter.
function windowAgg(parsed, from, to, svc, lead, allowed) {
  let revenue = 0, paid = 0, outstanding = 0, expenses = 0, orders = 0;
  for (const r of parsed.records) {
    if (r.payment === 'cancelled') continue;
    if (r.dateKey < from || r.dateKey > to) continue;
    if (svc && r.service !== svc) continue;
    if (lead && aliasLead(r.lead, allowed) !== lead) continue;
    revenue += r.amount; orders++;
    if (r.payment === 'paid') paid += r.amount; else outstanding += r.amount;
  }
  for (const e of parsed.expenses) { if (e.dateKey && e.dateKey >= from && e.dateKey <= to) expenses += e.amount; }
  return { revenue, paid, outstanding, expenses, netProfit: revenue - expenses, orders };
}
// Compare the selected window to the equal-length window immediately before it.
function buildCompare(parsed, from, to, svc, lead, allowed) {
  const dFrom = toDate(from), dTo = toDate(to);
  if (!dFrom || !dTo) return { hasPrev: false };
  const lenDays = Math.round((dTo - dFrom) / 86400000) + 1;
  const prevTo = new Date(dFrom.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * 86400000);
  const pFrom = dateKey(prevFrom), pTo = dateKey(prevTo);
  const cur = windowAgg(parsed, from, to, svc, lead, allowed);
  const prev = windowAgg(parsed, pFrom, pTo, svc, lead, allowed);
  const pct = (c, p) => (p > 0 ? round1(((c - p) / p) * 100) : null);
  return {
    hasPrev: prev.orders > 0, prevFrom: pFrom, prevTo: pTo,
    revenue: pct(cur.revenue, prev.revenue), paid: pct(cur.paid, prev.paid),
    outstanding: pct(cur.outstanding, prev.outstanding), netProfit: pct(cur.netProfit, prev.netProfit),
    orders: pct(cur.orders, prev.orders),
  };
}
function ev(status, event, details) { return { ts: new Date().toISOString(), status, event, details }; }
function uniq(a) { return [...new Set(a.filter(Boolean))].sort(); }
function bump(map, k, amt) { (map[k] = map[k] || { revenue: 0, orders: 0 }).revenue += amt; map[k].orders++; }
function bumpRO(map, k, amt) { (map[k] = map[k] || { revenue: 0, orders: 0 }).revenue += amt; map[k].orders++; }
function toShareList(map, total) {
  return Object.keys(map).map(n => ({ name: n, revenue: round2(map[n].revenue), orders: map[n].orders, share: total ? (map[n].revenue / total) * 100 : 0 })).sort((a, b) => b.revenue - a.revenue);
}
// collapse any payment method into the 4 allowed Settings buckets
function methodBucket(raw) {
  const s = norm(raw);
  if (/bank|transfer|iban|swift|حوال/.test(s)) return 'Bank Transfer';
  if (/link|payment link|stripe|online|tabby|tamara|card|رابط/.test(s)) return 'Payment Link';
  if (/cash|نقد/.test(s)) return 'Cash';
  return 'Other';
}
// aggregate records by a field → [{name, revenue, orders, share}]
function aggList(records, field) {
  const m = {}; let tot = 0;
  records.forEach(r => { const k = titm(String(r[field] || 'Other')); (m[k] = m[k] || { revenue: 0, orders: 0 }); m[k].revenue += r.amount; m[k].orders++; tot += r.amount; });
  return Object.keys(m).map(n => ({ name: n, revenue: round2(m[n].revenue), orders: m[n].orders, share: tot ? round1(m[n].revenue / tot * 100) : 0 })).sort((a, b) => b.revenue - a.revenue);
}
function topAgg(records, field, n) { return aggList(records, field).slice(0, n); }
function titm(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
function slim(r) { return { date: r.dateKey, client: r.client, service: r.service, ref: r.ref, amount: round2(r.amount), method: r.method, status: r.payment, delivery: r.delivery, lead: r.lead }; }
function buildDaily(from, to, dayMap, today) {
  const start = toDate(from) || toDate(today), end = toDate(to) || toDate(today);
  if (!start || !end) return [];
  const out = []; const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 400) {
    const key = dateKey(cur);
    out.push({ key, label: cur.getDate() + ' ' + MONTHS[cur.getMonth()], revenue: round2(dayMap[key] ? dayMap[key].revenue : 0) });
    cur.setDate(cur.getDate() + 1); guard++;
  }
  // if window is huge, sample down to ~60 points by keeping last 60 days
  return out.length > 62 ? out.slice(-62) : out;
}
function blankKpis() {
  return { totalRevenue: 0, paidRevenue: 0, outstanding: 0, totalOrders: 0, paidOrders: 0, pendingOrders: 0,
    partialOrders: 0, cancelledOrders: 0, totalClients: 0, avgOrderValue: 0, collectionRate: 0,
    netProfit: 0, totalExpenses: 0, profitMargin: 0, adSpend: 0, googleRevenue: 0, googleOrders: 0,
    googleClients: 0, googleClientShare: 0, googleRevenueShare: 0, roas: null, costPerOrder: null, netFromAds: 0 };
}
function roundK(K) {
  ['totalRevenue','paidRevenue','outstanding','netProfit','totalExpenses','adSpend','googleRevenue','netFromAds','avgOrderValue'].forEach(k => K[k] = round2(K[k]));
  ['collectionRate','profitMargin','googleClientShare','googleRevenueShare'].forEach(k => K[k] = round1(K[k]));
  if (K.roas != null) K.roas = round2(K.roas);
  if (K.costPerOrder != null) K.costPerOrder = round2(K.costPerOrder);
}

module.exports = { parseAll, analyze, detectColumns, parseAmount, normalizePayment, normalizeDelivery, todayKeyDubai, TZ };
