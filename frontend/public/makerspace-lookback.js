(() => {
  const BROWSER_SESSION_KEY = 'spannerBrowserSession';
  const ACTIVE = new Set(['launching', 'queued', 'starting', 'running', 'reconnecting']);
  const state = { sessions: [], filtered: [], selected: '', output: null };

  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    status: $('#status'),
    stats: $('#stats'),
    list: $('#sessions'),
    detail: $('#detail'),
    search: $('#search'),
    statusFilter: $('#status-filter'),
    kindFilter: $('#kind-filter'),
    refresh: $('#refresh'),
    copy: $('#copy'),
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function sessionId() {
    try {
      const legacy = localStorage.getItem('workbenchBrowserSession');
      if (legacy && !localStorage.getItem(BROWSER_SESSION_KEY)) localStorage.setItem(BROWSER_SESSION_KEY, legacy);
      localStorage.removeItem('workbenchBrowserSession');
      let value = localStorage.getItem(BROWSER_SESSION_KEY) || '';
      if (!value) {
        value = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, '0')).join('-');
        localStorage.setItem(BROWSER_SESSION_KEY, value);
      }
      return value;
    } catch {
      return '';
    }
  }

  async function fetchJson(path) {
    const headers = { 'x-spanner-session': sessionId() };
    const response = await fetch(path, { credentials: 'include', headers });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.trim() || `Request failed: ${response.status}`);
    }
    if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
    return payload;
  }

  function statusOf(session) {
    return String(session.runStatus || session.status || 'unknown').trim().toLowerCase() || 'unknown';
  }

  function kindOf(session) {
    if (session.threadBridge) return 'thread';
    if (session.hostDispatchMode) return 'host';
    if (session.localMode) return 'local';
    if (session.bridgeMode) return 'bridge';
    return 'session';
  }

  function promptOf(session) {
    return String(session.initialPrompt || session.taskPrompt || '').trim();
  }

  function titleOf(session) {
    const prompt = promptOf(session).split(/\r?\n/).find(Boolean) || '';
    return String(session.title || prompt || session.name || 'untitled').trim();
  }

  function repoOf(session) {
    return String(session.repoPath || session.repoUrl || session.cloudflareSandboxName || session.sandboxId || 'no repo').trim();
  }

  function compactRepo(value) {
    const text = String(value || '').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const parts = text.split(/[\\/]+/).filter(Boolean);
    return parts.slice(-3).join('/') || text || 'no repo';
  }

  function dateMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
  }

  function formatDate(value) {
    const ms = dateMs(value);
    return ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  }

  function ageLabel(value) {
    const ms = dateMs(value);
    if (!ms) return 'unknown age';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    return `${Math.round(diff / 86_400_000)}d ago`;
  }

  function msBetween(start, end) {
    const left = dateMs(start);
    const right = dateMs(end);
    return left && right && right >= left ? right - left : 0;
  }

  function durationLabel(ms) {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
  }

  function threadUrl(name) {
    return `/thread.html?${new URLSearchParams({ name })}`;
  }

  function searchable(session) {
    return [session.name, titleOf(session), promptOf(session), repoOf(session), session.branch, statusOf(session), kindOf(session)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function stat(label, value) {
    return `<article class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  }

  function renderStats() {
    const rows = state.sessions;
    const statuses = rows.map(statusOf);
    const updated = rows.reduce((latest, session) => Math.max(latest, dateMs(session.updatedAt || session.createdAt)), 0);
    nodes.stats.innerHTML = [
      stat('total', rows.length),
      stat('active', statuses.filter((value) => ACTIVE.has(value)).length),
      stat('done', statuses.filter((value) => value === 'completed' || value === 'ready').length),
      stat('failed', statuses.filter((value) => value === 'failed' || value === 'error').length),
      stat('archived', rows.filter((session) => session.archivedAt).length),
      stat('latest', updated ? ageLabel(updated) : '—'),
    ].join('');
  }

  function renderStatusOptions() {
    const selected = nodes.statusFilter.value;
    const statuses = [...new Set(state.sessions.map(statusOf))].sort();
    nodes.statusFilter.innerHTML = '<option value="">all statuses</option>' + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('');
    nodes.statusFilter.value = statuses.includes(selected) ? selected : '';
  }

  function renderList() {
    const query = nodes.search.value.trim().toLowerCase();
    const status = nodes.statusFilter.value;
    const kind = nodes.kindFilter.value;
    state.filtered = state.sessions.filter((session) => {
      if (query && !searchable(session).includes(query)) return false;
      if (status && statusOf(session) !== status) return false;
      if (kind === 'archived') return Boolean(session.archivedAt);
      if (kind === 'thread') return kindOf(session) === 'thread';
      if (kind === 'session') return kindOf(session) !== 'thread';
      return true;
    });

    nodes.status.textContent = `${state.filtered.length} shown · ${state.sessions.length} saved`;
    nodes.list.innerHTML = state.filtered.length ? state.filtered.map((session) => {
      const statusValue = statusOf(session);
      const repo = compactRepo(repoOf(session));
      const name = String(session.name || '');
      return `<button class="session-row" type="button" data-name="${escapeHtml(name)}" aria-selected="${name === state.selected}">
        <span class="session-title"><strong title="${escapeHtml(titleOf(session))}">${escapeHtml(titleOf(session))}</strong><span class="badge ${escapeHtml(statusValue)}">${escapeHtml(statusValue)}</span></span>
        <span class="repo" title="${escapeHtml(repoOf(session))}">${escapeHtml(repo)}${session.branch ? ` · ${escapeHtml(session.branch)}` : ''}</span>
        <span class="prompt-line">${escapeHtml(promptOf(session).slice(0, 180) || session.name || '')}</span>
        <span class="meta-line">${escapeHtml(kindOf(session))}${session.archivedAt ? ' · archived' : ''} · updated ${escapeHtml(ageLabel(session.updatedAt || session.createdAt))}</span>
      </button>`;
    }).join('') : '<p class="empty">No sessions match.</p>';
  }

  function metaGrid(session) {
    const duration = session.durationMs || msBetween(session.createdAt, session.completedAt || session.endedAt || session.updatedAt);
    const values = [
      ['name', session.name],
      ['status', statusOf(session)],
      ['kind', kindOf(session)],
      ['repo', repoOf(session)],
      ['branch', session.branch || '—'],
      ['model', session.modelRef || session.model || '—'],
      ['created', formatDate(session.createdAt)],
      ['updated', formatDate(session.updatedAt)],
      ['duration', durationLabel(Number(duration) || 0)],
    ];
    return `<section class="grid">${values.map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</section>`;
  }

  function messageText(message) {
    return String(message?.text || message?.content || '').trim();
  }

  function renderMessages(session) {
    const messages = Array.isArray(session.threadMessages) ? session.threadMessages : [];
    if (!messages.length) return '';
    return `<h3 class="section-title">thread messages</h3>${messages.map((message) => `<article class="message"><span class="role">${escapeHtml(message.role || 'message')} · ${escapeHtml(formatDate(message.timestamp))}</span><p>${escapeHtml(messageText(message))}</p></article>`).join('')}`;
  }

  function eventSummary(event = {}) {
    return String(event.message || event.detail || event.toolName || event.workflowRunId || event.warning || event.chunk || event.output || '').trim().slice(0, 180);
  }

  function renderEvents(events = []) {
    const rows = events.slice(-80).reverse();
    if (!rows.length) return '';
    return `<h3 class="section-title">recent events</h3><table class="events"><thead><tr><th>time</th><th>type</th><th>status</th><th>detail</th></tr></thead><tbody>${rows.map((event) => `<tr><td>${escapeHtml(formatDate(event.timestamp))}</td><td>${escapeHtml(event.type || 'event')}</td><td>${escapeHtml(event.runStatus || '')}</td><td>${escapeHtml(eventSummary(event))}</td></tr>`).join('')}</tbody></table>`;
  }

  function visibleText(session, output) {
    const messages = Array.isArray(session.threadMessages) ? session.threadMessages.map((message) => `${message.role || 'message'}: ${messageText(message)}`).join('\n\n') : '';
    return [promptOf(session) ? `prompt:\n${promptOf(session)}` : '', messages, output?.chunk ? `output:\n${output.chunk}` : ''].filter(Boolean).join('\n\n---\n\n');
  }

  function renderDetail(session, output = null, error = '') {
    const prompt = promptOf(session);
    const chunk = String(output?.chunk || '').trim();
    const events = Array.isArray(output?.events) ? output.events : [];
    const name = String(session.name || '');
    nodes.copy.disabled = !prompt && !chunk && !session.threadMessages?.length;
    nodes.detail.innerHTML = `<div class="detail-head">
      <div><h2>${escapeHtml(titleOf(session))}</h2><p class="muted">${escapeHtml(compactRepo(repoOf(session)))} · ${escapeHtml(formatDate(session.updatedAt || session.createdAt))}</p></div>
      <div class="detail-actions">${session.threadBridge && name ? `<a class="badge" href="${escapeHtml(threadUrl(name))}">open thread</a>` : ''}<span class="badge ${escapeHtml(statusOf(session))}">${escapeHtml(statusOf(session))}</span></div>
    </div>
    ${metaGrid(session)}
    ${session.warning || output?.warning || error ? `<pre>${escapeHtml(session.warning || output?.warning || error)}</pre>` : ''}
    ${prompt ? `<h3 class="section-title">prompt</h3><pre>${escapeHtml(prompt)}</pre>` : ''}
    ${renderMessages(session)}
    ${chunk ? `<h3 class="section-title">retained output${output?.truncated ? ' · truncated' : ''}</h3><pre>${escapeHtml(chunk)}</pre>` : ''}
    ${renderEvents(events)}
    ${!prompt && !chunk && !events.length ? '<p class="empty">No retained output for this session.</p>' : ''}`;
  }

  async function selectSession(name, { updateHash = true } = {}) {
    const session = state.sessions.find((row) => row.name === name);
    if (!session) return;
    state.selected = name;
    state.output = null;
    if (updateHash) history.replaceState(null, '', `#${encodeURIComponent(name)}`);
    renderList();
    renderDetail(session, null, 'Loading retained output…');
    try {
      state.output = await fetchJson(`/api/sessions/${encodeURIComponent(name)}/output`);
      renderDetail(state.output.session || session, state.output);
    } catch (error) {
      renderDetail(session, null, error.message);
    }
  }

  async function load() {
    nodes.refresh.disabled = true;
    nodes.status.textContent = 'Loading saved sessions…';
    try {
      const payload = await fetchJson('/api/sessions');
      state.sessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
        .sort((left, right) => dateMs(right.updatedAt || right.createdAt) - dateMs(left.updatedAt || left.createdAt));
      renderStats();
      renderStatusOptions();
      const hashName = decodeURIComponent(location.hash.replace(/^#/, ''));
      const nextSelected = state.sessions.find((session) => session.name === (state.selected || hashName))?.name || state.sessions[0]?.name || '';
      renderList();
      if (nextSelected) await selectSession(nextSelected, { updateHash: Boolean(location.hash || state.selected) });
      else nodes.detail.innerHTML = '<p class="empty">No saved sessions yet.</p>';
    } catch (error) {
      nodes.status.textContent = error.message;
      nodes.list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
      nodes.detail.innerHTML = '<p class="empty">Could not load sessions.</p>';
    } finally {
      nodes.refresh.disabled = false;
    }
  }

  nodes.list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-name]');
    if (row) void selectSession(row.dataset.name);
  });
  nodes.search.addEventListener('input', renderList);
  nodes.statusFilter.addEventListener('change', renderList);
  nodes.kindFilter.addEventListener('change', renderList);
  nodes.refresh.addEventListener('click', load);
  nodes.copy.addEventListener('click', async () => {
    const session = state.sessions.find((row) => row.name === state.selected);
    if (!session) return;
    try {
      await navigator.clipboard.writeText(visibleText(state.output?.session || session, state.output));
      nodes.status.textContent = 'Copied visible session text.';
    } catch (error) {
      nodes.status.textContent = error.message || 'Clipboard copy failed.';
    }
  });
  addEventListener('hashchange', () => {
    const name = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (name && name !== state.selected) void selectSession(name, { updateHash: false });
  });

  void load();
})();
