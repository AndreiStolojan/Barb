#!/usr/bin/env bash

# Build the Barb macOS app (Tauri shell around the frontend) and zip it to
# build/downloads/Barb-macos-arm64.zip, the file the website serves for download.
# Usage: scripts/build-mac-app.sh   (run on an Apple Silicon Mac with Rust and Xcode)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
frontend="${repo_root}/frontend"
app="${frontend}/src-tauri/target/release/bundle/macos/Barb.app"
zip="${repo_root}/build/downloads/Barb-macos-arm64.zip"

# rustup installs cargo here, but a non-login shell may not have it on PATH.
if ! command -v cargo >/dev/null 2>&1 && [[ -x "${HOME}/.cargo/bin/cargo" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

if [[ ! -x "${frontend}/node_modules/.bin/tauri" ]]; then
  echo "Installing frontend dependencies"
  npm ci --prefix "${frontend}"
fi

echo "Building Barb.app"
npm run build:mac --prefix "${frontend}"

# ditto keeps the bundle's symlinks, permissions and extended attributes, which zip does not.
mkdir -p "$(dirname "${zip}")"
rm -f "${zip}"
ditto -c -k --keepParent "${app}" "${zip}"

echo "Wrote ${zip} ($(du -h "${zip}" | cut -f1 | tr -d ' '))"
