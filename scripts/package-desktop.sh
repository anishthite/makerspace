#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-Makerspace}"
BUNDLE_ID="${BUNDLE_ID:-com.makerspace.desktop}"
OUT_DIR="${OUT_DIR:-$ROOT/output/desktop-package}"
APP_DIR="$OUT_DIR/$APP_NAME.app"
APP_RESOURCES="$APP_DIR/Contents/Resources/app"
DMG_ROOT="$OUT_DIR/dmg-root"
DMG_PATH="$OUT_DIR/makerspace.dmg"
ICON_NAME="${ICON_NAME:-makerspace}"
ICON_SOURCE="${ICON_SOURCE:-$ROOT/public/logo-mark.svg}"
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
ELECTRON_APP="$(cd "$ROOT" && node -e "const path = require('node:path'); console.log(path.join(path.dirname(require.resolve('electron')), 'dist', 'Electron.app'))")"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron.app not found at $ELECTRON_APP" >&2
  echo "Run npm install first." >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$ELECTRON_APP" "$APP_DIR"
rm -f "$APP_DIR/Contents/Resources/default_app.asar"
rm -rf "$APP_RESOURCES"
mkdir -p "$APP_RESOURCES"

for item in package.json package-lock.json desktop src public packages image node_modules; do
  if [[ -e "$ROOT/$item" ]]; then
    cp -R "$ROOT/$item" "$APP_RESOURCES/$item"
  fi
done

node - "$APP_RESOURCES/package.json" <<'NODE'
const fs = require('node:fs');
const packagePath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.main = 'desktop/main.js';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
NODE

if command -v npm >/dev/null 2>&1; then
  (cd "$APP_RESOURCES" && npm prune --omit=dev --ignore-scripts >/dev/null)
fi

if [[ ! -f "$APP_RESOURCES/node_modules/@earendil-works/pi-coding-agent/dist/index.js" ]]; then
  echo "Bundled pi SDK missing. Run npm install before packaging." >&2
  exit 1
fi

mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$APP_NAME"
PLIST="$APP_DIR/Contents/Info.plist"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -replace CFBundleVersion -string "$VERSION" "$PLIST"
plutil -remove ElectronAsarIntegrity "$PLIST" >/dev/null 2>&1 || true

if [[ -f "$ICON_SOURCE" ]]; then
  ICONSET="$OUT_DIR/$ICON_NAME.iconset"
  ICON_SVG="$OUT_DIR/$ICON_NAME-1024.svg"
  ICON_PNG="$OUT_DIR/$ICON_NAME-1024.png"
  if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    rm -rf "$ICONSET"
    mkdir -p "$ICONSET"
    perl -0pe 's/<svg /<svg width="1024" height="1024" /' "$ICON_SOURCE" > "$ICON_SVG"
    sips -s format png "$ICON_SVG" --out "$ICON_PNG" >/dev/null
    for size in 16 32 128 256 512; do
      sips -z "$size" "$size" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
      scale=$((size * 2))
      sips -z "$scale" "$scale" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/$ICON_NAME.icns"
    plutil -replace CFBundleIconFile -string "$ICON_NAME.icns" "$PLIST"
  else
    echo "warning: sips/iconutil missing; keeping Electron icon" >&2
  fi
fi

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || echo "warning: codesign failed; built unsigned app" >&2
fi

if command -v hdiutil >/dev/null 2>&1; then
  mkdir -p "$DMG_ROOT"
  cp -R "$APP_DIR" "$DMG_ROOT/$APP_NAME.app"
  ln -s /Applications "$DMG_ROOT/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_PATH" >/dev/null
  echo "wrote $DMG_PATH"
fi

echo "wrote $APP_DIR"
