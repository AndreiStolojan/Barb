#!/bin/sh
# Installs the Barb macOS app: downloads the latest build from secure-inbox.app,
# puts Barb.app in /Applications (or ~/Applications), and opens it.
#   curl -fsSL https://secure-inbox.app/install.sh | sh
# curl does not mark downloads as quarantined the way browsers do, so macOS
# opens the unsigned app without the "unidentified developer" block.
set -eu

URL="https://secure-inbox.app/downloads/Barb-macos-arm64.zip"

[ "$(uname -s)" = Darwin ] || { echo "Barb for desktop runs on macOS only." >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "This build is for Apple Silicon Macs (M1 or newer)." >&2; exit 1; }

DEST=/Applications
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Barb..."
curl -fSL --progress-bar "$URL" -o "$TMP/Barb.zip"
ditto -x -k "$TMP/Barb.zip" "$TMP"
[ -d "$TMP/Barb.app" ] || { echo "The download did not contain Barb.app." >&2; exit 1; }

# Replace any running or older copy.
osascript -e 'quit app "Barb"' >/dev/null 2>&1 || true
rm -rf "$DEST/Barb.app"
mv "$TMP/Barb.app" "$DEST/"

echo "Installed $DEST/Barb.app"
open "$DEST/Barb.app"
