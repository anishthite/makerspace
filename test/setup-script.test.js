import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

import { buildSetupScript } from '../src/setup-script.js';

const config = {
  remoteWorkspaceDir: '/srv/workspace',
  remoteControlDir: '/srv/micro-cloud',
  piInstallCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
  defaultTaskPrompt: 'Do the task.',
  bridgePort: 4310,
  remoteUser: 'daytona',
  remoteHomeDir: '/home/daytona',
  forwardEnvKeys: ['ANTHROPIC_API_KEY'],
};

function extractBridgeScript(script) {
  const match = script.match(
    /cat <<'EOF' \| base64 -d \| gzip -d > '\/srv\/micro-cloud\/pi-bridge\.mjs'\n([\s\S]*?)\nEOF/,
  );

  assert.ok(match, 'expected compressed bridge payload in setup script');
  return gunzipSync(Buffer.from(match[1].replace(/\s+/g, ''), 'base64')).toString('utf8');
}

test('buildSetupScript clones a repo and auto-runs pi when requested', () => {
  const script = buildSetupScript(
    {
      name: 'landing-agent',
      repoMode: 'git',
      repoUrl: 'https://github.com/acme/demo.git',
      branch: 'main',
      repoAuthHeader: 'AUTHORIZATION: basic abc123',
      taskPrompt: 'Build the thing.',
      autoRunAgent: true,
    },
    config,
  );
  const bridgeScript = extractBridgeScript(script);

  assert.ok(Buffer.byteLength(script, 'utf8') < 10 * 1024);
  assert.match(script, /if \[ "\$\(id -u\)" -ne 0 \]; then exec sudo -E \/bin\/bash "\$0" "\$@"; fi/);
  assert.match(script, /export GIT_TERMINAL_PROMPT=0/);
  assert.match(script, /git -c 'http.extraHeader=AUTHORIZATION: basic abc123' clone --depth=1 --branch 'main' 'https:\/\/github.com\/acme\/demo\.git' '\/srv\/workspace'/);
  assert.match(script, /\|\| \{ rm -rf '\/srv\/workspace'; git -c 'http.extraHeader=AUTHORIZATION: basic abc123' clone --depth=1 'https:\/\/github.com\/acme\/demo\.git' '\/srv\/workspace'; \}/);
  assert.match(script, /cat <<'EOF' \| base64 -d \| gzip -d > '\/srv\/micro-cloud\/pi-bridge\.mjs'/);
  assert.match(script, /if \[ ! -d '\/home\/daytona\/\.pi\/agent\/npm\/node_modules\/@earendil-works\/pi-coding-agent' \]; then\n  PI_VERSION=/);
  assert.match(script, /PI_SDK_SPEC='@earendil-works\/pi-coding-agent'/);
  assert.match(script, /npm install --prefix '\/home\/daytona\/\.pi\/agent\/npm' --no-audit --no-fund --ignore-scripts --legacy-peer-deps "\$PI_SDK_SPEC"/);
  assert.match(script, /Description=pi bridge/);
  assert.match(script, /systemctl enable --now pi-bridge\.service/);
  assert.match(script, /curl http:\/\/127\.0\.0\.1:4310\/healthz/);
  assert.match(script, /printf 'export ANTHROPIC_API_KEY=%q\\n' "\$\{ANTHROPIC_API_KEY:-\}"/);
  assert.match(script, /printf '%s\\n' booting > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /printf '%s\\n' launching > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /printf '%s\\n' running > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /printf '%s\\n' completed > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /printf '%s\\n' failed > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /if pi --approve --name 'landing-agent' -p "\$PROMPT_TEXT"; then/);
  assert.match(script, /tmux new-session -d -s pi-agent/);
  assert.match(script, /base64 -d > '\/srv\/micro-cloud\/TASK\.md'/);

  assert.doesNotMatch(bridgeScript, /createRequire/);
  assert.match(bridgeScript, /node_modules", "@earendil-works", "pi-coding-agent", "dist", "index\.js"/);
  assert.match(bridgeScript, /const \{ createAgentSession, SessionManager \} = await loadSdk\(\);/);
  assert.match(bridgeScript, /sessionManager: SessionManager\.inMemory\(workspaceDir\)/);
  assert.match(bridgeScript, /function preparePiSession\(\)/);
  assert.match(bridgeScript, /metric: "first_llm_call_start"/);
  assert.match(bridgeScript, /let streamedAssistantText = ""/);
  assert.match(bridgeScript, /event\.type === "agent_end"/);
  assert.match(bridgeScript, /const run = runs\.get\(decodeURIComponent\(streamMatch\[1\]\)\);/);
});

test('buildSetupScript initializes an empty repo when no repo URL is supplied', () => {
  const script = buildSetupScript(
    {
      name: 'blank-agent',
      repoMode: 'empty',
      repoUrl: '',
      branch: '',
      taskPrompt: '',
      autoRunAgent: false,
    },
    config,
  );

  assert.match(script, /git init/);
  assert.match(script, /git branch -M 'main' \|\| true/);
  assert.match(script, /printf '%s\\n' ready > '\/srv\/micro-cloud\/STATUS'/);
  assert.doesNotMatch(script, /git clone --depth=1/);
  assert.doesNotMatch(script, /tmux new-session -d -s pi-agent/);
});

test('buildSetupScript skips direct pi auto-run for bridge-backed chat sessions', () => {
  const script = buildSetupScript(
    {
      name: 'chat-agent',
      repoMode: 'empty',
      repoUrl: '',
      branch: '',
      taskPrompt: 'Ship it.',
      autoRunAgent: true,
      bridgeMode: true,
      bridgeToken: 'secret-token',
    },
    config,
  );

  assert.ok(Buffer.byteLength(script, 'utf8') < 10 * 1024);
  assert.match(script, /printf 'export PI_BRIDGE_TOKEN=%s\\n' 'secret-token'/);
  assert.match(script, /printf 'export PI_BRIDGE_PACKAGE_DIR=%s\\n' '\/home\/daytona\/\.pi\/agent\/npm'/);
  assert.match(script, /systemctl enable --now pi-bridge\.service/);
  const bridgeScript = extractBridgeScript(script);
  assert.match(bridgeScript, /url\.pathname === "\/auth"/);
  assert.match(bridgeScript, /writeFile\(authPath, authText, "utf8"\)/);
  assert.match(bridgeScript, /submittedAtMs = Number\(body\.submittedAtMs\)/);
  assert.match(bridgeScript, /void startRun\(run, prompt, name, submittedAtMs\)/);
  assert.match(script, /printf '%s\\n' ready > '\/srv\/micro-cloud\/STATUS'/);
  assert.match(script, /installed_bridge_sdk=0/);
  assert.doesNotMatch(script, /for cmd in 'git' 'curl' 'tmux'/);
  assert.doesNotMatch(script, /tmux new-session -d -s pi-agent/);
});
