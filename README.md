# ATS — Executive Control Center

A standalone, premium executive dashboard (dark navy + gold) for ATS Translation Services.
Node/Express backend + vanilla HTML/CSS/JS frontend. Reads business data from the **real
business workbook** (the Google Sheet saved into the project as `data/source.xlsx`). The live
Google Sheet is private, so the in-project Excel copy is the source of truth. **No demo, mock,
sample, or synthetic data exists in the codebase** — if no workbook is found the dashboard shows
an explicit "NO DATA SOURCE" state rather than fake numbers.

---

## 1. How to run (local)

```bash
cd ALMUTARJEM-NEW-DASHBOARD
node server.js          # or: npm start
```

Open http://localhost:5050

The top bar shows the active data source:

| Pill | Meaning |
|------|---------|
| 🟢 **REAL DATA MODE — Excel source loaded** | Reading the in-project workbook (`data/source.xlsx`) |
| 🔴 **NO DATA SOURCE** | No workbook found in `data/` |

It auto-refreshes every 60s and has a manual refresh button (⟳). The **System Health** and
**Audit Log** pages report exactly which source is live, row counts, validation, and warnings.

---

## 2. Data source

Priority order (`lib/excel.js`):

1. `data/source.xlsx` — the canonical copy of the ATS Business Control Sheet (multi-tab workbook).
2. `ALMUTARJEM Business Control Sheet.xlsx` in the project root (fallback).
3. Legacy single-file uploads (`data/transactions.xlsx`, `data/expenses.xlsx`).

To update the data: replace `data/source.xlsx` (or use **Settings → Replace Workbook** in the UI).

**Live Google Sheet:** `SPREADSHEET_ID` in `.env` is probed only for status reporting. It is
currently **private** (gviz/export return HTTP 401). To read it live instead of the copy, share it
**Anyone with the link → Viewer**; otherwise the in-project copy is used.

---

## 3. Workbook tabs & columns (detected dynamically, EN/AR supported)

**Transactions** — Date · Refrence Number (file/doc name) · Company or Client Name · Phone Number ·
Service Type · Amount (AED) · Payment Status · Delivery Status · Payment Method · Lead Source · Notes.

**Expenses** — Date · Category (e.g. "Google Ads") · Amount (AED) · Status · Payment Method · Priority · Notes.

**Settings** — enumeration lists (Lead Sources, Payment Status, Delivery Status, Payment Methods,
Expense Categories, Service Types) used for data-validation.

### Business rules applied
- **Cancelled / Refunded** rows are excluded from revenue, orders, Google Ads, and ROAS.
- **Paid Revenue** counts only Payment Status = Paid (`Unpaid`/`Not Paid` never count as Paid).
- **Outstanding** = everything non-cancelled that is not Paid (Outstanding/Pending/Partial/blank).
- **Total Revenue reconciles** to Paid + Outstanding (gaps are flagged in the Audit Log).
- Amounts parse `158`, `158.00`, `AED 158.00`, `1,580.00`, spaced text, Arabic-Indic digits.
- Excel serial dates are snapped to the correct calendar day; all buckets use **Asia/Dubai** time.

---

## 4. Pages

Overview · Money · Pipeline · Operations · Clients · Google Ads · Reports (CSV/Excel/PDF) ·
Audit Log (validation + reconciliation + change log) · **System Health** (trust verdict) · Settings.

Sticky filter bar: presets (Today / Yesterday / Last 7 / Last 30 / This Month / Last Month / All)
+ custom date range + service/lead filters. Every KPI, chart, and table re-computes on change.

---

## 5. API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/data?from&to&service&lead` | KPIs / charts / tables for the filter + meta + audit + validation |
| `GET /api/export?from&to&service&lead` | Filtered transactions as CSV |
| `POST /api/upload?type=source` | Replace the source workbook |
| `GET /api/health` | Liveness check |

---

## 6. Project structure

```
server.js          Express app + source resolution (file workbook, no demo)
lib/excel.js       Multi-tab workbook reader (+ Excel date-shift fix)
lib/compute.js     parseAll() + analyze() — all KPI / analytics / validation
lib/sheets.js      Google Sheets gviz reader (used only for live-status probe)
public/            Frontend (index.html, styles.css, app.js)
data/source.xlsx   The real business workbook (source of truth)
```
