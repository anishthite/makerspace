const THEME_KEY = 'makerspaceTheme';
const FONT_KEY = 'makerspaceFont';
const PALETTE_KEY = 'makerspaceDarkPalette';
const DEFAULT_PALETTE = 'slate';
const DARK_PALETTES = new Set(['slate', 'midnight', 'graphite', 'dusk', 'nerv-os']);

export function normalizeAppearance(input = {}) {
  return {
    theme: input.theme === 'light' ? 'light' : 'dark',
    font: input.font === 'sans' ? 'sans' : 'mono',
    palette: DARK_PALETTES.has(input.palette) ? input.palette : DEFAULT_PALETTE,
  };
}

function storageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) || '';
  } catch {
    return '';
  }
}

function storageSet(key, value) {
  try {
    if (value) globalThis.localStorage?.setItem(key, value);
    else globalThis.localStorage?.removeItem(key);
  } catch {}
}

export function getAppearance() {
  return normalizeAppearance({
    theme: storageGet(THEME_KEY),
    font: storageGet(FONT_KEY),
    palette: storageGet(PALETTE_KEY),
  });
}

export function applyAppearance(input = getAppearance()) {
  const appearance = normalizeAppearance(input);
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = appearance.theme;
    root.dataset.font = appearance.font;
    root.dataset.palette = appearance.palette;
    if (globalThis.makerspaceDesktop) root.dataset.desktop = 'true';
    else delete root.dataset.desktop;
  }
  return appearance;
}

export function saveAppearance(input = {}) {
  const appearance = normalizeAppearance(input);
  storageSet(THEME_KEY, appearance.theme === 'light' ? 'light' : '');
  storageSet(FONT_KEY, appearance.font === 'sans' ? 'sans' : '');
  storageSet(PALETTE_KEY, appearance.palette === DEFAULT_PALETTE ? '' : appearance.palette);
  return applyAppearance(appearance);
}

applyAppearance();
