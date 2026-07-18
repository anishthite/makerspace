#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const WIDTH = Number(process.env.MOBILE_SMOKE_WIDTH || 390);
const HEIGHT = Number(process.env.MOBILE_SMOKE_HEIGHT || 844);
const PORT = Number(process.env.MOBILE_SMOKE_PORT || 5190);
const BASE_URL = process.env.MOBILE_SMOKE_BASE_URL || `http://127.0.0.1:${PORT}`;
const SESSION = `spanner-mobile-smoke-${process.pid}`;
const SCREENSHOTS = process.env.MOBILE_SMOKE_SCREENSHOTS === '1';
const PWCLI = process.env.PLAYWRIGHT_CLI || 'playwright-cli';
const PWCLI_PREFIX = process.env.PLAYWRIGHT_CLI
  ? []
  : ['npx', '--yes', '--package', '@playwright/cli'];

const checks = [
  { name: 'project', path: '/', controls: ['#project-submit'] },
  { name: 'workspace', path: '/workspace.html', controls: ['[data-sidebar="trigger"]', '#prompt', '#thread-submit'] },
  { name: 'thread', path: '/thread.html?name=main-mobile-audit', controls: ['#prompt-form #prompt', '#send'] },
  { name: 'settings', path: '/settings.html', controls: ['#github-login'] },
  { name: 'history', path: '/history.html', controls: ['#history-search'] },
  { name: 'telemetry', path: '/telemetry.html', controls: ['#refresh-performance'] },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer() {
  if (process.env.MOBILE_SMOKE_BASE_URL) return null;
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['run', 'frontend:dev', '--', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, BROWSER: 'none' },
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  child.logs = () => logs;
  return child;
}

async function waitForServer(server) {
  for (let i = 0; i < 80; i += 1) {
    if (server?.exitCode !== null) throw new Error(`Vite exited early.\n${server.logs()}`);
    try {
      const response = await fetch(BASE_URL, { cache: 'no-store' });
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${BASE_URL}.\n${server?.logs?.() || ''}`);
}

function run(command, args, options = {}) {
  const { timeoutMs = 45000, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms.\n${stdout}\n${stderr}`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}).\n${stdout}\n${stderr}`));
    });
  });
}

function pwArgs(...args) {
  return [...PWCLI_PREFIX, PWCLI, '-s', SESSION, ...args];
}

async function pw(...args) {
  const [command, ...rest] = pwArgs(...args);
  return run(command, rest);
}

async function pwTimed(timeoutMs, ...args) {
  const [command, ...rest] = pwArgs(...args);
  return run(command, rest, { timeoutMs });
}

function stopServer(server) {
  if (!server || server.killed) return Promise.resolve();
  const signalServer = (signal) => {
    try {
      if (process.platform !== 'win32') process.kill(-server.pid, signal);
      else server.kill(signal);
    } catch {
      try { server.kill(signal); } catch {}
    }
  };
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signalServer('SIGKILL');
      finish();
    }, 3000);
    server.once('exit', finish);
    signalServer('SIGTERM');
  });
}

function parseResult(output) {
  const marker = '### Result';
  const start = output.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = output.indexOf('\n', start) + 1;
  const next = output.indexOf('\n###', bodyStart);
  const raw = output.slice(bodyStart, next < 0 ? undefined : next).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function seedScript() {
  const project = {
    kind: 'github',
    value: 'https://github.com/anishthite/makerspace.git',
    label: 'anishthite/makerspace',
    repoSource: 'github',
    branch: 'main',
  };
  const cacheKey = `spannerWorkspaceThreadsCache:${project.kind}:${project.value}`;
  const threads = [
    { name: 'main-mobile-audit', title: 'Audit mobile support across core pages', status: 'running', runStatus: 'running', latestActivity: 'checking workspace layout', repoUrl: project.value, createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(), updatedAt: new Date().toISOString() },
    { name: 'main-css-cleanup', title: 'Tighten composer overflow on small screens', status: 'completed', runStatus: 'completed', finalAnswerSummary: 'Adjusted composer wrapping and verified mobile viewport.', repoUrl: project.value, createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), endedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  ];
  return `() => { localStorage.setItem('spannerSelectedProject', ${JSON.stringify(JSON.stringify(project))}); localStorage.setItem(${JSON.stringify(cacheKey)}, ${JSON.stringify(JSON.stringify({ savedAt: Date.now(), threads }))}); }`;
}

function auditScript(controls) {
  return `() => {
    const visible = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, found: false, visible: false };
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      return { selector, found: true, visible, width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const root = document.documentElement;
    const overflowers = [...document.querySelectorAll('body *')].map((el) => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), id: el.id, className: String(el.className || '').slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), text: String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) };
    }).filter((item) => item.right > innerWidth + 1 || item.left < -1).slice(0, 8);
    return { path: location.pathname, width: innerWidth, scrollWidth: root.scrollWidth, controls: ${JSON.stringify(controls)}.map(visible), overflowers };
  }`;
}

function drawerAuditScript() {
  return `() => {
    const sheet = document.querySelector('.spanner-sidebar-mobile-sheet[data-mobile=true]');
    const search = sheet?.querySelector('.agent-search');
    const sheetRect = sheet?.getBoundingClientRect();
    const searchRect = search?.getBoundingClientRect();
    return {
      found: Boolean(sheet),
      viewport: innerWidth,
      width: sheetRect ? Math.round(sheetRect.width) : 0,
      right: sheetRect ? Math.round(sheetRect.right) : 0,
      searchRight: searchRect ? Math.round(searchRect.right) : 0,
      searchContained: Boolean(sheetRect && searchRect && searchRect.right <= sheetRect.right + 1),
    };
  }`;
}

async function main() {
  const server = startServer();
  try {
    await waitForServer(server);
    await pw('open', BASE_URL);
    await pw('resize', String(WIDTH), String(HEIGHT));
    await pw('eval', seedScript());
    if (SCREENSHOTS) await mkdir('output/mobile-smoke', { recursive: true });

    const failures = [];
    for (const check of checks) {
      await pw('goto', `${BASE_URL}${check.path}`);
      await delay(900);
      const result = parseResult(await pw('eval', auditScript(check.controls)));
      const overflow = result.scrollWidth > result.width + 1;
      const missing = result.controls.filter((control) => !control.found || !control.visible);
      if (overflow || missing.length) failures.push({ name: check.name, overflow, missing, result });
      if (SCREENSHOTS) await pw('screenshot', '--filename', `output/mobile-smoke/${check.name}.png`, '--full-page');
      console.log(`${overflow || missing.length ? 'not ok' : 'ok'} ${check.name} ${result.scrollWidth}/${result.width}`);

      if (check.name === 'workspace') {
        await pw('click', '[data-sidebar="trigger"]');
        await delay(500);
        const drawer = parseResult(await pw('eval', auditScript(['#threads-list'])));
        const drawerLayout = parseResult(await pw('eval', drawerAuditScript()));
        const drawerText = parseResult(await pw('eval', "() => ({ label: document.querySelector('#workspace-label')?.textContent || '', threads: document.querySelector('#threads-list')?.innerText || '' })"));
        const drawerMissing = drawer.controls.filter((control) => !control.found || !control.visible);
        const drawerEmpty = !/Running|Recently finished|Audit mobile/.test(drawerText.threads);
        const drawerTooNarrow = !drawerLayout.found || drawerLayout.right < drawerLayout.viewport - 18;
        if (drawer.scrollWidth > drawer.width + 1 || drawerMissing.length || drawerEmpty || drawerText.label === 'loading…' || drawerTooNarrow || !drawerLayout.searchContained) {
          failures.push({ name: 'workspace drawer', drawerMissing, drawerEmpty, drawerTooNarrow, drawerLayout, drawerText, result: drawer });
        }
        if (SCREENSHOTS) await pw('screenshot', '--filename', 'output/mobile-smoke/workspace-drawer.png', '--full-page');
        await pw('press', 'Escape').catch(() => {});
        await delay(150);
      }
    }

    if (failures.length) {
      console.error(JSON.stringify(failures, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await pwTimed(8000, 'close').catch(() => {});
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
