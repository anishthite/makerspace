# Cloudflare Sandbox runtime for Spanner bridge runs.
# ponytail: bake Pi + defaults; setup stays idempotent for secrets and repo state.

FROM docker.io/cloudflare/sandbox:0.12.3

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]
ENV HOME=/home/root \
    PATH=/home/root/.local/bin:/usr/local/bin:/usr/bin:/bin \
    PI_SKIP_VERSION_CHECK=1

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git jq util-linux && \
    if ! command -v node >/dev/null 2>&1; then \
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs; \
    fi && \
    if ! command -v gh >/dev/null 2>&1; then \
      mkdir -p -m 755 /etc/apt/keyrings && \
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
      chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gh; \
    fi && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    mkdir -p /home/root/.local/bin /home/root/.pi/agent/npm /home/root/.spanner/control/pi-sessions /workspace

COPY image/package.json /home/root/.pi/agent/npm/package.json
COPY packages/spanner-pi-defaults /home/root/.pi/agent/spanner-pi-defaults

RUN npm install --prefix /home/root/.pi/agent/npm --no-audit --no-fund --omit=dev --ignore-scripts --legacy-peer-deps && \
    ln -sf /home/root/.pi/agent/npm/node_modules/.bin/pi /home/root/.local/bin/pi && \
    ln -sf /home/root/.local/bin/pi /usr/local/bin/pi && \
    settings='{"defaultProvider":"openai-codex","defaultModel":"gpt-5.4","defaultThinkingLevel":"medium","enabledModels":["openai-codex/gpt-5.4","openai-codex/gpt-5.4-mini","inference/nvidia/nemotron3-super"],"packages":["/home/root/.pi/agent/spanner-pi-defaults","npm:pi-chrome"]}' && \
    printf '%s\n' "$settings" > /home/root/.pi/agent/settings.json && \
    git config --system --add safe.directory '*' && \
    git config --system init.defaultBranch main && \
    npm cache clean --force

WORKDIR /workspace
