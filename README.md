# micro cloud v0

A tiny control plane for talking to `pi` inside fresh Daytona sandboxes.

## What this app does

- shows one repo-thread form for a Git repo and starting prompt
- creates a Daytona sandbox, clones the repo or initializes an empty workspace, and starts a tiny Pi bridge service
- uses Daytona preview URLs for the bridge port while the browser only talks to this control backend
- streams live Pi output back to the browser over server-sent events
- supports host-dispatch mode: Pi runs on the control backend while read/bash/edit/write tools execute inside the Daytona sandbox
- keeps image settings, registry push settings, and model-provider API-key forwarding on the settings panel

## What it does not do

- no fake local mode
- no embedded terminal
- no local repo upload or bidirectional file sync
- no auth or multi-user support beyond `CONTROL_API_TOKEN`
- no registry secret manager beyond local plain-text settings

That is deliberate. The goal is one prompt in, one real sandbox-backed run out.

## How the thread flow works

1. the homepage posts `repoUrl`, optional `branch`, optional `name`, and a starting `prompt` to `POST /api/threads`
2. the control backend creates a Daytona sandbox for that repo and starts the sandbox-local Pi bridge
3. the browser redirects to `/thread.html?name=<thread>`
4. the thread page reads `GET /api/threads/:name`, mirrors output from `GET /api/sessions/:name/stream`, and sends follow-up prompts to `POST /api/threads/:name/messages`
5. after each run completes, the same bridge sandbox returns to `ready` so the next prompt can reuse the repo workspace

For deployment, put the static UI on Vercel and this Node control backend on a server with Daytona credentials. The UI has “Control backend URL” and “Control API token” fields; set them to the backend HTTPS URL and `CONTROL_API_TOKEN`. The backend keeps Daytona and model-provider credentials server-side.

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
npm start
```

Optional env vars:

```bash
PORT=8787
CONTROL_API_TOKEN=
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
REMOTE_WORKSPACE_DIR=/srv/workspace
REMOTE_CONTROL_DIR=/srv/micro-cloud
PI_BRIDGE_PORT=4310
PI_BRIDGE_READY_TIMEOUT_MS=240000
PI_BRIDGE_READY_POLL_MS=1000
IDLE_BRIDGE_TTL_MS=3600000
WARM_BRIDGE_POOL_SIZE=0
FORWARD_ENV_KEYS=ANTHROPIC_API_KEY,OPENAI_API_KEY,GOOGLE_API_KEY,GEMINI_API_KEY,OPENROUTER_API_KEY
PI_INSTALL_COMMAND=npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## API

- `GET /healthz`
- `GET /api/report`
- `GET /api/settings`
- `POST /api/settings`
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

Set `CONTROL_API_TOKEN` on public control backends. API clients send it as `Authorization: Bearer <token>`; SSE streams may pass `?token=<token>` because browser `EventSource` cannot set custom headers.

### Create thread body

```json
{
  "repoUrl": "https://github.com/you/repo.git",
  "branch": "main",
  "name": "optional-thread-name",
  "prompt": "Read the repo and make the smallest useful change."
}
```

### Thread message body

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
3. add a proper secret manager if this becomes multi-user
