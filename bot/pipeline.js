'use strict';
/* ============================================================================
 * ALMUTARJEM — Sales pipeline engine (carried-forward, confidence-based).
 * Pure functions, no I/O. Implements the approved audited business semantics:
 *  - Lead identity: valid reference, else phone + service + inquiry-month (never phone alone).
 *  - Latest-state per logical lead (history collapses to the newest row).
 *  - Outcome classes: WON / LOST / OPEN / NEEDS_REVIEW (Other/blank/contradiction).
 *  - Cross-sheet conversion confidence HIGH/MEDIUM/LOW; only HIGH auto-closes → WON_CONVERTED.
 *  - Age is an aging dimension ONLY — it never turns OPEN into LOST.
 *  - Note↔outcome contradiction (e.g. "found someone else" on a Price-Issue lead) → NEEDS_REVIEW.
 *  - Segments: ACTIVE OPEN (0–30) is the headline; STALE (31–45), STALE-REVIEW (46+),
 *    NEEDS_REVIEW, TODAY NEW, TODAY WON, and a HIGH-VALUE (≥AED 2,000) follow-up view.
 * Raw source data is never modified; this is the processing layer only.
 * ========================================================================== */

const p9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const nserv = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
const mkey = d => (d ? String(d).slice(0, 7) : '');
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

/* ---- outcome → base class (conservative; "Other"/blank/unknown → NEEDS_REVIEW) ---- */
function classifyOutcome(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (/\baccept|confirm|convert|\bwon\b|deal done/.test(o)) return 'WON';
  if (/cancel|not interest|declin|\blost\b|reject/.test(o)) return 'LOST';
  if (/no response|pending|price/.test(o)) return 'OPEN';
  return 'NEEDS_REVIEW';               // Other, blank, or any unrecognized state
}

/* ---- note↔outcome contradiction: a small, high-precision set of loss phrases ----
 * Only triggers when the outcome class is OPEN, so an unmaintained "Price Issue" whose
 * note plainly says the customer went elsewhere is routed to review, not counted active. */
const LOSS_PHRASES = /found\s+\w*\s*else|som\w*\s+else|went (elsewhere|to another|with)|no longer (need|require|interest)|used another|another (company|office|agency|place|shop)|got it done (elsewhere|somewhere)|chose another|proceeded with another/i;
function noteContradiction(baseClass, note) {
  return baseClass === 'OPEN' && LOSS_PHRASES.test(String(note || ''));
}

/* ---- logical lead identity ---- */
function logicalLeadKey(r) {
  const ref = String(r.ref || '').trim().toLowerCase();
  if (ref && ref !== '0') return 'R:' + ref;                 // reference is unambiguous when present
  return 'P:' + p9(r.phone) + '|' + nserv(r.service) + '|' + mkey(r.date); // else phone+service+month
}

/* ---- cross-sheet conversion confidence against paid/delivered Sherry jobs ---- */
function conversionConfidence(lead, sherryByPhone, reportDateKey) {
  const cand = (sherryByPhone[lead.phone] || []).filter(s => s.dk && s.dk <= reportDateKey && /deliver|collect|ready/.test(s.deliv));
  if (!cand.length) return { level: 'none' };
  for (const s of cand) {
    const sameRef = lead.ref && lead.ref !== '0' && s.ref && s.ref === lead.ref;
    const sameAmt = lead.amt > 0 && Math.abs(s.amt - lead.amt) < 0.01;
    const closeDate = Math.abs(days(s.dk, lead.last)) <= 14;
    if (sameRef || (sameAmt && closeDate)) return { level: 'HIGH', match: s };
  }
  for (const s of cand) {
    if (s.serv && s.serv === lead.serv && Math.abs(days(s.dk, lead.last)) <= 30) return { level: 'MEDIUM', match: s };
  }
  return { level: 'LOW' };              // phone-only — never auto-closes
}

const AGE_BUCKET = age => age <= 3 ? 'NEW' : age <= 7 ? 'FOLLOW_UP' : age <= 14 ? 'OVERDUE' : age <= 30 ? 'AGING' : age <= 45 ? 'STALE' : 'STALE_REVIEW';
const priorityRank = L => (L.class === 'OPEN' ? (L.age <= 30 ? 0 : L.age <= 45 ? 1 : 2) : 3); // active < stale < stale-review < review

