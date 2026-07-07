# workbench v0

A tiny control plane for talking to `pi` inside fresh Daytona sandboxes.

## What this app does

- shows one repo-agent form for a Git repo and starting prompt
- creates a Daytona sandbox, clones the repo or initializes an empty workspace, and starts a tiny Pi bridge service
- uses Daytona preview URLs for the bridge port while the browser only talks to this control backend
- streams live Pi output back to the browser over server-sent events
- supports host-dispatch mode: Pi runs on the control backend while read/bash/edit/write tools execute inside the Daytona sandbox
- keeps image settings, registry push settings, and model-provider API-key forwarding on the settings panel
- supports GitHub sign-in with user-scoped sessions, recent projects, repo listing, and private-repo clone auth

## What it does not do

- no fake local mode
- no embedded terminal
- no local repo upload or bidirectional file sync
- no email/password auth; GitHub OAuth is the sign-in path
- no registry secret manager beyond local plain-text settings

That is deliberate. The goal is one prompt in, one real sandbox-backed run out.

## How the agent flow works

1. the homepage posts `repoUrl`, optional `branch`, optional `name`, and a starting `prompt` to `POST /api/threads`
2. the control backend creates a Daytona sandbox for that repo and starts the sandbox-local Pi bridge
3. the browser redirects to `/thread.html?name=<agent>`
4. the agent page reads `GET /api/threads/:name`, mirrors output from `GET /api/sessions/:name/stream`, and sends follow-up prompts to `POST /api/threads/:name/messages`
5. after each run completes, the same bridge sandbox returns to `ready` so the next prompt can reuse the repo workspace

For deployment, put the built React/Vite static UI (`npm run build` → `dist/`) on Vercel and this Node control backend on a server with Daytona credentials. Set the frontend env `VITE_WORKBENCH_API_BASE=https://api.example.com` in Vercel; the browser no longer accepts `?api=` or `?token=` bootstrap links. The backend keeps Daytona credentials server-side.

Hosted users sign in with GitHub for their Workbench account. Settings → Codex stores their own ChatGPT Plus/Pro Codex OAuth for Pi; Settings → Claude Code stores their Claude Pro/Max OAuth. Do not set shared model API keys in Vercel or DigitalOcean for hosted OAuth runs.

DigitalOcean App Platform can build the root `Dockerfile` for the control backend. Keep the source directory at `/`, use the Dockerfile build strategy, and set the public HTTP port to `8080`. `image/Dockerfile` is still the separate Daytona sandbox image. Set backend env `WORKBENCH_ALLOWED_ORIGIN=https://your-vercel-app.vercel.app` so cross-origin GitHub-auth cookies work.

To repeat the cold intent-prep measurement without relying on an existing warm bridge, start the server with an empty `SESSION_DATA_PATH`, then run:

```bash
node scripts/measure-bootup.js --intent-prep --require-empty-sessions --runs 2 --prep-timeout-ms 300000 --timeout-ms 30000 --require-pass
```

## Image-backed launch

Daytona can create sandboxes from a configured snapshot or a custom image reference.

This app keeps the smallest real image flow:

1. you edit `image/Dockerfile` through the settings panel or locally
2. you save an optional image ref such as `ghcr.io/you/pi-daytona:latest`
3. if `autoBuildImage` is enabled, the server runs:
   - `docker buildx build --platform linux/amd64 -t <imageRef> --push ...`
4. new sandboxes use the saved image ref; when the image ref is blank, Daytona uses `DAYTONA_SNAPSHOT` or Daytona defaults

For private image pulls, configure the registry in Daytona itself. The local registry fields still support building and pushing your image from the control backend.

## Repo support

This version supports:
- remote Git repos the sandbox can clone
- blank repos created on first boot

This version does not support:
- local-only unpushed repos
- private repo credential setup beyond whatever the sandbox already has
- bidirectional file sync

## Run locally

Prereqs:
- `DAYTONA_API_KEY` is exported on the machine running this server
- Docker is installed locally if you enable auto-build
- you are already logged into whatever registry you push to
- either your model-provider API keys are exported locally, or your local `~/.pi/agent/auth.json` already has working Pi auth the server can send to bridge sandboxes

Then:

```bash
npm install
npm run build # emits the React/Vite static frontend into dist/
npm start
```

`frontend/` is the normal Vite app. Root `src/` is the Node backend/API runtime for Daytona, local provider, sessions, SSE, and settings. Build `dist/` before starting the backend.

For local-folder mode, skip Daytona and run Pi directly on a folder:

```bash
INFRA_PROVIDER=local npm start
npm run desktop:dev
```

Run multiple local projects by giving each process its own port and state folder:

```bash
INFRA_PROVIDER=local WORKBENCH_PROJECT=site WORKBENCH_HOME=~/.workbench/site PORT=8787 npm start
INFRA_PROVIDER=local WORKBENCH_PROJECT=api  WORKBENCH_HOME=~/.workbench/api  PORT=8788 npm start
```

