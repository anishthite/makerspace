# Tiny Daytona snapshot for makerspace bridge runs.
# ponytail: one npm prefix does Pi CLI, bridge SDK, and cloud packages.

FROM node:22-bookworm-slim

ENV HOME=/home/daytona \
    PATH=/home/daytona/.local/bin:/usr/local/bin:/usr/bin:/bin \
    PI_SKIP_VERSION_CHECK=1

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /home/daytona/.pi/agent/npm /home/daytona/.pi/agent/git/github.com/DietrichGebert /workspace /srv

COPY package.json /home/daytona/.pi/agent/npm/package.json

RUN npm install --prefix /home/daytona/.pi/agent/npm --no-audit --no-fund --omit=dev --ignore-scripts --legacy-peer-deps && \
    ln -sf /home/daytona/.pi/agent/npm/node_modules/.bin/pi /usr/local/bin/pi && \
    git clone --depth 1 https://github.com/DietrichGebert/ponytail.git \
      /home/daytona/.pi/agent/git/github.com/DietrichGebert/ponytail && \
    pi --version && \
    node -p 'require("/home/daytona/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/package.json").version' && \
    npm cache clean --force

WORKDIR /workspace
CMD ["sleep", "infinity"]