/* ---- build the whole pipeline for a report date ---- */
function buildPipeline(rawanRows, sherryRows, reportDateKey, opts) {
  opts = opts || {};
  const HIGH_VALUE = opts.highValue != null ? opts.highValue : 2000;
  const sherryByPhone = {};
  (sherryRows || []).forEach(r => {
    const s = { dk: r.dateKey || r.date, ph: p9(r.phone), ref: String(r.ref || '').toLowerCase(), amt: num(r.amount), serv: nserv(r.service), deliv: String(r.fileStatus || r.delivery || '').toLowerCase() };
    (sherryByPhone[s.ph] || (sherryByPhone[s.ph] = [])).push(s);
  });

  // eligible = created on/before the report date (never future rows → historical recreation works)
  const eligible = (rawanRows || []).filter(r => r.date && r.date <= reportDateKey);
  const groups = {};
  eligible.forEach(r => { const k = logicalLeadKey(r); (groups[k] || (groups[k] = [])).push(r); });

  const leads = Object.entries(groups).map(([key, rs]) => {
    const s = rs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const L = s[s.length - 1];
    const lead = { key, phone: p9(L.phone), ref: String(L.ref || '').toLowerCase(), client: L.client || '—', amt: num(L.amount), outcome: L.outcome || '', serv: nserv(L.service), service: L.service || '', note: L.notes || '', leadSource: L.lead || L.leadSource || '', orig: s[0].date, last: L.date, age: days(reportDateKey, L.date), history: s.length };
    const base = classifyOutcome(lead.outcome);
    lead.conversion = conversionConfidence(lead, sherryByPhone, reportDateKey);
    lead.contradiction = noteContradiction(base, lead.note);
    if (lead.conversion.level === 'HIGH' && base !== 'LOST') lead.class = 'WON_CONVERTED';
    else if (base === 'LOST') lead.class = 'LOST';
    else if (base === 'WON') lead.class = 'WON';
    else if (lead.contradiction) { lead.class = 'NEEDS_REVIEW'; lead.flag = 'OUTCOME_CONTRADICTION'; }
    else if (base === 'OPEN') lead.class = 'OPEN';
    else lead.class = 'NEEDS_REVIEW';        // Other / blank / unknown
    if ((lead.conversion.level === 'MEDIUM' || lead.conversion.level === 'LOW') && (lead.class === 'OPEN' || lead.class === 'NEEDS_REVIEW')) lead.convFlag = lead.conversion.level;
    lead.highValue = lead.amt >= HIGH_VALUE;
    lead.ageBucket = AGE_BUCKET(lead.age);
    return lead;
  });

  const open = leads.filter(L => L.class === 'OPEN');
  const seg = {
    activeOpen: open.filter(L => L.age <= 30),
    staleOpen: open.filter(L => L.age >= 31 && L.age <= 45),
    staleReview: open.filter(L => L.age >= 46),
    staleOpenAll: open.filter(L => L.age > 30),
    needsReview: leads.filter(L => L.class === 'NEEDS_REVIEW'),
    todayNew: open.filter(L => L.last === reportDateKey),
    todayWon: leads.filter(L => (L.class === 'WON' || L.class === 'WON_CONVERTED') && (L.last === reportDateKey || (L.conversion.match && L.conversion.match.dk === reportDateKey))),
    highValue: leads.filter(L => L.highValue && (L.class === 'OPEN' || L.class === 'NEEDS_REVIEW')).sort((a, b) => priorityRank(a) - priorityRank(b) || b.amt - a.amt),
  };
  const sum = a => a.reduce((x, L) => x + L.amt, 0);
  const tot = {}; for (const k of Object.keys(seg)) tot[k] = { n: seg[k].length, aed: +sum(seg[k]).toFixed(2) };
  return {
    leads, segments: seg, totals: tot,
    counts: { leads: leads.length, converted: leads.filter(L => L.class === 'WON_CONVERTED').length, lost: leads.filter(L => L.class === 'LOST').length, won: leads.filter(L => L.class === 'WON').length, mediumFlags: leads.filter(L => L.convFlag === 'MEDIUM').length, lowFlags: leads.filter(L => L.convFlag === 'LOW').length, contradictions: leads.filter(L => L.flag === 'OUTCOME_CONTRADICTION').length },
  };
}

/* ---- source health state (caller sets sourceState from the fetch; STALE_DATA derived here) ---- */
function sourceHealth(loaded, rows, reportDateKey, maxStaleDays) {
  maxStaleDays = maxStaleDays != null ? maxStaleDays : 3;
  if (!loaded) return 'SOURCE_UNAVAILABLE';
  if (!rows || !rows.length) return 'EMPTY_VALID';
  const latest = rows.map(r => r.date).filter(Boolean).sort().pop();
  if (latest && days(reportDateKey, latest) > maxStaleDays) return 'STALE_DATA';
  return 'SOURCE_OK';
}

module.exports = { buildPipeline, classifyOutcome, logicalLeadKey, conversionConfidence, noteContradiction, sourceHealth, AGE_BUCKET, _p9: p9, _nserv: nserv };
