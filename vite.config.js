import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const frontendRoot = resolve(import.meta.dirname, 'frontend');
const page = (file) => resolve(frontendRoot, file);
const onboardingContentFile = resolve(frontendRoot, 'src/onboarding-content.json');

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('Request body is too large.'));
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function assertOnboardingContent(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.steps)) throw new Error('Invalid onboarding content.');
  for (const field of ['eyebrow', 'title', 'copy']) {
    if (typeof value[field] !== 'string') throw new Error(`Missing ${field}.`);
  }
  for (const group of ['actions', 'statusLabels']) {
    if (!value[group] || Object.values(value[group]).some((item) => typeof item !== 'string')) throw new Error(`Invalid ${group}.`);
  }
  for (const step of value.steps) {
    if (!step || typeof step.id !== 'string' || typeof step.title !== 'string' || typeof step.body !== 'string') throw new Error('Invalid step.');
  }
}

function onboardingContentEditorPlugin() {
  return {
    name: 'spanner-onboarding-content-editor',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (pathname !== '/__spanner/onboarding-content') return next();
        response.setHeader('content-type', 'application/json; charset=utf-8');
        try {
          if (request.method === 'GET') {
            response.end(await readFile(onboardingContentFile, 'utf8'));
            return;
          }
          if (request.method === 'PUT') {
            const content = JSON.parse(await readRequestBody(request));
            assertOnboardingContent(content);
            await writeFile(onboardingContentFile, `${JSON.stringify(content, null, 2)}\n`);
            server.ws.send({ type: 'full-reload' });
            response.end(JSON.stringify({ ok: true, file: 'frontend/src/onboarding-content.json' }));
            return;
          }
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Method not allowed.' }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error.message || 'Could not save onboarding content.' }));
        }
      });
    },
  };
}

function cleanRouteAliasPlugin() {
  return {
    name: 'spanner-clean-route-aliases',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        if (url.pathname === '/landing' || url.pathname === '/landing/') request.url = `/desktop.html${url.search}`;
        next();
      });
    },
  };
}

export default defineConfig({
  root: frontendRoot,
  envDir: import.meta.dirname,
  publicDir: resolve(frontendRoot, 'public'),
  plugins: [cleanRouteAliasPlugin(), onboardingContentEditorPlugin(), react(), tailwindcss()],
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
        traceComponents: page('trace-components.html'),
        desktop: page('desktop.html'),
        onboardingEditor: page('onboarding-editor.html'),
        excalidrawViewer: page('excalidraw-viewer.html'),
        excalidrawEditor: page('excalidraw-editor.html'),
      },
    },
  },
});
