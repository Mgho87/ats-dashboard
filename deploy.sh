#!/bin/bash
# Auto-update the ATS dashboard from GitHub on cPanel, then restart Passenger.
# Run from a cPanel cron job (which first activates the Node virtualenv), e.g.:
#   source /home/USER/nodevenv/ats-dashboard/20/bin/activate && cd /home/USER/ats-dashboard && bash deploy.sh
# Safe to run every 10–15 min: it only reinstalls / restarts when GitHub changed.
set -e
cd "$(dirname "$0")"

BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)
git pull --ff-only >/dev/null 2>&1 || true
AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date -u) update $BEFORE -> $AFTER"
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true
  mkdir -p tmp && touch tmp/restart.txt        # Passenger picks up the restart
else
  echo "$(date -u) no change"
fi
