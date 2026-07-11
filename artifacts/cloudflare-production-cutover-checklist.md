# Cloudflare sandbox production cutover checklist

## 1. Cloudflare DNS

In Cloudflare DNS for `spanner.sh`:

- [ ] Add proxied AAAA record: `sandbox` → `100::`
- [ ] Add proxied AAAA record: `*` → `100::`
- [ ] Confirm both records are **Proxied** / orange-clouded

Why:
- `sandbox.spanner.sh` is the broker API URL.
- `*-bridge.spanner.sh` routes Cloudflare Sandbox port URLs, including the Pi bridge.
- `workers.dev` works for basic broker smoke tests, but port exposure needs a custom wildcard domain covered by TLS.

## 2. DigitalOcean backend env

In the DigitalOcean App Platform backend service env vars:

- [ ] Add/update `INFRA_PROVIDER=cloudflare`
- [ ] Add/update `CLOUDFLARE_SANDBOX_BROKER_URL=https://sandbox.spanner.sh`
- [ ] Add/update `CLOUDFLARE_SANDBOX_BROKER_TOKEN=<same value as Worker BROKER_TOKEN>`
- [ ] Add/update `CLOUDFLARE_SANDBOX_MACHINE=standard-2`
- [ ] Add/update `CLOUDFLARE_SANDBOX_SLEEP_AFTER=15m`
- [ ] Add/update `CLOUDFLARE_SANDBOX_KEEPALIVE=true`
- [ ] Add/update `REMOTE_HOME=/home/root`
- [ ] Add/update `REMOTE_WORKSPACE_DIR=/workspace`
- [ ] Add/update `REMOTE_CONTROL_DIR=/home/root/.spanner/control`
- [ ] Add/update `REMOTE_PI_DEFAULTS_PACKAGE_DIR=/home/root/.pi/agent/spanner-pi-defaults`
- [ ] Add/update `SPANNER_ALLOWED_ORIGIN=https://spanner.sh,https://www.spanner.sh`
- [ ] Remove all `DAYTONA_*` env vars

Do **not** put `CLOUDFLARE_SANDBOX_BROKER_TOKEN` in Vercel.

## 3. Vercel frontend env

In Vercel project env vars:

- [ ] Confirm `VITE_SPANNER_API_BASE=https://api.spanner.sh`

## 4. Push/deploy

- [ ] Review the repo diff before merge/push
- [ ] Push to `main`
- [ ] Wait for DigitalOcean backend auto-deploy
- [ ] Wait for Vercel frontend auto-deploy, if applicable

## 5. Smoke tests

From a terminal:

- [ ] `curl https://api.spanner.sh/healthz`
- [ ] `curl -H "Authorization: Bearer <broker-token>" https://sandbox.spanner.sh/healthz`

In Spanner UI:

- [ ] Start one blank remote thread
- [ ] Start one private GitHub repo thread
- [ ] Confirm it launches a Cloudflare sandbox, not Daytona
- [ ] Run a prompt that checks `pwd`, `node --version`, `git status`
- [ ] Confirm streaming/bridge output works
- [ ] Suspend the thread
- [ ] Resume the thread
- [ ] Confirm files/state survive via backup/restore
- [ ] Delete the thread and confirm backup-before-delete succeeds

## 6. If something fails

- [ ] If `sandbox.spanner.sh` does not resolve, fix DNS/proxy first
- [ ] If broker health returns `401`, the token is wrong/mismatched
- [ ] If port/bridge URLs fail, check wildcard DNS: `*.spanner.sh` (`*` → `100::`, proxied)
- [ ] If backend still mentions Daytona, remove stale `DAYTONA_*` env vars and redeploy
