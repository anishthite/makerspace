const APPEARANCE = Object.freeze({ theme: 'dark', font: 'inter', palette: 'terra' });

export function applyAppearance() {
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = APPEARANCE.theme;
    root.classList?.toggle?.('dark', APPEARANCE.theme === 'dark');
    root.dataset.font = APPEARANCE.font;
    root.dataset.palette = APPEARANCE.palette;
    if (globalThis.spannerDesktop) root.dataset.desktop = 'true';
    else delete root.dataset.desktop;
  }
  return { ...APPEARANCE };
}

applyAppearance();
