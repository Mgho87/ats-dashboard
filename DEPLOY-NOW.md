# Deploy to dashboard.mutarjem.ae — responsive-guardrails-final

Live host: **cPanel / LiteSpeed @ 77.95.113.181 (s828.lon1.mysecurecloudhost.com)**.
The live site currently runs an OLD build (no sidebar backdrop, no Net Profit guardrail,
no Google Ads attribution, System Health crashes). This deploys the fixed build.

## Changed files (5) — ALL required
| File | Why it must ship |
|------|------------------|
| `public/styles.css` | single ≤992px sidebar breakpoint + drawer backdrop |
| `public/index.html` | backdrop element + temporary build marker |
| `public/app.js` | backdrop close handler + System Health crash fix |
| `server.js` | sends `profitCoverage`/`attribution` (fixes All-Time Net Profit "—") |
| `lib/compute.js` | **computes** the guardrail + attribution (features fail without it) |

## Deployment package
`deploy-responsive-guardrails-final.zip` (in this folder). Contents preserve paths:
`public/styles.css`, `public/index.html`, `public/app.js`, `server.js`, `lib/compute.js`, `CHANGES.patch`.

---

## STEP 0 — Find the live application root (you said you're not sure)
1. Log in to **cPanel** (your MySecureCloudHost login).
2. Open **Setup Node.js App** (under "Software").
3. Find the app whose domain is `dashboard.mutarjem.ae`. Note these fields:
   - **Application root** ← this is the folder to upload into (e.g. `dashboard` or `ats-dashboard`).
   - **Application URL** = dashboard.mutarjem.ae
   - **Application startup file** = `server.js`
   - The **Restart** button (top of that app's panel).
   > If there is no Node.js app listed, the site may run via a different mechanism — stop and tell me; do not guess.

## STEP 1 — BACK UP FIRST (rollback safety)
1. cPanel → **File Manager** → go to the **Application root** from Step 0.
2. Select `server.js`, the `public` folder, and the `lib` folder → **Compress** → `zip` →
   name it `BACKUP-before-guardrails-YYYYMMDD.zip`. Download it to your PC.
   *(This is your one-click rollback.)*

## STEP 2 — Upload the new files
1. Unzip `deploy-responsive-guardrails-final.zip` on your PC (gives `public/`, `lib/`, `server.js`).
2. In File Manager, inside the **Application root**:
   - Upload `server.js` → overwrite the existing one.
   - Open `public/` → upload `app.js`, `index.html`, `styles.css` → overwrite.
   - Open `lib/` → upload `compute.js` → overwrite.
3. **Do NOT** touch `.env`, any credentials, `/var/data`, the audit log, or delete anything.
   Only replace the 5 matching files.

## STEP 3 — Restart the Node app
- cPanel → **Setup Node.js App** → your app → **Restart** (or **Stop** then **Start**).
  This regenerates the `?v=` asset version so browsers fetch the new files.

## STEP 4 — Verify the live site
1. Open **http://dashboard.mutarjem.ae/** and **hard refresh** (Ctrl+Shift+R).
2. Confirm in order:
   - **Footer** shows `Build: responsive-guardrails-final` ← proves new index.html is live.
   - View source: `app.js?v=` and `styles.css?v=` numbers **changed** (no longer 1781353180753).
   - **Company Totals / sidebar Net Profit** shows a real AED value at All Time (not "—").
   - Switch range to **Last 7 Days** → Net Profit shows **"—" / "Insufficient expense data"**.
   - Open **System Health** page → it loads (no blank/crash), shows coverage + attribution checks.
   - Open **Google Ads** page → "Attribution may be incomplete: N of M orders have no Lead Source tag".
   - Narrow the window < 992px (or open on iPad portrait) → hamburger appears, drawer slides in,
     tapping the dark backdrop closes it.

## STEP 5 — Remove the build marker (after you confirm)
Tell me once you've confirmed; I'll remove the `#buildMarker` span from `index.html`,
and you re-upload just that one file + restart.

---

## ALTERNATIVE — Git path (only if cPanel shows the app is connected to GitHub)
The fixed build is committed on branch **`responsive-guardrails-final`** (commit `fb6ed4d`).
⚠️ Caveat: local `main` (`1cf681e`) and GitHub `origin/main` (`8f57548`) have **diverged**, so a
plain push of main is not a clean fast-forward. Safe sequence:
```
cd ALMUTARJEM-NEW-DASHBOARD
git push origin responsive-guardrails-final      # push the branch (no force)
# then either open a PR to merge into main on GitHub, or fast-forward main locally after fetch:
#   git fetch origin && git checkout main && git merge --ff-only responsive-guardrails-final
```
On the server (cPanel Git Version Control or SSH), in the app root:
```
git pull
```
Then **Restart** the Node app (Step 3) and verify (Step 4).
> Don't use this path unless cPanel actually pulls from this repo — otherwise use the upload path above.

## ROLLBACK
If anything looks wrong after restart:
1. File Manager → Application root → upload/extract `BACKUP-before-guardrails-YYYYMMDD.zip`,
   overwriting the 5 files.
2. **Restart** the Node app.
3. Hard refresh — the footer build marker disappears = old build restored.
