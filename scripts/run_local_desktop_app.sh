#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_APP="${ASCILINE_SOURCE_APP:-/private/tmp/asciline-remix-tauri-target/release/bundle/macos/ASCII VJ Remix.app}"
INSTALL_DIR="${ASCILINE_INSTALL_DIR:-$HOME/Applications}"
INSTALL_APP="$INSTALL_DIR/ASCII VJ Remix.app"
SYSTEM_APP="/Applications/ASCII VJ Remix.app"
LEGACY_INSTALL_APP="$INSTALL_DIR/ASCILINE Remix.app"
LEGACY_SYSTEM_APP="/Applications/ASCILINE Remix.app"
SYNC_SYSTEM_APP="${ASCILINE_SYNC_SYSTEM_APP:-1}"
APP_ID="com.asciline.remix"
CODESIGN_IDENTITY="${ASCILINE_CODESIGN_IDENTITY:--}"

if [[ "${1:-}" == "--build" ]]; then
  set +e
  (cd "$ROOT_DIR" && npm run tauri -- build --bundles app)
  build_status=$?
  set -e
  if [[ "$build_status" -ne 0 && ! -d "$SOURCE_APP" ]]; then
    exit "$build_status"
  fi
  if [[ "$build_status" -ne 0 ]]; then
    echo "ASCILINE local run: release app was produced; continuing after non-fatal bundler exit." >&2
  fi
fi

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "ASCILINE local run: missing built app at $SOURCE_APP" >&2
  echo "Run: npm run tauri -- build --bundles app" >&2
  exit 1
fi

pkill -f '/(ASCII VJ Remix|ASCILINE Remix).app/Contents/MacOS/asciline-remix|/debug/asciline-remix' 2>/dev/null || true

ENTITLEMENTS="$ROOT_DIR/src-tauri/Entitlements.plist"

install_app() {
  local target_app="$1"
  local target_dir
  target_dir="$(dirname "$target_app")"

  mkdir -p "$target_dir"
  rm -rf "$target_app"
  /usr/bin/ditto "$SOURCE_APP" "$target_app"

  # Local debug bundles can inherit quarantine/provenance metadata from DMG or /private/tmp staging.
  /usr/bin/xattr -cr "$target_app" 2>/dev/null || true

  if [[ -f "$ENTITLEMENTS" ]]; then
    /usr/bin/codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$CODESIGN_IDENTITY" "$target_app"
  else
    /usr/bin/codesign --force --deep --options runtime --sign "$CODESIGN_IDENTITY" "$target_app"
  fi
}

install_app "$INSTALL_APP"

if [[ "$LEGACY_INSTALL_APP" != "$INSTALL_APP" && -d "$LEGACY_INSTALL_APP" ]]; then
  rm -rf "$LEGACY_INSTALL_APP"
fi

if [[ "$SYNC_SYSTEM_APP" == "1" && "$INSTALL_APP" != "$SYSTEM_APP" && ( -d "$SYSTEM_APP" || -d "$LEGACY_SYSTEM_APP" ) ]]; then
  if [[ -w "/Applications" && ( ! -d "$SYSTEM_APP" || -w "$SYSTEM_APP" ) ]]; then
    install_app "$SYSTEM_APP"
    if [[ "$LEGACY_SYSTEM_APP" != "$SYSTEM_APP" && -d "$LEGACY_SYSTEM_APP" ]]; then
      rm -rf "$LEGACY_SYSTEM_APP"
    fi
    echo "ASCILINE local run: refreshed $SYSTEM_APP"
  else
    echo "ASCILINE local run: $SYSTEM_APP exists but is not writable; it may be stale." >&2
    echo "Set ASCILINE_INSTALL_DIR=/Applications or remove the old copy if Finder opens it." >&2
  fi
fi

if [[ "${ASCILINE_RESET_TCC:-0}" == "1" ]]; then
  /usr/bin/tccutil reset Camera "$APP_ID" || true
  /usr/bin/tccutil reset Microphone "$APP_ID" || true
fi

echo "ASCILINE local run: $INSTALL_APP"
echo "ASCILINE local run: codesign identity $CODESIGN_IDENTITY"
if [[ "${ASCILINE_FOREGROUND:-0}" == "1" ]]; then
  exec "$INSTALL_APP/Contents/MacOS/asciline-remix"
fi

/usr/bin/open -n "$INSTALL_APP"
