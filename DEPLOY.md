# Permanent Deployment — ATS / ALMUTARJEM Executive Control Center

Goal: a permanent, company-grade URL (e.g. **https://dashboard.mutarjem.ae**) that stays
up and unchanged regardless of any PC being on/off, internet at the office, or app updates.

## Recommended method: Render (always-on Web Service)

Why Render (vs the others):
- **Vercel** — serverless/ephemeral filesystem + no long-running process; it would reset the
  forensic audit log and can't run the 60-second auto-sync loop. Not suitable for this app.
- **Cloudflare Tunnel on the office PC** — gives a permanent URL but the dashboard is DOWN
  whenever that PC is off or offline. Fails the "survives PC restart / internet disconnect" rule.
- **Railway** — works well too (equivalent steps); Render chosen for the simplest always-on +
  persistent-disk + custom-domain combo.
- **Render** — runs 24/7 in the cloud, independent of any office PC. Free HTTPS, auto-deploy on
  git push, persistent disk for the audit history, free custom domain. ✅ meets every requirement.

The app already reads the **public** Google Sheet via gviz (no Google credentials needed), so it
works identically from the cloud.

## Monthly cost
| Item | Cost |
|------|------|
| Render Web Service — **Starter** (always-on, no sleep) | **$7 / month** |
| Render persistent disk — 1 GB (forensic audit log) | ~**$0.25 / month** |
| HTTPS / TLS certificate | Free (auto) |
| Custom domain on Render | Free (you already own mutarjem.ae) |
| **Total** | **≈ $7.25 / month** |

(Render has a free plan, but it sleeps after 15 min and has no persistent disk → the audit log
would reset. Use Starter for a real company dashboard.)

---

## Setup steps (~15 minutes)

### 1. Put this project on GitHub
```bash
cd ALMUTARJEM-NEW-DASHBOARD
git init && git add . && git commit -m "ATS dashboard"
git branch -M main
git remote add origin https://github.com/<your-org>/ats-dashboard.git
git push -u origin main
```
(Repo can be **private** — Render connects to private repos.)

### 2. Deploy on Render
1. Sign up / log in at https://render.com → connect your GitHub.
2. **New + → Blueprint** → pick the `ats-dashboard` repo. Render reads `render.yaml` and
   provisions the service, env vars, health check, and the persistent disk automatically.
3. Click **Apply**. First build/deploy takes ~2–3 min.
4. You get a working URL immediately: `https://ats-dashboard.onrender.com` (already HTTPS,
   already reading the live Google Sheet).

> No Blueprint? Use **New + → Web Service**, connect the repo, set Build `npm install`,
> Start `node server.js`, Health check `/api/health`, add a 1 GB disk at `/var/data`, and the
> env vars listed in `render.yaml`.

### 3. Attach your permanent domain
1. In the Render service → **Settings → Custom Domains → Add** `dashboard.mutarjem.ae`.
2. Render shows the exact DNS target to use. Add it at your DNS provider (registrar / Cloudflare):

   **DNS record:**
   | Type | Name | Value | TTL |
   |------|------|-------|-----|
   | CNAME | `dashboard` | `ats-dashboard.onrender.com` | Auto / 3600 |

   (Render confirms the exact target string when you add the domain — use whatever it shows.
   If your DNS host can't CNAME a subdomain, Render also provides A-record IPs as an alternative.)
3. Wait for DNS to propagate (minutes–1 hr). Render auto-issues the TLS cert.
4. **Final permanent URL: https://dashboard.mutarjem.ae** ✅

---

## What this gives you (requirement → result)
- **Automatic restart** → Render restarts the service automatically on crash and on deploy.
- **Automatic deployment** → `autoDeploy: true`: every `git push` to `main` redeploys.
- **HTTPS** → automatic, free, auto-renewing certificate.
- **Production environment** → env vars from `render.yaml` (no `.env` committed).
- **Google Sheet connection** → reads the live public sheet (gviz); no credentials.
- **Persistent storage** → 1 GB disk at `/var/data` keeps the forensic audit log across deploys.
- **URL never changes** after server restart, PC restart, office internet drop, or updates —
  because it runs in the cloud, not on a PC.

## After deploy — verify
- Open `https://dashboard.mutarjem.ae` → top bar should read **LIVE GOOGLE SHEET**.
- `https://dashboard.mutarjem.ae/api/health` → `{"ok":true}`.
- Make a test edit in the Google Sheet → within ~60 s it appears in **Audit Log**.

## Notes
- **Region:** `render.yaml` uses `frankfurt` (lowest latency to the UAE). Change to `singapore`
  if you prefer; both are fine.
- **Security:** the dashboard exposes financials with no login. Strongly recommended: put it
  behind **Cloudflare Access** (free, email-based gate) or add basic auth, so only staff can open it.
- **Railway alternative:** New Project → Deploy from GitHub repo → add the same env vars → add a
  volume mounted at `/var/data` → add the custom domain (same CNAME idea). ~$5/mo hobby usage.
