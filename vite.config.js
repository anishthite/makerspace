import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const frontendRoot = resolve(import.meta.dirname, 'frontend');
const page = (file) => resolve(frontendRoot, file);

export default defineConfig({
  root: frontendRoot,
  publicDir: resolve(frontendRoot, 'public'),
  plugins: [react()],
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
        performance: page('performance.html'),
        desktop: page('desktop.html'),
      },
    },
  },
});
