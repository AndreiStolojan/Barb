#!/usr/bin/env bash
# Uploads the Mac build to the Pi, where nginx serves it at
# https://secure-inbox.app/downloads/. Build it first with scripts/build-mac-app.sh.
# PI_HOST defaults to the `pi` SSH alias.
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP="build/downloads/Barb-macos-arm64.zip"
HOST="${PI_HOST:-pi}"
DIR="/opt/secureinbox/downloads"

[ -f "$ZIP" ] || { echo "Missing $ZIP. Run scripts/build-mac-app.sh first." >&2; exit 1; }

# Upload under a temporary name, then rename, so nobody downloads a half-written zip.
ssh "$HOST" "mkdir -p $DIR"
scp "$ZIP" "$HOST:$DIR/.upload.zip"
ssh "$HOST" "mv $DIR/.upload.zip $DIR/$(basename "$ZIP")"
echo "Published https://secure-inbox.app/downloads/$(basename "$ZIP")"
