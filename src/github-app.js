import { createSign } from 'node:crypto';

import { parseGitHubRepoUrl } from './github.js';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function appPrivateKey(config) {
  return String(config.githubAppPrivateKey || '').replace(/\\n/g, '\n').trim();
}

export function githubAppConfigured(config = {}) {
  return Boolean(config.githubAppId && appPrivateKey(config));
}

export function githubAppInstallConfigured(config = {}) {
  return Boolean(config.githubAppSlug && githubAppConfigured(config));
}

export function buildGitHubAppInstallUrl(config = {}, state = '') {
  if (!githubAppInstallConfigured(config)) return '';
  const url = new URL(`https://github.com/apps/${config.githubAppSlug}/installations/new`);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

export function buildGitHubAppJwt(config = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!githubAppConfigured(config)) throw new Error('Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY.');
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64urlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(config.githubAppId),
  });
  const body = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(body).end().sign(appPrivateKey(config)).toString('base64url');
  return `${body}.${signature}`;
}

function githubAppHeaders(config, extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${buildGitHubAppJwt(config)}`,
    'user-agent': 'spanner',
    ...extra,
  };
}

async function fetchGitHubAppJson(config, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: githubAppHeaders(config, options.headers || {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `GitHub App request failed: ${response.status}`);
  return payload;
}

export async function fetchGitHubAppInstallation(config, installationId) {
  const id = String(installationId || '').trim();
  if (!id) throw new Error('GitHub App installation id is required.');
  return fetchGitHubAppJson(config, `https://api.github.com/app/installations/${encodeURIComponent(id)}`);
}

export async function createGitHubAppInstallationToken(config, installationId) {
  const id = String(installationId || '').trim();
  if (!id) throw new Error('GitHub App installation id is required.');
  const payload = await fetchGitHubAppJson(config, `https://api.github.com/app/installations/${encodeURIComponent(id)}/access_tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const token = String(payload.token || '').trim();
  if (!token) throw new Error('GitHub App did not return an installation token.');
  return { token, expiresAt: payload.expires_at || null };
}

export function githubRepoOwner(repoUrl) {
  return parseGitHubRepoUrl(repoUrl)?.owner?.toLowerCase() || '';
}
