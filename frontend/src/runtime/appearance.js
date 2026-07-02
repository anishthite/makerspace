const APPEARANCE = Object.freeze({ theme: 'dark', font: 'mono', palette: 'slate' });

export function applyAppearance() {
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = APPEARANCE.theme;
    root.classList?.toggle?.('dark', true);
    root.dataset.font = APPEARANCE.font;
    root.dataset.palette = APPEARANCE.palette;
    if (globalThis.makerspaceDesktop) root.dataset.desktop = 'true';
    else delete root.dataset.desktop;
  }
  return { ...APPEARANCE };
}

applyAppearance();
