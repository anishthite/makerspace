function githubHeaders(token, extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'makerspace',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchGitHubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: githubHeaders(options.token, options.headers || {}),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.message || `GitHub request failed: ${response.status}`);
  }

  return payload;
}

export function githubAuthConfigured(config) {
  return Boolean(config.githubClientId && config.githubClientSecret);
}

export function buildGitHubAuthorizeUrl(config, redirectUri, state) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'repo read:user');
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
  const repos = [];
  let page = 1;

  while (page <= 4) {
    const batch = await fetchGitHubJson(`https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}`, { token });
    repos.push(...batch.map(normalizeGitHubRepo));
    if (batch.length < 100) break;
    page += 1;
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

export function buildGitHubCloneAuthHeader(token) {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}
