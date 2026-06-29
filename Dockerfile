# Backend container for DigitalOcean App Platform.
# The Daytona sandbox image lives in image/Dockerfile; this one runs the control server.

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY packages ./packages
COPY image ./image
COPY README.md ./README.md

EXPOSE 8080
CMD ["npm", "start"]
