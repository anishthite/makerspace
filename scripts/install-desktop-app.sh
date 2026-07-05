#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-Workbench}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [path/to/${APP_NAME}.app|path/to/${APP_NAME}.dmg]

Installs the packaged app into ${INSTALL_DIR}.
With no path, uses output/desktop-package/${APP_NAME}.app, then output/desktop-package/workbench.dmg.
USAGE
}

find_source() {
  local candidate

  for candidate in \
    "$ROOT/output/desktop-package/${APP_NAME}.app" \
    "$ROOT/output/desktop-package/workbench.dmg" \
    "$ROOT/output/${APP_NAME}-"*.dmg; do
    if [[ -e "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

canonical_path() {
  local path="$1"
  local dir base
  dir="$(dirname "$path")"
  base="$(basename "$path")"
  (cd "$dir" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$base")
}

install_app() {
  local src_app="$1"
  local app_name dst src_real dst_real needs_sudo=0

  if [[ ! -d "$src_app" ]]; then
    echo "App not found: $src_app" >&2
    exit 1
  fi

  app_name="$(basename "$src_app")"
  dst="$INSTALL_DIR/$app_name"

  if [[ ! -d "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
  fi

  src_real="$(canonical_path "$src_app")"
  dst_real="$(canonical_path "$dst" || true)"
  if [[ -n "$dst_real" && "$src_real" == "$dst_real" ]]; then
    echo "$app_name is already in $INSTALL_DIR"
    return 0
  fi

  [[ ! -w "$INSTALL_DIR" ]] && needs_sudo=1
  [[ -e "$dst" && ! -w "$dst" ]] && needs_sudo=1

  if [[ "$needs_sudo" == 1 ]]; then
    sudo rm -rf "$dst"
    sudo ditto "$src_app" "$dst"
  else
    rm -rf "$dst"
    ditto "$src_app" "$dst"
  fi

  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$dst" 2>/dev/null || true
  fi
  echo "Installed $dst"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SOURCE="${1:-}"
if [[ -z "$SOURCE" ]]; then
  SOURCE="$(find_source)" || {
    echo "No packaged app or DMG found. Run: npm run desktop:package" >&2
    exit 1
  }
fi

if [[ "$SOURCE" != /* ]]; then
  SOURCE="$PWD/$SOURCE"
fi

MOUNT_POINT=""
cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || hdiutil detach -force "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "${SOURCE%/}" in
  *.app)
    install_app "${SOURCE%/}"
    ;;
  *.dmg)
    if ! command -v hdiutil >/dev/null 2>&1; then
      echo "hdiutil is required to install from a DMG." >&2
      exit 1
    fi
    MOUNT_POINT="$(hdiutil attach -nobrowse -readonly "$SOURCE" | awk '/\/Volumes\// { print substr($0, index($0, "/Volumes/")); exit }')"
    if [[ -z "$MOUNT_POINT" ]]; then
      echo "Could not mount DMG: $SOURCE" >&2
      exit 1
    fi
    APP_IN_DMG="$(find "$MOUNT_POINT" -maxdepth 2 -name '*.app' -type d -print -quit)"
    if [[ -z "$APP_IN_DMG" ]]; then
      echo "No .app found inside DMG: $SOURCE" >&2
      exit 1
    fi
    install_app "$APP_IN_DMG"
    ;;
  *)
    echo "Expected a .app or .dmg path, got: $SOURCE" >&2
    usage >&2
    exit 1
    ;;
esac
