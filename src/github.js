export const GITHUB_OAUTH_SCOPES = ['repo', 'read:user', 'workflow'];
export const GITHUB_REMOTE_GIT_SCOPES = ['repo', 'workflow'];

export function missingGitHubOAuthScopes(record, requiredScopes = GITHUB_REMOTE_GIT_SCOPES) {
  const granted = new Set((Array.isArray(record?.scopes) ? record.scopes : [])
    .map((scope) => String(scope || '').trim().toLowerCase())
    .filter(Boolean));
  return requiredScopes.filter((scope) => !granted.has(String(scope).toLowerCase()));
}

const GITHUB_REPO_PAGE_CONCURRENCY = 4;

function githubHeaders(token, extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'spanner',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchGitHubJsonResponse(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: githubHeaders(options.token, options.headers || {}),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.message || `GitHub request failed: ${response.status}`);
  }

  return { payload, response };
}

async function fetchGitHubJson(url, options = {}) {
  return (await fetchGitHubJsonResponse(url, options)).payload;
}

function lastPageFromLinkHeader(header) {
  const match = String(header || '').split(',').find((part) => /rel="last"/i.test(part))?.match(/<([^>]+)>/);
  if (!match) return 0;
  try {
    const page = Number(new URL(match[1]).searchParams.get('page'));
    return Number.isFinite(page) && page > 1 ? Math.floor(page) : 0;
  } catch {
    return 0;
  }
}

function githubReposUrl(page) {
  return `https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}`;
}

async function fetchGitHubRepoPages(token, pages) {
  const repos = [];
  for (let index = 0; index < pages.length; index += GITHUB_REPO_PAGE_CONCURRENCY) {
    const batchPages = pages.slice(index, index + GITHUB_REPO_PAGE_CONCURRENCY);
    const batches = await Promise.all(batchPages.map((page) => fetchGitHubJson(githubReposUrl(page), { token })));
    repos.push(...batches.flat().map(normalizeGitHubRepo));
  }
  return repos;
}

export function githubAuthConfigured(config) {
  return Boolean(config.githubClientId && config.githubClientSecret);
}

export function buildGitHubAuthorizeUrl(config, redirectUri, state) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', GITHUB_OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGitHubCode(config, code, redirectUri) {
  const payload = await fetchGitHubJson('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const token = String(payload.access_token || '').trim();
  if (!token) throw new Error(payload.error_description || 'GitHub did not return an access token.');
  return token;
}

export async function fetchGitHubUser(token) {
  const user = await fetchGitHubJson('https://api.github.com/user', { token });
  return {
    id: user.id,
    login: user.login,
    name: user.name || null,
    avatarUrl: user.avatar_url || null,
  };
}

export function normalizeGitHubRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: Boolean(repo.private),
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch || null,
    visibility: repo.private ? 'private' : repo.visibility || 'public',
    owner: repo.owner?.login || null,
  };
}

export async function listGitHubRepos(token) {
  const first = await fetchGitHubJsonResponse(githubReposUrl(1), { token });
  const repos = first.payload.map(normalizeGitHubRepo);
  const lastPage = lastPageFromLinkHeader(first.response.headers?.get?.('link'));

  if (lastPage > 1) {
    repos.push(...await fetchGitHubRepoPages(token, Array.from({ length: lastPage - 1 }, (_, index) => index + 2)));
  } else {
    let page = 2;
    while (first.payload.length >= 100) {
      const batch = await fetchGitHubJson(githubReposUrl(page), { token });
      repos.push(...batch.map(normalizeGitHubRepo));
      if (batch.length < 100) break;
      page += 1;
    }
  }

  repos.sort((left, right) => left.fullName.localeCompare(right.fullName));
  return repos;
}

export function parseGitHubRepoUrl(repoUrl) {
  const text = String(repoUrl || '').trim();
  const sshMatch = text.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  try {
    const url = new URL(text);
    if (!/^github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

export async function fetchGitHubRepo(token, repoUrl) {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) return null;
  const repo = await fetchGitHubJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { token });
  return normalizeGitHubRepo(repo);
}

export async function createGitHubPullRequest(token, repoPath, pullRequest = {}) {
  const owner = String(repoPath?.owner || '').trim();
  const repo = String(repoPath?.repo || '').trim();
  if (!owner || !repo) throw new Error('GitHub repository owner and name are required.');

  const payload = await fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    token,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: pullRequest.title,
      head: pullRequest.head,
      base: pullRequest.base,
      body: pullRequest.body || '',
      draft: pullRequest.draft !== false,
      maintainer_can_modify: true,
    }),
  });

  return {
    number: payload.number,
    url: payload.html_url,
    apiUrl: payload.url,
    title: payload.title,
    state: payload.state,
    draft: Boolean(payload.draft),
    head: payload.head?.ref || pullRequest.head,
    base: payload.base?.ref || pullRequest.base,
  };
}

export function buildGitHubCloneAuthHeader(token) {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}
