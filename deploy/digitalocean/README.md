# DigitalOcean control backend

Run the Node control plane on a small Ubuntu droplet. The Vercel UI talks to this API URL.

```bash
sudo adduser --system --group --home /opt/makerspace makerspace
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y git nodejs caddy
sudo git clone <your-repo-url> /opt/makerspace
sudo chown -R makerspace:makerspace /opt/makerspace
cd /opt/makerspace
sudo -u makerspace npm install
sudo cp deploy/digitalocean/makerspace.service /etc/systemd/system/makerspace.service
sudo cp deploy/digitalocean/Caddyfile /etc/caddy/Caddyfile
sudo install -m 600 /dev/null /etc/makerspace.env
```

`/etc/makerspace.env`:

```bash
PORT=8787
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=
DAYTONA_SNAPSHOT=
SESSION_DATA_PATH=/opt/makerspace/data/sessions.json
SETTINGS_DATA_PATH=/opt/makerspace/data/settings.json
PI_HOST_DISPATCH=0
WARM_BRIDGE_POOL_SIZE=0
IDLE_BRIDGE_TTL_MS=3600000
CONTROL_API_TOKEN=replace-with-a-long-random-token
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MAKERSPACE_AUTH_REQUIRED=true
MAKERSPACE_AUTH_SECRET=replace-with-another-long-random-secret
MAKERSPACE_ALLOWED_ORIGIN=https://your-vercel-app.vercel.app
```

In multi-user mode, do not copy personal `~/.pi/agent/auth.json`; model keys should come from backend env forwarding or per-user secret handling.

Replace `api.example.com` in `/etc/caddy/Caddyfile` with your real API domain, then start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now makerspace
sudo systemctl reload caddy
```

Vercel UI: deploy this repo as a static app. In the homepage, set **Control backend URL** to `https://api.example.com`; users sign in with GitHub, while `CONTROL_API_TOKEN` remains an admin bypass.
