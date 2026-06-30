export function ProjectPage() {
  return <main className="project-shell">
    <nav className="home-topbar" aria-label="Makerspace navigation">
      <a className="brand" href="/" aria-label="Makerspace projects">
        <img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span>makerspace</span>
        <span id="project-label" className="project-pill" hidden></span>
      </a>
      <div className="header-actions home-actions">
        <a id="codex-auth-pill" className="auth-pill" href="/settings.html#codex" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="codex-auth-label">codex</span></a>
        <a id="github-auth-pill" className="auth-pill" href="/settings.html#github" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="github-auth-label">github</span></a>
        <a className="textbtn" href="/settings.html">settings</a>
      </div>
    </nav>

    <header className="project-hero">
      <h1>Welcome back, Anish.</h1>
      <p className="lede">Choose a local folder on this Mac, or pick a GitHub repo for cloud mode. The agent page stays scoped to it.</p>
    </header>

    <section className="project-grid">
      <form id="project-form" className="project-card" aria-label="Select project">
        <input id="project-repo-source" name="repoSource" type="hidden" value="" readOnly />
        <input id="project-branch" name="branch" type="hidden" value="" readOnly />
        <label className="sr-only" htmlFor="project-repo-url">folder or repo</label>
        <div className="target-input project-target repo-input">
          <input id="project-repo-url" name="repoUrl" placeholder="/Users/you/project" aria-label="folder or repo" required />
          <button id="project-choose-folder" className="textbtn folder-picker-btn" type="button" hidden aria-label="choose local folder" title="choose local folder">choose folder</button>
        </div>
        <div id="project-repo-tray" className="repo-tray">
          <select id="project-repo-picker" className="board-select" disabled><option value="">GitHub repos</option></select>
          <button id="project-repo-refresh" className="textbtn" type="button">refresh</button>
          <p id="project-repo-hint" className="muted">Choose a local folder or paste a repo.</p>
        </div>
        <button id="project-submit" className="primary-btn" type="submit">open workspace</button>
        <p id="project-status" className="status-line">Select a project to continue.</p>
      </form>
      <section className="project-card recent-projects" aria-label="Recent projects">
        <div className="section-row"><div><h2>Recent projects</h2><p className="muted">One click back into a workspace.</p></div></div>
        <div id="project-recent-list" className="project-list"></div>
      </section>
    </section>
  </main>;
}

export function WorkspacePage() {
  return <main className="home-shell">
    <nav className="home-topbar" aria-label="Makerspace navigation">
      <a className="brand" href="/workspace.html" aria-label="Makerspace workspace"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><span>makerspace</span><span id="project-label" className="project-pill" hidden></span></a>
      <div className="workspace-chip" aria-label="Selected workspace"><strong id="workspace-label">loading…</strong><a className="textbtn" href="/">switch</a></div>
      <div className="header-actions home-actions"><a id="codex-auth-pill" className="auth-pill" href="/settings.html#codex" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="codex-auth-label">codex</span></a><a id="github-auth-pill" className="auth-pill" href="/settings.html#github" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="github-auth-label">github</span></a><a className="textbtn" href="/performance.html">performance</a><a className="textbtn" href="/settings.html">settings</a></div>
    </nav>
    <h1 className="sr-only">Start a main agent</h1>
    <form id="thread-form" className="launch-card" aria-label="Spin up a main agent">
      <input id="repo-url" name="repoUrl" type="hidden" value="" readOnly /><input name="branch" type="hidden" value="" readOnly /><input name="repoSource" type="hidden" value="" readOnly />
      <label className="sr-only" htmlFor="prompt">Task</label><textarea id="prompt" name="prompt" rows="4" placeholder="Tell the main agent what to do…" required></textarea>
      <div className="composer-controls launch-controls" aria-label="main agent run controls"><div className="attachment-row composer-attachment-row"><label className="textbtn attach-btn" htmlFor="prompt-images" aria-label="add images" title="add images">+</label><input id="prompt-images" className="image-input" name="images" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple /><span id="image-status" className="attachment-status muted" role="status" aria-live="polite"></span></div><label className="target-input model-picker"><span>model</span><select id="model-ref" name="modelRef"><option value="">loading model…</option></select></label><label className="target-input thinking-slider"><span>thinking</span><input id="thinking-level" type="range" min="0" max="5" step="1" defaultValue="5" /><output id="thinking-level-value" htmlFor="thinking-level">xhigh</output></label></div>
      <div className="target-row workspace-run-row"><button id="thread-submit" className="primary-btn run-btn" type="submit">start agent</button></div>
      <div className="repo-tray" hidden><select id="repo-picker" className="board-select" disabled><option value="">GitHub repos</option></select><button id="repo-refresh" className="textbtn" type="button">refresh</button><button id="choose-folder" className="textbtn" type="button" hidden>choose folder</button><p id="repo-hint" className="muted">Sign in for repo picker.</p></div>
      <div className="advanced-fields launch-details"><input name="name" placeholder="main agent name" /><div id="provider-banner" className="notice" aria-live="polite">Connecting…</div></div>
      <p id="thread-status" className="status-line"></p>
    </form>
    <section className="home-recent action-center" aria-label="Agents"><div className="section-row"><div><h2>Agents</h2><p id="action-summary" className="muted">Loading agent status…</p></div><div className="inline-actions"><a className="textbtn" href="/history.html">history</a><button id="refresh-threads" className="textbtn" type="button">refresh</button></div></div><div id="threads-list" className="action-lanes"></div></section>
  </main>;
}

