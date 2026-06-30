# Backend container for DigitalOcean App Platform.
# The Daytona sandbox image lives in image/Dockerfile; this one runs the control server.

FROM node:22-bookworm-slim

WORKDIR /app
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY src ./src
COPY frontend ./frontend
COPY scripts ./scripts
COPY packages ./packages
COPY image ./image
COPY vite.config.js ./vite.config.js
COPY README.md ./README.md
RUN npm run build && npm prune --omit=dev --no-audit --no-fund
ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "start"]
