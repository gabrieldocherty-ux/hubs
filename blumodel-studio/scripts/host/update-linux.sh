#!/usr/bin/env bash
# Updates this machine's BluModel Studio from GitHub in one command (docs/HOSTING.md, "Update"):
#
#   sudo bash /srv/blumodel-studio/repo/blumodel-studio/scripts/host/update-linux.sh [--dry-run] [--force]
#
# It runs scripts/host/update.mjs: git pull --ff-only, npm ci and the build as the blumodel
# account, then the deploy (database backup first, the new app in place with the old one kept as
# app.previous, blumodel-studio.service restarted, http://127.0.0.1:8790/api/health checked) and,
# if that health check fails, a rollback to the previous app. The tunnel keeps running throughout.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$(cd "$HERE/../.." && pwd)"

DRY=0
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY=1; fi
done
if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then
  echo "Run it with sudo: sudo bash $HERE/update-linux.sh $*" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed: run scripts/host/install-linux.sh first." >&2
  exit 1
fi
exec node "$APP_SRC/scripts/host/update.mjs" "$@"