export function ThreadPage() {
  return <main className="thread-flow-shell">
    <header className="flow-topbar"><div className="flow-top-left"><a className="brand" href="/workspace.html"><span className="brand-box">←</span><span id="project-label" className="project-pill" hidden></span></a></div><div className="flow-title"><strong id="thread-title">Loading</strong><span id="thread-meta" className="muted"></span></div><div className="header-actions"><span id="thread-status" className="status-pill">connecting</span><button id="archive-thread" className="primary-btn thread-done-btn" type="button" hidden>mark as done</button></div></header>
    <section className="thread-stage" aria-label="Main agent workspace"><aside className="agent-column" aria-label="Main agent status"><div id="agent-rail" className="agent-rail flow-card" aria-label="Main agent trace" role="button" tabIndex="0" aria-controls="agent-trace" aria-expanded="false"><div className="rail-head"><span>agent</span><strong id="agent-graph-count">idle</strong></div><p className="rail-hint">click to open trace</p><div id="agent-graph" className="agent-graph"></div></div><details id="diff-box" className="diff-box flow-card" hidden><summary><span>changes</span><strong id="diff-count">0</strong></summary><div className="diff-workbench"><div id="diff-files" className="diff-files" role="list"></div><textarea id="diff-editor" className="diff-editor" readOnly spellCheck="false" aria-label="Selected file changes"></textarea></div></details></aside>
      <section className="flow-wrap thread-workspace" aria-label="Main agent conversation"><section className="now-card flow-card"><h1 id="thinking-title">Loading</h1><p id="thinking-detail" className="muted"></p></section><section className="conversation-main flow-card" aria-label="Main agent conversation"><div id="timeline" className="timeline-flow" aria-live="polite"></div><aside id="agent-trace" className="agent-activity agent-trace-inline" aria-label="Main agent trace" aria-hidden="true" hidden><div className="agent-activity-head"><div className="rail-head"><span>agent trace</span><strong>events</strong></div><button id="agent-activity-close" className="textbtn" type="button">hide</button></div><div id="trace-timeline" className="timeline-flow" aria-live="polite"></div></aside></section><section className="notes-main flow-card" aria-label="Implementation notes" hidden><div className="rail-head"><span>implementation notes</span><strong id="notes-count">0</strong></div><div id="notes-list" className="notes-list"></div></section>
        <form id="prompt-form" className="flow-composer"><div className="composer-field"><label className="sr-only" htmlFor="prompt">Prompt</label><textarea id="prompt" rows="3" placeholder="Next task…"></textarea><div className="composer-controls" aria-label="main agent run controls"><div className="attachment-row composer-attachment-row"><label className="textbtn attach-btn" htmlFor="prompt-images" aria-label="add images" title="add images">+</label><input id="prompt-images" className="image-input" name="images" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple /><span id="image-status" className="attachment-status muted" role="status" aria-live="polite"></span></div><label className="target-input model-picker"><span>model</span><select id="model-ref" name="modelRef"><option value="">loading model…</option></select></label><label className="target-input thinking-slider"><span>thinking</span><input id="thinking-level" type="range" min="0" max="5" step="1" defaultValue="5" /><output id="thinking-level-value" htmlFor="thinking-level">xhigh</output></label></div></div><button id="send" className="primary-btn" type="submit">send</button></form>
      </section></section>
  </main>;
}

