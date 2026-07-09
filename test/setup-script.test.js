import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

import { buildSetupScript } from '../src/setup-script.js';

const config = {
  remoteWorkspaceDir: '/srv/workspace',
  remoteControlDir: '/srv/workbench',
  piInstallCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
  defaultTaskPrompt: 'Do the task.',
  bridgePort: 4310,
  remoteUser: 'daytona',
  remoteHomeDir: '/home/daytona',
  forwardEnvKeys: ['ANTHROPIC_API_KEY'],
};

function extractBridgeScript(script) {
  const match = script.match(
    /base64 -d<<'E'\|gzip -d>'\/srv\/workbench\/pi-bridge\.mjs'\n([\s\S]*?)\nE/
  );

  assert.ok(match, 'expected compressed bridge payload in setup script');
  return gunzipSync(Buffer.from(match[1].replace(/\s+/g, ''), 'base64')).toString('utf8');
}

test('buildSetupScript clones a repo and auto-runs pi when requested', () => {
  const authHeader = `AUTHORIZATION: basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`;
  const script = buildSetupScript(
    {
      name: 'landing-agent',
      repoMode: 'git',
      repoUrl: 'https://github.com/acme/demo.git',
      branch: 'main',
      repoAuthHeader: authHeader,
      taskPrompt: 'Build the thing.',
      autoRunAgent: true,
    },
    config,
  );
  const bridgeScript = extractBridgeScript(script);

  assert.ok(Buffer.byteLength(script, 'utf8') < 15 * 1024);
  assert.match(script, /if \[ "\$\(id -u\)" -ne 0 \]; then exec sudo -E \/bin\/bash "\$0" "\$@"; fi/);
  assert.match(script, /export GIT_TERMINAL_PROMPT=0/);
  assert.match(script, new RegExp(`git -c 'http.extraHeader=${authHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' clone --depth=1 --branch 'main' 'https:\\/\\/github.com\\/acme\\/demo\\.git' '\\/srv\\/workspace'`));
  assert.match(script, new RegExp(`\\|\\| \\{ rm -rf '\\/srv\\/workspace'; git -c 'http.extraHeader=${authHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' clone --depth=1 'https:\\/\\/github.com\\/acme\\/demo\\.git' '\\/srv\\/workspace'; \\}`));
  assert.match(script, /https:\/\/x-access-token:secret-token@github\.com/);
  assert.match(script, /oauth_token: "secret-token"/);
  assert.match(script, /chown -R 'daytona:daytona' '\/home\/daytona\/\.git-credentials' '\/home\/daytona\/\.config'/);
  assert.match(script, /apt-get install -y gh/);
  assert.match(script, /githubcli-archive-keyring\.gpg/);
  assert.match(script, /git config --system credential\.helper store/);
  assert.match(script, /git config --system --add credential\.helper '!gh auth git-credential'/);
  assert.match(script, /git config --system --add safe\.directory '\*'/);
  assert.match(script, /git config --system user\.email 'workbench-agent@users\.noreply\.github\.com'/);
  assert.match(script, /base64 -d<<'E'\|gzip -d>'\/srv\/workbench\/pi-bridge\.mjs'/);
  assert.match(script, /if \[ ! -d '\/home\/daytona\/\.pi\/agent\/npm\/node_modules\/@earendil-works\/pi-coding-agent' \]; then\n  PI_VERSION=/);
  assert.match(script, /PI_SDK_SPEC='@earendil-works\/pi-coding-agent'/);
  assert.match(script, /npm install --prefix '\/home\/daytona\/\.pi\/agent\/npm' --no-audit --no-fund --ignore-scripts --legacy-peer-deps "\$PI_SDK_SPEC"/);
  assert.match(script, /mkdir -p '\/srv\/workbench' '\/srv\/workspace' '\/srv\/workbench\/pi-sessions'/);
  assert.match(script, /chown -R 'daytona:daytona' '\/srv\/workbench' '\/srv\/workspace' '\/home\/daytona\/\.pi\/agent'/);
  assert.match(script, /Description=pi bridge/);
  assert.match(script, /systemctl enable --now pi-bridge\.service/);
  assert.match(script, /curl http:\/\/127\.0\.0\.1:4310\/healthz/);
  assert.match(script, /printf 'export ANTHROPIC_API_KEY=%q\\n' "\$\{ANTHROPIC_API_KEY:-\}"/);
  assert.match(script, /printf '%s\\n' booting > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /printf '%s\\n' launching > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /printf '%s\\n' running > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /printf '%s\\n' completed > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /printf '%s\\n' failed > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /if pi --approve --name 'landing-agent' -p "\$PROMPT_TEXT"; then/);
  assert.match(script, /tmux new-session -d -s pi-agent/);
  assert.match(script, /base64 -d > '\/srv\/workbench\/TASK\.md'/);

  assert.doesNotMatch(bridgeScript, /createRequire/);
  assert.match(bridgeScript, /node_modules", "@earendil-works", "pi-coding-agent", "dist", "index\.js"/);
  assert.match(bridgeScript, /const \{ createAgentSessionFromServices, createAgentSessionServices, SessionManager \} = await loadSdk\(\);/);
  assert.match(bridgeScript, /function defaultsResourceOptions\(\)/);
  assert.match(bridgeScript, /additionalExtensionPaths: \[packageDir\]/);
  assert.match(bridgeScript, /createAgentSessionServices\(\{ cwd, agentDir: authDir, resourceLoaderOptions: defaultsResourceOptions\(\) \}\)/);
  assert.match(bridgeScript, /const id = slash > 0 \? modelRef\.slice\(slash \+ 1\) : modelRef/);
  assert.match(bridgeScript, /restoreSessionFile\(resume\?\.name, resume\?\.entries\)/);
  assert.match(bridgeScript, /SessionManager\.open\(sessionFile, sessionDir, cwd\)/);
  assert.match(bridgeScript, /chunk: "\[system\] main agent session trace: " \+ piSession\.sessionFile \+ "\\n"/);
  assert.match(bridgeScript, /function safeRunCwd\(v=""\)/);
  assert.match(bridgeScript, /function createPiSession\(modelRef="",thinkingLevel="",resume=null,cwd=workspaceDir\)/);
  assert.match(bridgeScript, /function preparePiSession\(modelRef="",thinkingLevel="",resume=null,cwd=workspaceDir\)/);
  assert.match(bridgeScript, /metric: "first_llm_call_start"/);
  assert.match(bridgeScript, /let streamedAssistantText = ""/);
  assert.match(bridgeScript, /event\.type === "agent_end"/);
  assert.match(bridgeScript, /e\.type === "thinking_delta"/);
  assert.match(bridgeScript, /type: "thinking", delta: e\.delta/);
  assert.match(bridgeScript, /\["toolcall_start", "toolcall_delta", "toolcall_end"\]\.includes\(e\.type\)/);
  assert.match(bridgeScript, /phase: e\.type === "toolcall_end" \? "planned" : "planning"/);
  assert.match(bridgeScript, /await waitForWorkflowContinuation\(\)/);
  assert.match(bridgeScript, /type: "workflow_result"/);
  assert.match(bridgeScript, /event\.message\.customType === "workflow-result"/);
  assert.match(bridgeScript, /event\.result\?\.details\?\.background/);
  assert.match(bridgeScript, /const output = resultText\(event\.result\)\.trim\(\)/);
  assert.match(bridgeScript, /stopMatch = url\.pathname\.match/);
  assert.match(bridgeScript, /run\.stop = true/);
  assert.match(bridgeScript, /typeof run\.abort === "function"/);
  assert.match(bridgeScript, /void piSession\?\.abort\?\.\(\)/);
  assert.match(bridgeScript, /const run = runs\.get\(decodeURIComponent\(streamMatch\[1\]\)\);/);
});

test('buildSetupScript bootstraps workspace main without wiping workspace root', () => {
  const script = buildSetupScript(
    {
      name: 'ws-demo',
      repoMode: 'git',
      repoUrl: 'https://github.com/acme/demo.git',
      branch: 'main',
      workspaceBridge: true,
      remoteWorkspaceDir: '/srv/workspace',
      remoteWorkspaceMainDir: '/srv/workspace/main',
      autoRunAgent: false,
    },
    config,
  );

  assert.match(script, /mkdir -p '\/srv\/workspace'/);
  assert.match(script, /if \[ -d '\/srv\/workspace\/main\/\.git' \]; then/);
  assert.match(script, /git clone --depth=1 --branch 'main' 'https:\/\/github.com\/acme\/demo\.git' '\/srv\/workspace\/main'/);
  assert.doesNotMatch(script, /rm -rf '\/srv\/workspace'\n/);
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
  assert.match(script, /printf '%s\\n' ready > '\/srv\/workbench\/STATUS'/);
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

  assert.ok(Buffer.byteLength(script, 'utf8') < 15 * 1024);
  assert.match(script, /printf 'export PI_BRIDGE_TOKEN=%s\\n' 'secret-token'/);
  assert.match(script, /printf 'export PI_BRIDGE_PACKAGE_DIR=%s\\n' '\/home\/daytona\/\.pi\/agent\/npm'/);
  assert.match(script, /printf 'export WORKBENCH_PI_DEFAULTS_PACKAGE_DIR=%s\\n' '\/home\/daytona\/\.pi\/agent\/workbench-pi-defaults'/);
  assert.match(script, /systemctl enable --now pi-bridge\.service/);
  const bridgeScript = extractBridgeScript(script);
  assert.match(bridgeScript, /readFile, rm, writeFile/);
  assert.match(bridgeScript, /request\.method === "GET" && url\.pathname === "\/auth"/);
  assert.match(bridgeScript, /sendJson\(response, 200, \{ authText \}\)/);
  assert.match(bridgeScript, /url\.pathname === "\/auth"/);
  assert.match(bridgeScript, /writeFile\(authPath, authText, "utf8"\)/);
  assert.match(bridgeScript, /const piProfile = body\.piProfile/);
  assert.match(bridgeScript, /await writePiProfile\(piProfile\)/);
  assert.match(bridgeScript, /async function writeGitAuth\(github\)/);
  assert.match(bridgeScript, /const github = body\.github && typeof body\.github === "object" \? body\.github : null;/);
  assert.match(bridgeScript, /await writeGitAuth\(github\)/);
  assert.match(bridgeScript, /process\.env\.GH_TOKEN = token/);
  assert.match(bridgeScript, /process\.env\.GITHUB_TOKEN = token/);
  assert.match(bridgeScript, /\.git-credentials/);
  assert.match(bridgeScript, /x-access-token/);
  assert.match(bridgeScript, /hosts\.yml/);
  assert.match(bridgeScript, /oauth_token/);
  assert.match(bridgeScript, /git_protocol: https/);
  assert.match(bridgeScript, /"x-accel-buffering": "no"/);
  assert.ok(bridgeScript.indexOf('run.clients.add(response);') < bridgeScript.indexOf('for (const event of run.events)'));
  assert.match(bridgeScript, /setInterval\(\(\) => \{ response\.write\(": ping\\n\\n"\); \}, 15000\)/);
  assert.match(bridgeScript, /clearInterval\(heartbeat\)/);
  assert.match(bridgeScript, /rm\(path\.join\(authDir, name\), \{ recursive: true, force: true \}\)/);
  assert.match(bridgeScript, /submittedAtMs = Number\(body\.submittedAtMs\)/);
  assert.match(bridgeScript, /modelRef = String\(body\.modelRef \|\| ""\)\.trim\(\)/);
  assert.match(bridgeScript, /thinkingLevel = String\(body\.thinkingLevel \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(bridgeScript, /images = Array\.isArray\(body\.images\)/);
  assert.match(bridgeScript, /entries = Array\.isArray\(body\.r\)/);
  assert.match(bridgeScript, /delivery=body\.delivery==="followUp"\?"followUp":body\.delivery==="steer"\?"steer":""/);
  assert.match(bridgeScript, /type:"queue",steering:\[\.\.\.event\.steering\],followUp:\[\.\.\.event\.followUp\]/);
  assert.match(bridgeScript, /if\(delivery\)\{/);
  assert.match(bridgeScript, /if\(!run\.child\?\.steer\|\|!run\.child\?\.followUp\)\{/);
  assert.match(bridgeScript, /sendJson\(response,409,\{error:"Main agent is starting; try again in a moment\."\}\)/);
  assert.match(bridgeScript, /if\(delivery==="followUp"\)await run\.child\.followUp\(prompt,images\[0\]\?images:undefined\)/);
  assert.match(bridgeScript, /else await run\.child\.steer\(prompt,images\[0\]\?images:undefined\)/);
  assert.match(bridgeScript, /piSession\.prompt\(prompt, images\[0\] \? \{ images \} : undefined\)/);
  assert.match(bridgeScript, /void startRun\(run, prompt, name, submittedAtMs, modelRef, thinkingLevel, images, entries, body\.cwd \|\| workspaceDir\)/);
  assert.match(script, /printf '%s\\n' ready > '\/srv\/workbench\/STATUS'/);
  assert.match(script, /installed_bridge_sdk=0/);
  assert.doesNotMatch(script, /for cmd in 'git' 'curl' 'tmux'/);
  assert.doesNotMatch(script, /tmux new-session -d -s pi-agent/);
});
