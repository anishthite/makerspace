import http from 'node:http';
import path from 'node:path';

import { getConfig } from './config.js';
import { preloadHostPiRunner } from './host-pi-runner.js';
import { createProvider } from './provider.js';
import { createAuthService } from './server/auth.js';
import { createBridgeService } from './server/bridge.js';
import { createHttpHelpers } from './server/http.js';
import { createRunState } from './server/run-state.js';
import { createRequestHandler } from './server/routes.js';
import { createSessionService } from './server/sessions.js';
import { createThreadService } from './server/threads.js';

const config = getConfig();
const provider = createProvider(config);
const distDir = path.join(config.rootDir, 'dist');
const publicDir = process.env.SPANNER_STATIC_DIR || distDir;

const httpHelpers = createHttpHelpers({ publicDir, allowedOrigin: config.allowedOrigin, allowedOrigins: config.allowedOrigins });
const auth = createAuthService({ config, http: httpHelpers });
const runState = createRunState({
  config,
  provider,
  loadPiSdk: auth.loadPiSdk,
  loadPiAi: auth.loadPiAi,
  canAccessSession: auth.canAccessSession,
  authStorageForSession: auth.authStorageForSession,
});
const bridge = createBridgeService({ config, provider, auth, runState });
const threads = createThreadService({ config, provider, http: httpHelpers, auth, runState, bridge });
const sessions = createSessionService({ config, provider, auth, runState, bridge });
const server = http.createServer(createRequestHandler({
  config,
  provider,
  http: httpHelpers,
  auth,
  runState,
  threads,
  sessions,
}));

if (config.hostDispatchEnabled) {
  await preloadHostPiRunner(config);
}

if (process.send) {
  process.on('disconnect', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

server.listen(config.port, config.host || undefined, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const host = config.host || 'localhost';
  console.log(`[spanner] listening on http://${host}:${port} (${provider.kind}; ${config.projectName})`);
  void bridge.reattachActiveBridgeRuns();
  void bridge.pruneExpiredIdleBridges();
  void bridge.ensureWarmBridgePool();
  if (Number.isFinite(config.idleBridgeTtlMs) && config.idleBridgeTtlMs > 0) {
    setInterval(() => void bridge.pruneExpiredIdleBridges(), config.idleBridgeTtlMs).unref();
  }
});