export function HistoryPage() {
  return <main className="history-shell"><nav className="home-topbar" aria-label="Makerspace navigation"><a className="brand" href="/workspace.html" aria-label="Makerspace workspace"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><span>makerspace</span><span id="project-label" className="project-pill" hidden></span></a><div className="workspace-chip" aria-label="Selected workspace"><strong id="workspace-label">loading…</strong><a className="textbtn" href="/">switch</a></div><div className="header-actions home-actions"><a className="textbtn" href="/workspace.html">workspace</a><a className="textbtn" href="/performance.html">performance</a><a className="textbtn" href="/settings.html">settings</a></div></nav><header className="history-hero"><div><p className="eyebrow">project history</p><h1>Past agents for this workspace</h1><p id="history-status" className="muted">Loading this project’s saved agents…</p></div><label className="target-input history-search"><span>search</span><input id="history-search" type="search" placeholder="repo, prompt, status, name" /></label></header><section id="history-stats" className="history-stats" aria-label="History summary"></section><section id="history-list" className="history-list" aria-label="Past threads, sessions, and agents"></section></main>;
}

export function PerformancePage() {
  return <main className="home-shell performance-shell"><nav className="home-topbar" aria-label="Makerspace navigation"><a className="brand" href="/" aria-label="Makerspace home"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><span>makerspace</span></a><div className="header-actions home-actions"><a className="textbtn" href="/">main agents</a><a className="textbtn" href="/settings.html">settings</a></div></nav><section className="performance-hero"><p className="eyebrow">lookback</p><h1>Main agent performance</h1><p id="performance-status" className="muted">Loading main agent metrics…</p></section><section id="performance-stats" className="performance-stats" aria-label="Performance summary"></section><section className="performance-grid"><div className="performance-panel"><div className="section-row"><h2>Signals</h2><button id="refresh-performance" className="textbtn" type="button">refresh</button></div><ul id="performance-insights" className="signal-list"></ul></div><div className="performance-panel table-panel"><div className="section-row"><h2>Main agents</h2><p id="performance-count" className="muted"></p></div><div className="performance-table-wrap"><table className="performance-table"><thead><tr><th>main agent</th><th>status</th><th>first llm</th><th>duration</th><th>tools</th><th>tokens</th><th>cache</th><th>flags</th></tr></thead><tbody id="performance-rows"></tbody></table></div></div></section></main>;
}