Desktop dev accepts a folder argument and uses that folder name in the header:

```bash
npm run desktop:dev -- ~/code/site
npm run desktop:dev -- ~/code/api
```

The desktop dev shell starts the same backend, serves built `dist/`, binds to `127.0.0.1`, and stores local state in a per-project folder when a folder argument is provided.

Package, release, and install the macOS app from the installed Electron binary:

```bash
npm run desktop:package
npm run desktop:release
npm run desktop:install
```

The installer copies `output/desktop-package/Workbench.app` into `/Applications`. Pass a path when needed: `npm run desktop:install -- output/desktop-package/workbench.dmg`.
The DMG lands at `output/desktop-package/workbench.dmg`; publish it as `workbench.dmg` in the public `anishthite/workbench-downloads` repo. The release script also writes `output/desktop-package/workbench-mac-$ARCH.zip`; attach that ZIP to the same SemVer GitHub Release (`v0.0.2`, etc.) for OTA updates. Users need one manual install of a build containing the updater before later releases download automatically and apply on the next launch. The `/desktop` landing page downloads from `https://github.com/anishthite/workbench-downloads/releases/latest/download/workbench.dmg`, so do not commit the 270MB binary to this source repo.

Optional env vars:

```bash
PORT=8787
WORKBENCH_PROJECT=site
WORKBENCH_HOME=~/.workbench/site
CONTROL_API_TOKEN=
VITE_WORKBENCH_API_BASE= # frontend build env only; backend HTTPS origin
WORKBENCH_AUTH_REQUIRED= # set true to require GitHub sign-in even outside hosted mode
WORKBENCH_AUTH_SECRET= # stable secret for signed auth cookies and encrypted OAuth tokens
WORKBENCH_ALLOWED_ORIGIN= # set to the static frontend origin for cross-origin cookie auth
WORKBENCH_AUTH_SAMESITE= # defaults to None when WORKBENCH_ALLOWED_ORIGIN is set, otherwise Lax
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID= # optional; enables short-lived installation tokens for sandbox git
GITHUB_APP_SLUG= # e.g. your-app-name; setup URL should be /api/auth/github/app/callback
GITHUB_APP_PRIVATE_KEY= # PEM, or PEM with \n escapes
AUTH_DATA_PATH=./data/auth.json
WORKBENCH_STATE_STORE=file # set d1 for hosted Cloudflare D1 persistence
WORKBENCH_WORKSPACE_MODE= # set true to reuse one remote workspace per signed-in user + repo
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=
DAYTONA_SNAPSHOT=
DAYTONA_IMAGE=
DAYTONA_CPU=2
DAYTONA_MEMORY=8
DAYTONA_DISK=10
DAYTONA_USER=daytona
DAYTONA_HOME=/home/daytona
DAYTONA_AUTOSTOP_MINUTES=60
DAYTONA_AUTODELETE_MINUTES=120
IMAGE_ASSETS_DIR=./image
DOCKERFILE_PATH=./image/Dockerfile
SETTINGS_DATA_PATH=./data/settings.json
RECENT_PROJECTS_DATA_PATH=./data/recent-projects.json
PI_SESSION_TRACE_DIR=./data/pi-sessions
PI_CODING_AGENT_DIR=~/.pi/agent
PI_PROFILE_DATA_PATH=./data/pi-profile.json
WORKBENCH_PI_DEFAULTS_PACKAGE_DIR=./packages/workbench-pi-defaults
REMOTE_WORKSPACE_DIR=/srv/workspace
REMOTE_CONTROL_DIR=/srv/workbench
REMOTE_PI_DEFAULTS_PACKAGE_DIR=/home/daytona/.pi/agent/workbench-pi-defaults
PI_BRIDGE_PORT=4310
PI_BRIDGE_READY_TIMEOUT_MS=240000
PI_BRIDGE_READY_POLL_MS=1000
IDLE_BRIDGE_TTL_MS=3600000
WARM_BRIDGE_POOL_SIZE=0
PI_BRIDGE_STREAM_STALL_MS=60000
FORWARD_ENV_KEYS=GH_TOKEN,GITHUB_TOKEN,ANTHROPIC_API_KEY,OPENAI_API_KEY,GOOGLE_API_KEY,GEMINI_API_KEY,OPENROUTER_API_KEY,INFERENCE_API_KEY
PI_INSTALL_COMMAND=npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

### Git auth inside sandboxes

Sandboxes get full `git` and `gh` CLI auth so agents can push branches and open PRs:

- The setup script installs the GitHub CLI (`gh`) and configures system-level git credential helpers (`store` plus `gh auth git-credential`), `safe.directory`, and a fallback commit identity.
- On every bridge auth sync, the server forwards a GitHub token to the sandbox: a short-lived GitHub App installation token when the repo owner has installed the app, otherwise the signed-in user's GitHub OAuth token in multi-user mode, or `GH_TOKEN`/`GITHUB_TOKEN` from the server environment otherwise. The bridge writes `~/.git-credentials` and `~/.gitconfig` (commit identity from the GitHub profile) and exports `GH_TOKEN`/`GITHUB_TOKEN` for agent commands.
- Private GitHub clones use the same per-user token during Daytona setup, including pasted `github.com` URLs; the raw token is stripped before sessions are persisted.
- `GH_TOKEN`/`GITHUB_TOKEN` are also in the default `FORWARD_ENV_KEYS`, so self-hosted single-user deployments can drop a PAT in the server env and get working `git push` + `gh` in every sandbox.

For hosted App Platform deployments, set `WORKBENCH_STATE_STORE=d1` plus the three Cloudflare values above. D1 stores sessions, settings, recent projects, Dockerfile text, and Pi profile choices/text; repo files still live in Git/Daytona/local disk.

## Pi defaults package

Workbench ships a starter Pi package at `packages/workbench-pi-defaults`. Local and host-dispatch SDK runs load it directly when the directory exists. Custom Daytona image builds copy it into the sandbox at `REMOTE_PI_DEFAULTS_PACKAGE_DIR`, and the remote bridge loads that baked copy without touching user dotfiles.

The package contains a prompt-injecting extension, the `inference/nvidia/nemotron3-super` provider registration, starter skills, and prompts. Set `INFERENCE_API_KEY` to use Inference.net. Publish the same package later for online installs with `pi install npm:@workbench/pi-defaults@0.1.0`.

The settings page exposes the Workbench Pi profile from `packages/workbench-pi-defaults/context/AGENTS.md` plus package skills, extensions, and prompts. In multi-user mode, profile edits are stored per user in the app state store; remote bridge runs sync selected profile files per run without reading personal `~/.pi/agent` files.

## API

- `GET /healthz`
- `GET /api/report`
- `GET /api/performance`
- `GET /api/me`
- `GET /api/auth/github`
- `POST /api/auth/github/login`
- `GET /api/auth/github/callback`
- `POST /api/auth/github/app/install`
- `GET /api/auth/github/app/callback`
- `POST /api/auth/logout`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/recent-projects`
- `POST /api/recent-projects`
- `GET /api/threads`
- `POST /api/threads`
- `GET /api/threads/:name`
- `POST /api/threads/:name/messages`
- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/bridge-intents`
- `POST /api/chat`
- `GET /api/sessions/:name/stream`
- `GET /api/sessions/:name/output`
- `POST /api/sessions/:name/share`

For single-user/token mode, set `CONTROL_API_TOKEN`; API clients send it as `Authorization: Bearer <token>`. The hosted browser path uses GitHub sign-in cookies; do not expose `CONTROL_API_TOKEN` in Vercel frontend env or URLs.

### Create agent body

```json
{
  "repoUrl": "https://github.com/you/repo.git",
  "branch": "main",
  "name": "optional-agent-name",
  "prompt": "Read the repo and make the smallest useful change."
}
```

### Agent message body

```json
{
  "prompt": "Now run the tests and fix the smallest failure."
}
```

### Bridge intent body

```json
{
  "clientId": "browser-or-script-id"
}
```

### Chat body

```json
{
  "prompt": "Build the first version of the app.",
  "clientId": "browser-or-script-id",
  "submittedAtMs": 1781681715890
}
```

### Save settings body

```json
{
  "imageRef": "ghcr.io/you/pi-daytona:latest",
  "registryAuth": "username:token",
  "autoBuildImage": true,
  "dockerfile": "FROM ubuntu:24.04\n..."
}
```

### Manual session body

```json
{
  "name": "landing-page-agent",
  "repoUrl": "https://github.com/you/repo.git",
  "branch": "main",
  "taskPrompt": "Build the first version of the marketing site.",
  "visibility": "private",
  "sharePort": 3000,
  "autoRunAgent": true
}
```

## Notes on Daytona

The lifecycle transport is `@daytona/sdk`:
- sandbox lifecycle: `create`, `list`, `delete`, lifecycle intervals
- process execution: setup script, manual Pi runs, log polling, host-dispatch tools
- filesystem: remote read/write/edit helpers for host-dispatch
- preview links: bridge `/healthz`, `/auth`, `/runs`, and SSE streaming

The chat transport after boot is still:
- sandbox-local `pi` bridge over HTTP
- Pi SDK inside that bridge for actual agent execution
- app server relay over SSE
- browser `EventSource` to the app server

## Next steps

1. add direct terminal attach if the Daytona preview/CLI workflow is not enough
2. add repo upload/sync for local-only repos
3. add quotas/billing and a proper hosted secret manager before opening usage broadly
