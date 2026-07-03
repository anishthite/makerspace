import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const frontendRoot = resolve(import.meta.dirname, 'frontend');
const page = (file) => resolve(frontendRoot, file);

export default defineConfig({
  root: frontendRoot,
  envDir: import.meta.dirname,
  publicDir: resolve(frontendRoot, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(frontendRoot, 'src'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        project: page('index.html'),
        workspace: page('workspace.html'),
        thread: page('thread.html'),
        settings: page('settings.html'),
        history: page('history.html'),
        telemetry: page('telemetry.html'),
        localTelemetry: page('local-telemetry.html'),
        desktop: page('desktop.html'),
        excalidrawViewer: page('excalidraw-viewer.html'),
        excalidrawEditor: page('excalidraw-editor.html'),
      },
    },
  },
});
