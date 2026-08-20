# Spanner v0

A tiny control plane for talking to `pi` inside Cloudflare Sandboxes.

Tiny README smoke-test edit: repository writes are working.

## What this app does

- shows one repo-agent form for a Git repo and starting prompt
- creates a Cloudflare Sandbox through a Worker broker, clones the repo or initializes an empty workspace, and starts a tiny Pi bridge service
- exposes the bridge port through Cloudflare sandbox URLs while the browser only talks to this control backend
- streams live Pi output back to the browser over server-sent events
- supports host-dispatch mode: Pi runs on the control backend while read/bash/edit/write tools execute inside the Cloudflare sandbox
- backs up `/workspace` and Pi session traces through Cloudflare Sandbox backups before suspend/delete
- supports GitHub sign-in with user-scoped sessions, recent projects, repo listing, and private-repo clone auth

## What it does not do

- no embedded terminal
- no local repo upload or bidirectional file sync
- no email/password auth; GitHub OAuth is the sign-in path
- no registry secret manager beyond local plain-text settings

That is deliberate. The goal is one prompt in, one real sandbox-backed run out.

## How the agent flow works

1. the homepage posts `repoUrl`, optional `branch`, optional `name`, and a starting `prompt` to `POST /api/threads`
2. the control backend asks the Cloudflare broker Worker to create a sandbox and starts the sandbox-local Pi bridge
3. the browser redirects to `/thread.html?name=<agent>`
4. the agent page reads `GET /api/threads/:name`, mirrors output from `GET /api/sessions/:name/stream`, and sends follow-up prompts to `POST /api/threads/:name/messages`
5. after each run completes, the same bridge sandbox returns to `ready` so the next prompt can reuse the repo workspace

For deployment, put the built React/Vite static UI (`npm run build` → `dist/`) on Vercel, this Node control backend on a server, and the broker in `cloudflare-sandbox-worker/` on Cloudflare Workers. Set the frontend env `VITE_SPANNER_API_BASE=https://api.example.com` in Vercel. The backend keeps Cloudflare and broker credentials server-side.

Hosted users sign in with GitHub for their Spanner account. Settings → Codex stores their own ChatGPT Plus/Pro Codex OAuth for Pi; Settings → Claude Code stores their Claude Pro/Max OAuth. Do not set shared model API keys in Vercel or DigitalOcean for hosted OAuth runs.

## Workbench → Spanner migration

On first local startup, the default data dir moves from `~/.workbench` to `~/.spanner` when `SPANNER_HOME` is unset and the new dir does not exist. D1 startup creates `spanner_sessions`/`spanner_kv` and copies rows from old `workbench_sessions`/`workbench_kv` when those tables exist.

DigitalOcean App Platform can build the root `Dockerfile` for the control backend. Keep the source directory at `/`, use the Dockerfile build strategy, and set the public HTTP port to `8080`. `image/Dockerfile` is the separate Cloudflare sandbox runtime image referenced by the Worker broker. Set backend env `SPANNER_ALLOWED_ORIGIN=https://your-vercel-app.vercel.app` so cross-origin GitHub-auth cookies work; use commas for multiple frontend origins.

## Cloudflare sandbox runtime

The sandbox runtime is deployed by the broker Worker, not built per launch:

```bash
cd cloudflare-sandbox-worker
npm install
wrangler secret put BROKER_TOKEN
wrangler deploy
```

Then point the Node backend at it:

```bash
INFRA_PROVIDER=cloudflare \
CLOUDFLARE_SANDBOX_BROKER_URL=https://spanner-sandbox-broker.example.com \
CLOUDFLARE_SANDBOX_BROKER_TOKEN=<same token> \
npm start
```

`image/Dockerfile` bakes Node, git, Pi, and `packages/spanner-pi-defaults` into the Cloudflare container. The runtime setup script still stays idempotent: it syncs secrets, repo auth, bridge files, and workspace state on each launch.

## Repo support

This version supports:
- remote Git repos the sandbox can clone
- blank repos created on first boot

This version does not support:
- local-only unpushed repos
- bidirectional file sync

## Run locally

Prereqs:
- the Cloudflare broker Worker is deployed and reachable from this backend
- either your model-provider API keys are exported locally, or your local `~/.pi/agent/auth.json` already has working Pi auth the server can send to bridge sandboxes

