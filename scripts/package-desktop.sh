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
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
TEAM_ID="${TEAM_ID:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
ELECTRON_APP="$(cd "$ROOT" && node -e "const path = require('node:path'); console.log(path.join(path.dirname(require.resolve('electron')), 'dist', 'Electron.app'))")"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron.app not found at $ELECTRON_APP" >&2
  echo "Run npm install first." >&2
  exit 1
fi

(cd "$ROOT" && VITE_MAKERSPACE_API_BASE= npm run build)

if [[ -n "$NOTARY_PROFILE" && -z "$SIGN_IDENTITY" ]]; then
  echo "SIGN_IDENTITY is required when NOTARY_PROFILE is set." >&2
  exit 1
fi

sign_app() {
  if [[ -z "$SIGN_IDENTITY" ]]; then
    if command -v codesign >/dev/null 2>&1; then
      codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || echo "warning: codesign failed; built unsigned app" >&2
    fi
    return 0
  fi

  echo "signing $APP_DIR with $SIGN_IDENTITY"
  (cd "$ROOT" && node --input-type=module - "$APP_DIR" "$SIGN_IDENTITY" <<'NODE'
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let sign;
try {
  ({ sign } = await import('@electron/osx-sign'));
} catch {
  console.error('@electron/osx-sign missing. Run npm install first.');
  process.exit(1);
}

const [app, identity] = process.argv.slice(2);
const resources = join(app, 'Contents', 'Resources', 'app');
const binaries = [];

function isMachO(file) {
  try {
    return execFileSync('file', ['-b', file], { encoding: 'utf8' }).includes('Mach-O');
  } catch {
    return false;
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (/\.(node|dylib)$/.test(name) && isMachO(fullPath)) {
      binaries.push(fullPath);
    }
  }
}

walk(resources);
if (binaries.length) {
  console.log(`signing ${binaries.length} bundled native module(s)`);
}

await sign({
  app,
  identity,
  platform: 'darwin',
  binaries,
  preEmbedProvisioningProfile: false,
  strictVerify: true,
  type: 'distribution',
});
NODE
  )
}

notarize_dmg() {
  [[ -z "$NOTARY_PROFILE" ]] && return 0

  local args=(--keychain-profile "$NOTARY_PROFILE")
  if [[ -n "$TEAM_ID" ]]; then
    args+=(--team-id "$TEAM_ID")
  fi

  echo "submitting $DMG_PATH to Apple notarization"
  xcrun notarytool submit "$DMG_PATH" "${args[@]}" --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
  spctl -a -t open --context context:primary-signature -v "$DMG_PATH"
}

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$ELECTRON_APP" "$APP_DIR"
rm -f "$APP_DIR/Contents/Resources/default_app.asar"
rm -rf "$APP_RESOURCES"
mkdir -p "$APP_RESOURCES"

for item in package.json package-lock.json desktop src public dist packages image node_modules; do
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

sign_app

if command -v hdiutil >/dev/null 2>&1; then
  mkdir -p "$DMG_ROOT"
  cp -R "$APP_DIR" "$DMG_ROOT/$APP_NAME.app"
  ln -s /Applications "$DMG_ROOT/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_PATH" >/dev/null
  if [[ -n "$SIGN_IDENTITY" ]]; then
    codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
  fi
  notarize_dmg
  echo "wrote $DMG_PATH"
fi

echo "wrote $APP_DIR"
