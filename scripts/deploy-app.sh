#!/usr/bin/env bash
# ========================================================================
# sel2pw — production deploy script (run on the VPS)
#
# Pulls main, builds, tests, packages the exe, copies artefacts to the
# downloads dir, restarts the systemd unit. Mirrors the pattern from
# /var/www/testforge-ai/modern-automation-platform/scripts/deploy-app.sh.
#
# Pre-requisites (one-time, see docs/Sel2pw_Deployment_Guide.md §2):
#   - Node 20 + npm
#   - @yao-pkg/pkg installed globally (or as a devDep of this repo)
#   - systemd unit at /etc/systemd/system/sel2pw-api.service
#   - /var/www/testforge-ai/downloads exists and is writable
# ========================================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/testforge-ai/Converter}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-/var/www/testforge-ai/downloads}"
SERVICE="${SERVICE:-sel2pw-api}"

cd "$REPO_DIR"

echo "[1/7] git pull origin main"
git pull origin main

echo "[2/7] npm install"
npm install --legacy-peer-deps

echo "[3/7] npm run build (TypeScript -> dist/)"
npm run build

echo "[4/7] npm test"
npm test

echo "[5/7] npm run build:exe (pkg -> dist-exe/)"
npm run build:exe || {
  echo "  build:exe failed or skipped; continuing without exe refresh"
}

echo "[6/7] publish artefacts to $DOWNLOADS_DIR"
mkdir -p "$DOWNLOADS_DIR"
[ -f dist-exe/sel2pw.exe ]        && cp dist-exe/sel2pw.exe        "$DOWNLOADS_DIR/"
[ -f build/run.bat ]              && cp build/run.bat              "$DOWNLOADS_DIR/"
[ -f build/sel2pw.config.yaml ]   && cp build/sel2pw.config.yaml   "$DOWNLOADS_DIR/"
[ -f build/README.txt ]           && cp build/README.txt           "$DOWNLOADS_DIR/"

if command -v zip >/dev/null 2>&1 && [ -f "$DOWNLOADS_DIR/sel2pw.exe" ]; then
  (cd "$DOWNLOADS_DIR" && zip -j -q -o sel2pw.zip sel2pw.exe run.bat sel2pw.config.yaml README.txt)
  echo "  packaged $DOWNLOADS_DIR/sel2pw.zip"
fi

echo "[7/7] restart $SERVICE"
systemctl restart "$SERVICE"
systemctl is-active "$SERVICE"

echo ""
echo "Deploy complete."
echo "  API:        $(systemctl is-active $SERVICE) on :4200"
echo "  Downloads:  $DOWNLOADS_DIR/"
ls -lh "$DOWNLOADS_DIR" | grep -E '(sel2pw|run\.bat)' || true