export function SettingsPage() {
  return <><div className="crt-vignette" aria-hidden="true"></div><div className="crt-scanlines" aria-hidden="true"></div><main className="shell console-grid"><nav className="topbar panel-lite" aria-label="Settings controls"><a className="brand-mark has-logo" href="/" aria-label="Makerspace home"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><strong>settings</strong></a><div className="topbar-actions"><a className="nav-link" href="/">agents</a></div></nav><header className="hero panel stack-lg"><h1>Settings</h1></header><section id="codex" className="panel stack-lg"><div className="panel-header"><div><h2>Codex</h2></div><button id="codex-login" type="button">Sign in</button></div><p id="codex-status" className="muted">Checking…</p><div id="codex-device" className="notice hidden"></div></section><section id="github" className="panel stack-lg"><div className="panel-header"><div><h2>GitHub</h2></div><div className="inline-actions"><button id="github-login" type="button">Sign in</button><button id="github-logout" type="button">Sign out</button></div></div><p id="github-status" className="muted">Checking…</p></section><section className="panel stack-lg"><div className="connection-card full-width"><div className="connection-head"><div><h3>Backend</h3></div><p id="connection-summary" className="connection-summary">same-origin · no token</p></div><div className="input-row"><label><span>Backend URL</span><input id="api-base" type="url" placeholder="https://api.yourdomain.com" /><small>Blank = same-origin.</small></label><label><span>Access token</span><input id="api-token" type="password" placeholder="CONTROL_API_TOKEN" autoComplete="current-password" /><small>Browser only.</small></label></div></div></section><section className="panel stack-lg"><div className="panel-header"><div><h2>Appearance</h2></div></div><div className="toggle-list"><label className="toggle-card"><span>Dark mode <small>Default.</small></span><input id="dark-mode" type="checkbox" /></label><label className="toggle-card"><span>Dark palette <small>Dark mode only.</small></span><select id="dark-palette" aria-label="Dark palette"><option value="slate">slate — lighter</option><option value="midnight">midnight — current</option><option value="graphite">graphite — neutral</option><option value="dusk">dusk — purple</option><option value="nerv-os">NERV-OS — retro cyan</option><option value="lcl-reactor">LCL Reactor — amber sync</option></select></label><label className="toggle-card"><span>Monospace font <small>Default.</small></span><input id="mono-font" type="checkbox" /></label></div></section><section id="pi-profile" className="panel stack-lg"><div className="panel-header"><div><h2>Pi profile</h2></div></div><form id="pi-profile-form" className="stack-lg"><label className="full-width"><span>AGENTS.md</span><textarea id="pi-agents" rows="12" spellCheck="false" placeholder="Makerspace Pi instructions"></textarea><small id="pi-agents-path" className="muted">Loading…</small></label><label className="toggle-card"><span>Sync selected profile to remote sandboxes <small>Per run; not baked into public images.</small></span><input id="pi-sync-remote" type="checkbox" /></label><div className="profile-resource-grid"><div><h3>Skills</h3><div id="pi-skills" className="resource-list muted">Loading…</div></div><div><h3>Extensions</h3><div id="pi-extensions" className="resource-list muted">Loading…</div></div><div><h3>Prompts</h3><div id="pi-prompts" className="resource-list muted">Loading…</div></div></div><div className="form-actions"><button id="pi-profile-submit" type="submit">Save profile</button><p id="pi-profile-status" className="muted">Loading…</p></div></form></section><section className="panel stack-lg"><div className="panel-header"><div><h2>Sandbox</h2></div></div><form id="settings-form" className="stack-lg"><div className="form-grid"><label className="full-width"><span>Image ref</span><input id="image-ref" name="imageRef" placeholder="image ref" /><small>Blank = default.</small></label><label><span>Registry username</span><input id="registry-username" name="registryUsername" placeholder="username" autoComplete="username" /></label><label><span>Registry token</span><input id="registry-password" name="registryPassword" type="password" placeholder="token" autoComplete="current-password" /><small>Blank keeps current.</small></label><label className="full-width"><span>Anthropic API key</span><input id="anthropic-api-key" name="anthropicApiKey" type="password" placeholder="API key" autoComplete="off" /><small>Blank keeps current.</small></label></div><div className="form-actions"><button id="settings-submit" type="submit">Save</button><p id="settings-status" className="muted">Loading…</p></div></form></section></main></>;
}

export const pages = {
  project: ProjectPage,
  workspace: WorkspacePage,
  thread: ThreadPage,
  settings: SettingsPage,
  history: HistoryPage,
  performance: PerformancePage,
};