Then:

```bash
npm install
npm run build # emits the React/Vite static frontend into dist/
npm start
```

The default local backend URL is `http://localhost:8788`; register GitHub OAuth callbacks as `http://localhost:8788/api/auth/github/callback`.

`frontend/` is the normal Vite app. Root `src/` is the Node backend/API runtime for Cloudflare, local provider, sessions, SSE, and settings. Build `dist/` before starting the backend.

For local-folder mode, run Pi directly on a folder:

```bash
INFRA_PROVIDER=local npm start
npm run desktop:dev
```

Run multiple local projects by giving each process its own port and state folder:

```bash
INFRA_PROVIDER=local SPANNER_PROJECT=site SPANNER_HOME=~/.spanner/site PORT=8788 npm start
INFRA_PROVIDER=local SPANNER_PROJECT=api  SPANNER_HOME=~/.spanner/api  PORT=8789 npm start
```

Desktop dev accepts a folder argument and uses that folder name in the header:

```bash
npm run desktop:dev -- ~/code/site
npm run desktop:dev -- ~/code/api
```

## Optional env vars

```bash
PORT=8788
INFRA_PROVIDER=cloudflare # or local
SPANNER_PROJECT=site
SPANNER_HOME=~/.spanner/site
SPANNER_WORKTREE_BASE_DIR=~/spanner # default base for local agent worktrees: <base>/<repo>/<workspace>
SPANNER_WORKTREE_DIR= # optional exact root for every repo
CONTROL_API_TOKEN=
VITE_SPANNER_API_BASE= # frontend build env only; backend HTTPS origin
VITE_POSTHOG_KEY= # optional; enables product analytics
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_PROJECT_ID= # optional bookkeeping; JS SDK uses the project token
VITE_POSTHOG_REPLAY_ENABLED= # set 1 to enable masked DOM replay by default
VITE_POSTHOG_DISABLED= # set 1 to force-disable frontend analytics
SPANNER_AUTH_REQUIRED= # set true to require GitHub sign-in even outside hosted mode
SPANNER_AUTH_SECRET= # stable secret for signed auth cookies and encrypted OAuth tokens
SPANNER_ALLOWED_USERS= # optional comma-separated GitHub logins/ids for private beta access
SPANNER_ALLOWED_ORIGIN= # static frontend origin(s) for cross-origin cookie auth; comma-separated list is OK
SPANNER_AUTH_SAMESITE= # defaults to None when SPANNER_ALLOWED_ORIGIN is set, otherwise Lax
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID= # optional; enables short-lived installation tokens for sandbox git
GITHUB_APP_SLUG= # e.g. your-app-name; setup URL should be /api/auth/github/app/callback
GITHUB_APP_PRIVATE_KEY= # PEM, or PEM with \n escapes
INFERENCE_API_KEY= # enables Inference.net aliases in the Pi model picker
AUTH_DATA_PATH=./data/auth.json
SPANNER_STATE_STORE= # production auto-selects d1 when Cloudflare D1 env is complete; set file for disposable state
SPANNER_WORKSPACE_MODE= # set true to reuse one remote workspace per signed-in user + repo
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_SANDBOX_BROKER_URL=
CLOUDFLARE_SANDBOX_BROKER_TOKEN=
CLOUDFLARE_SANDBOX_MACHINE=standard-2
CLOUDFLARE_SANDBOX_SLEEP_AFTER=15m
CLOUDFLARE_SANDBOX_KEEPALIVE=true # active sandboxes stay warm; idle thread sandboxes auto-suspend after THREAD_BRIDGE_IDLE_TTL_MS
THREAD_BRIDGE_IDLE_TTL_MS=900000 # 15m default; set 0 to disable idle thread auto-suspend
SETTINGS_DATA_PATH=./data/settings.json
RECENT_PROJECTS_DATA_PATH=./data/recent-projects.json
PI_SESSION_TRACE_DIR=./data/pi-sessions
PI_CODING_AGENT_DIR=~/.pi/agent
PI_PROFILE_DATA_PATH=./data/pi-profile.json
SPANNER_PI_DEFAULTS_PACKAGE_DIR=./packages/spanner-pi-defaults
REMOTE_WORKSPACE_DIR=/workspace
REMOTE_CONTROL_DIR=/home/root/.spanner/control
REMOTE_PI_DEFAULTS_PACKAGE_DIR=/home/root/.pi/agent/spanner-pi-defaults
PI_BRIDGE_PORT=4310
PI_BRIDGE_READY_TIMEOUT_MS=240000
PI_BRIDGE_READY_POLL_MS=1000
IDLE_BRIDGE_TTL_MS=3600000
WARM_BRIDGE_POOL_SIZE=0
PI_BRIDGE_STREAM_STALL_MS=60000
PI_BRIDGE_RUN_MISSING_GRACE_MS=30000
FORWARD_ENV_KEYS=GH_TOKEN,GITHUB_TOKEN,ANTHROPIC_API_KEY,OPENAI_API_KEY,GOOGLE_API_KEY,GEMINI_API_KEY,OPENROUTER_API_KEY,INFERENCE_API_KEY
PI_INSTALL_COMMAND=npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

### Git auth inside sandboxes

Sandboxes get full `git` and `gh` CLI auth so agents can push branches and open PRs:

- The setup script installs the GitHub CLI (`gh`) when missing and configures system-level git credential helpers (`store` plus `gh auth git-credential`), `safe.directory`, and a fallback commit identity.
- On every bridge auth sync, the server forwards a GitHub token to the sandbox: a short-lived GitHub App installation token when the repo owner has installed the app, otherwise the signed-in user's GitHub OAuth token with `repo` + `workflow` scopes in multi-user mode, or `GH_TOKEN`/`GITHUB_TOKEN` from the server environment otherwise. The bridge writes `~/.git-credentials` and `~/.gitconfig` and exports `GH_TOKEN`/`GITHUB_TOKEN` for agent commands.
- Private GitHub clones use the same per-user token during Cloudflare setup, including pasted `github.com` URLs; old OAuth tokens missing `workflow` require reconnect before remote git auth is synced, and the raw token is stripped before sessions are persisted.

For hosted App Platform deployments, set the three Cloudflare D1 values above; production automatically uses D1 unless `SPANNER_STATE_STORE=file` is set. D1 stores sessions, settings, recent projects, Dockerfile text, and Pi profile choices/text; repo files live in Git, Cloudflare sandbox backups, or local disk.

## Pi defaults package

Spanner ships a starter Pi package at `packages/spanner-pi-defaults`. Local and host-dispatch SDK runs load it directly when the directory exists. The Cloudflare runtime image copies it into the sandbox at `REMOTE_PI_DEFAULTS_PACKAGE_DIR`, and the remote bridge loads that baked copy without touching user dotfiles.

The package contains a prompt-injecting extension, starter skills, and prompts. Publish the same package later for online installs with `pi install npm:@spanner/pi-defaults@0.1.0`.

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
- `POST /api/threads/:name/suspend`
- `POST /api/threads/:name/resume`
- `POST /api/threads/:name/delete`
- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/bridge-intents`
- `POST /api/chat`
- `GET /api/sessions/:name/stream`
- `GET /api/sessions/:name/output`
- `POST /api/sessions/:name/share`

For single-user/token mode, set `CONTROL_API_TOKEN`; API clients send it as `Authorization: Bearer <token>`. The hosted browser path uses GitHub sign-in cookies; do not expose `CONTROL_API_TOKEN` in Vercel frontend env or URLs.

## Notes on Cloudflare Sandboxes

The lifecycle transport is a Worker broker around `@cloudflare/sandbox`:
- sandbox lifecycle: create, delete, suspend via backup+destroy, resume via create+restore
- process execution: setup script, manual Pi runs, log polling, host-dispatch tools
- filesystem: remote read/write/edit helpers for host-dispatch
- network: bridge `/healthz`, `/auth`, `/runs`, and SSE streaming through exposed ports or tunnels

The chat transport after boot is still:
- sandbox-local `pi` bridge over HTTP
- Pi SDK inside that bridge for actual agent execution
- app server relay over SSE
- browser `EventSource` to the app server

## Next steps

1. add direct terminal attach if the broker workflow is not enough
2. add repo upload/sync for local-only repos
3. add quotas/billing and a proper hosted secret manager before opening usage beyond an allowlisted beta
