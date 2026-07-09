# DigitalOcean control backend

Run the Node control plane on a small Ubuntu droplet. The Vercel UI talks to this API URL.

```bash
sudo adduser --system --group --home /opt/spanner spanner
# Existing Workbench droplet: stop old service, then move /opt/workbench and /etc/workbench.env to these Spanner paths.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y git nodejs caddy
sudo git clone <your-repo-url> /opt/spanner
sudo chown -R spanner:spanner /opt/spanner
cd /opt/spanner
sudo -u spanner npm install
sudo cp deploy/digitalocean/spanner.service /etc/systemd/system/spanner.service
sudo cp deploy/digitalocean/Caddyfile /etc/caddy/Caddyfile
sudo install -m 600 /dev/null /etc/spanner.env
```

`/etc/spanner.env`:

```bash
PORT=8787
NODE_ENV=production
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=
DAYTONA_SNAPSHOT=
SESSION_DATA_PATH=/opt/spanner/data/sessions.json
SETTINGS_DATA_PATH=/opt/spanner/data/settings.json
SPANNER_STATE_STORE=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
PI_HOST_DISPATCH=0
WARM_BRIDGE_POOL_SIZE=0
IDLE_BRIDGE_TTL_MS=3600000
CONTROL_API_TOKEN=replace-with-a-long-random-token
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SPANNER_AUTH_REQUIRED=true
SPANNER_AUTH_SECRET=replace-with-another-long-random-secret
SPANNER_ALLOWED_USERS=your-github-login,teammate-login
SPANNER_ALLOWED_ORIGIN=https://your-vercel-app.vercel.app,https://your-preview.vercel.app
```

In multi-user mode, do not copy personal `~/.pi/agent/auth.json`; model keys should come from backend env forwarding or per-user secret handling.

Replace `api.example.com` in `/etc/caddy/Caddyfile` with your real API domain, then start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spanner
sudo systemctl reload caddy
```

Vercel UI: deploy this repo as a static app with `VITE_SPANNER_API_BASE=https://api.example.com`. Users sign in with GitHub; keep `CONTROL_API_TOKEN` as an admin/API-client bypass only. Put every static frontend URL that should share auth cookies in comma-separated `SPANNER_ALLOWED_ORIGIN`. Keep `SPANNER_ALLOWED_USERS` set until quotas/billing exist. In production, complete Cloudflare D1 env makes the backend persist state across deploys; set `SPANNER_STATE_STORE=file` only for throwaway reset-on-deploy remotes.
