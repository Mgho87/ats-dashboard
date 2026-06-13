#!/bin/bash
# Auto-update the ATS dashboard from GitHub on cPanel, then restart Passenger.
# Run via a cPanel cron (after activating the Node virtualenv). Safe every 10-15 min.
set -e
cd "$(dirname "$0")"
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)
git pull --ff-only >/dev/null 2>&1 || true
AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)
if [ "$BEFORE" != "$AFTER" ]; then
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true
  mkdir -p tmp && touch tmp/restart.txt
  echo "$(date -u) updated $BEFORE -> $AFTER"
else
  echo "$(date -u) no change"
fi
