import {
  Badge,
  Button,
  InputGroup,
  InputMessage,
  ScrollArea,
  Select,
  Slider,
  StatusPill,
  Surface,
  Switch,
  Tabs,
  ThinkingStatus,
} from './components/ui.jsx';

function AuthPills() {
  return <>
    <a id="codex-auth-pill" className="auth-pill" href="/settings.html#codex" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="codex-auth-label">codex</span></a>
    <a id="github-auth-pill" className="auth-pill" href="/settings.html#github" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="github-auth-label">github</span></a>
  </>;
}

function Brand({ href = '/', label = 'Makerspace home', children }) {
  return <a className="brand" href={href} aria-label={label}>
    <img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
    <span>makerspace</span>
    {children ?? <span id="project-label" className="project-pill" hidden></span>}
  </a>;
}

function RunControls({ launch = false }) {
  return <div className={`composer-controls${launch ? ' launch-controls' : ''}`} aria-label="main agent run controls">
    <div className="attachment-row composer-attachment-row">
      <Button as="label" variant="ghost" size="sm" className="attach-btn" htmlFor="prompt-images" aria-label="add images" title="add images">+</Button>
      <input id="prompt-images" className="image-input" name="images" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple />
      <span id="image-status" className="attachment-status muted" role="status" aria-live="polite"></span>
    </div>
    <InputGroup label="model" className="model-picker">
      <Select id="model-ref" name="modelRef"><option value="">loading model…</option></Select>
    </InputGroup>
    <InputGroup label="thinking" className="thinking-slider">
      <Slider id="thinking-level" min="0" max="5" step="1" defaultValue="5" />
      <output id="thinking-level-value" htmlFor="thinking-level">xhigh</output>
    </InputGroup>
  </div>;
}

function WorkspaceNav({ active = 'workspace' }) {
  return <nav className="home-topbar" aria-label="Makerspace navigation">
    <Brand href="/workspace.html" label="Makerspace workspace" />
    <div className="workspace-chip" aria-label="Selected workspace"><strong id="workspace-label">loading…</strong><Button as="a" variant="ghost" size="sm" href="/">switch</Button></div>
    <div className="header-actions home-actions">
      {active === 'workspace' && <AuthPills />}
      {active !== 'workspace' && <Button as="a" variant="ghost" href="/workspace.html">workspace</Button>}
      {active !== 'history' && <Button as="a" variant="ghost" href="/history.html">history</Button>}
      {active !== 'performance' && <Button as="a" variant="ghost" href="/performance.html">performance</Button>}
      {active !== 'settings' && <Button as="a" variant="ghost" href="/settings.html">settings</Button>}
    </div>
  </nav>;
}

export function ProjectPage() {
  return <main className="project-shell">
    <nav className="home-topbar" aria-label="Makerspace navigation">
      <Brand href="/" label="Makerspace projects" />
      <div className="header-actions home-actions"><AuthPills /><Button as="a" variant="ghost" href="/settings.html">settings</Button></div>
    </nav>

    <header className="project-hero">
      <h1>Welcome back, Anish.</h1>
      <p className="lede">Choose a local folder on this Mac, or pick a GitHub repo for cloud mode. The agent page stays scoped to it.</p>
    </header>

    <section className="project-grid">
      <Surface as="form" id="project-form" className="project-card" aria-label="Select project">
        <input id="project-repo-source" name="repoSource" type="hidden" value="" readOnly />
        <input id="project-branch" name="branch" type="hidden" value="" readOnly />
        <label className="sr-only" htmlFor="project-repo-url">folder or repo</label>
        <InputGroup as="div" className="project-target repo-input">
          <input id="project-repo-url" name="repoUrl" placeholder="/Users/you/project" aria-label="folder or repo" required />
          <Button id="project-choose-folder" variant="ghost" size="sm" className="folder-picker-btn" type="button" hidden aria-label="choose local folder" title="choose local folder">choose folder</Button>
        </InputGroup>
        <div id="project-repo-tray" className="repo-tray">
          <Select id="project-repo-picker" className="board-select" disabled><option value="">GitHub repos</option></Select>
          <Button id="project-repo-refresh" variant="ghost" type="button">refresh</Button>
          <p id="project-repo-hint" className="muted">Choose a local folder or paste a repo.</p>
        </div>
        <Button id="project-submit" variant="primary" type="submit">open workspace</Button>
        <p id="project-status" className="status-line">Select a project to continue.</p>
      </Surface>
      <Surface className="project-card recent-projects" aria-label="Recent projects">
        <div className="section-row"><div><h2>Recent projects</h2><p className="muted">One click back into a workspace.</p></div><Badge tone="info">fluid</Badge></div>
        <div id="project-recent-list" className="project-list"></div>
      </Surface>
    </section>
  </main>;
}

export function WorkspacePage() {
  return <main className="home-shell">
    <WorkspaceNav active="workspace" />
    <h1 className="sr-only">Start a main agent</h1>
    <InputMessage as="form" id="thread-form" className="launch-card" aria-label="Spin up a main agent">
      <input id="repo-url" name="repoUrl" type="hidden" value="" readOnly />
      <input name="branch" type="hidden" value="" readOnly />
      <input name="repoSource" type="hidden" value="" readOnly />
      <label className="sr-only" htmlFor="prompt">Task</label>
      <textarea id="prompt" name="prompt" rows="4" placeholder="Tell the main agent what to do…" required></textarea>
      <RunControls launch />
      <div className="target-row workspace-run-row"><Button id="thread-submit" variant="primary" className="run-btn" type="submit">start agent</Button></div>
      <div className="repo-tray" hidden>
        <Select id="repo-picker" className="board-select" disabled><option value="">GitHub repos</option></Select>
        <Button id="repo-refresh" variant="ghost" type="button">refresh</Button>
        <Button id="choose-folder" variant="ghost" type="button" hidden>choose folder</Button>
        <p id="repo-hint" className="muted">Sign in for repo picker.</p>
      </div>
      <div className="advanced-fields launch-details"><input name="name" placeholder="main agent name" /><div id="provider-banner" className="notice" aria-live="polite">Connecting…</div></div>
      <p id="thread-status" className="status-line"></p>
    </InputMessage>
    <Surface className="home-recent action-center" aria-label="Agents">
      <div className="section-row"><div><h2>Agents</h2><p id="action-summary" className="muted">Loading agent status…</p></div><div className="inline-actions"><Button as="a" variant="ghost" href="/history.html">history</Button><Button id="refresh-threads" variant="ghost" type="button">refresh</Button></div></div>
      <div className="agent-toast agent-toast-inline" role="status"><strong>Agent finished</strong><small>Preview of the new success toast.</small></div>
      <ScrollArea id="threads-list" className="action-lanes"></ScrollArea>
    </Surface>
  </main>;
}

export function ThreadPage() {
  return <main className="thread-flow-shell">
    <header className="flow-topbar">
      <div className="flow-top-left"><a className="brand" href="/workspace.html"><span className="brand-box">←</span><span id="project-label" className="project-pill" hidden></span></a></div>
      <div className="flow-title"><strong id="thread-title">Loading</strong><span id="thread-meta" className="muted"></span></div>
      <div className="header-actions"><StatusPill id="thread-status">connecting</StatusPill><Button id="archive-thread" variant="primary" className="thread-done-btn" type="button" hidden>mark as done</Button></div>
    </header>
    <section className="thread-stage" aria-label="Main agent workspace">
      <aside className="agent-column" aria-label="Main agent status">
        <Surface as="div" id="agent-rail" className="agent-rail flow-card" aria-label="Main agent trace" role="button" tabIndex="0" aria-controls="agent-trace" aria-expanded="false">
          <div className="rail-head"><span>agent</span><strong id="agent-graph-count">idle</strong></div>
          <p className="rail-hint">click to open trace</p>
          <div id="agent-graph" className="agent-graph"></div>
        </Surface>
        <details id="diff-box" className="diff-box flow-card" hidden><summary><span>changes</span><strong id="diff-count">0</strong></summary><div className="diff-workbench"><div id="diff-files" className="diff-files" role="list"></div><textarea id="diff-editor" className="diff-editor" readOnly spellCheck="false" aria-label="Selected file changes"></textarea></div></details>
      </aside>
      <section className="flow-wrap thread-workspace" aria-label="Main agent conversation">
        <ThinkingStatus titleId="thinking-title" detailId="thinking-detail" />
        <section className="conversation-main flow-card" aria-label="Main agent conversation">
          <ScrollArea id="timeline" className="timeline-flow" aria-live="polite"></ScrollArea>
          <aside id="agent-trace" className="agent-activity agent-trace-inline" aria-label="Main agent trace" aria-hidden="true" hidden>
            <div className="agent-activity-head"><div className="rail-head"><span>agent trace</span><strong>events</strong></div><Button id="agent-activity-close" variant="ghost" type="button">hide</Button></div>
            <ScrollArea id="trace-timeline" className="timeline-flow" aria-live="polite"></ScrollArea>
          </aside>
        </section>
        <Surface className="notes-main flow-card" aria-label="Implementation notes" hidden><div className="rail-head"><span>implementation notes</span><strong id="notes-count">0</strong></div><div id="notes-list" className="notes-list"></div></Surface>
        <InputMessage as="form" id="prompt-form" className="flow-composer">
          <div className="composer-field"><label className="sr-only" htmlFor="prompt">Prompt</label><textarea id="prompt" rows="3" placeholder="Next task…"></textarea><RunControls /></div>
          <Button id="send" variant="primary" type="submit">send</Button>
        </InputMessage>
      </section>
    </section>
  </main>;
}

export function HistoryPage() {
  return <main className="history-shell">
    <WorkspaceNav active="history" />
    <header className="history-hero"><div><p className="eyebrow">project history</p><h1>Past agents for this workspace</h1><p id="history-status" className="muted">Loading this project’s saved agents…</p></div><InputGroup label="search" className="history-search"><input id="history-search" type="search" placeholder="repo, prompt, status, name" /></InputGroup></header>
    <section id="history-stats" className="history-stats" aria-label="History summary"></section>
    <ScrollArea as="section" id="history-list" className="history-list" aria-label="Past threads, sessions, and agents"></ScrollArea>
  </main>;
}

export function PerformancePage() {
  return <main className="home-shell performance-shell">
    <nav className="home-topbar" aria-label="Makerspace navigation"><Brand href="/" /><div className="header-actions home-actions"><Button as="a" variant="ghost" href="/">main agents</Button><Button as="a" variant="ghost" href="/settings.html">settings</Button></div></nav>
    <section className="performance-hero"><p className="eyebrow">lookback</p><h1>Main agent performance</h1><p id="performance-status" className="muted">Loading main agent metrics…</p></section>
    <section id="performance-stats" className="performance-stats" aria-label="Performance summary"></section>
    <section className="performance-grid"><Surface className="performance-panel"><div className="section-row"><h2>Signals</h2><Button id="refresh-performance" variant="ghost" type="button">refresh</Button></div><ul id="performance-insights" className="signal-list"></ul></Surface><Surface className="performance-panel table-panel"><div className="section-row"><h2>Main agents</h2><p id="performance-count" className="muted"></p></div><ScrollArea className="performance-table-wrap"><table className="performance-table"><thead><tr><th>main agent</th><th>status</th><th>first llm</th><th>duration</th><th>tools</th><th>tokens</th><th>cache</th><th>flags</th></tr></thead><tbody id="performance-rows"></tbody></table></ScrollArea></Surface></section>
  </main>;
}

export function SettingsPage() {
  return <><div className="crt-vignette" aria-hidden="true"></div><div className="crt-scanlines" aria-hidden="true"></div><main className="shell console-grid">
    <nav className="topbar panel-lite" aria-label="Settings controls"><a className="brand-mark has-logo" href="/" aria-label="Makerspace home"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><strong>settings</strong></a><div className="topbar-actions"><Button as="a" variant="ghost" href="/">agents</Button></div></nav>
    <header className="hero panel stack-lg"><h1>Settings</h1><Tabs items={[{ href: '#github', label: 'GitHub' }, { href: '#codex', label: 'Codex' }, { href: '#appearance', label: 'Appearance' }, { href: '#pi-profile', label: 'Pi profile' }, { href: '#sandbox', label: 'Sandbox' }]} /></header>
    <Surface as="section" id="github" className="panel stack-lg"><div className="panel-header"><div><h2>GitHub</h2></div><div className="inline-actions"><Button id="github-login" variant="primary" type="button">Sign in</Button><Button id="github-logout" variant="ghost" type="button">Sign out</Button></div></div><p id="github-status" className="muted">Checking…</p></Surface>
    <Surface as="section" id="codex" className="panel stack-lg"><div className="panel-header"><div><h2>Codex</h2></div><Button id="codex-login" variant="primary" type="button">Sign in</Button></div><p id="codex-status" className="muted">Checking…</p><div id="codex-device" className="notice hidden"></div></Surface>
    <Surface as="section" id="appearance" className="panel stack-lg"><div className="panel-header"><div><h2>Appearance</h2></div></div><div className="toggle-list"><Switch id="dark-mode" className="appearance-toggle" label="Dark mode" help="Uses the dark theme." /><label className="toggle-card"><span>Dark palette <small>Dark mode only.</small></span><Select id="dark-palette" aria-label="Dark palette"><option value="slate">slate — lighter</option><option value="midnight">midnight — current</option><option value="graphite">graphite — neutral</option><option value="dusk">dusk — purple</option><option value="nerv-os">NERV-OS — retro cyan</option><option value="lcl-reactor">LCL Reactor — amber sync</option></Select></label><Switch id="mono-font" className="appearance-toggle" label="Monospace font" help="Uses monospace app text." /></div></Surface>
    <Surface as="section" id="pi-profile" className="panel stack-lg"><div className="panel-header"><div><h2>Pi profile</h2></div></div><form id="pi-profile-form" className="stack-lg"><label className="full-width"><span>AGENTS.md</span><textarea id="pi-agents" rows="12" spellCheck="false" placeholder="Makerspace Pi instructions"></textarea><small id="pi-agents-path" className="muted">Loading…</small></label><Switch id="pi-sync-remote" label="Sync selected profile to remote sandboxes " help="Per run; not baked into public images." /><div className="profile-resource-grid"><div><h3>Skills</h3><div id="pi-skills" className="resource-list muted">Loading…</div></div><div><h3>Extensions</h3><div id="pi-extensions" className="resource-list muted">Loading…</div></div><div><h3>Prompts</h3><div id="pi-prompts" className="resource-list muted">Loading…</div></div></div><div className="form-actions"><Button id="pi-profile-submit" variant="primary" type="submit">Save profile</Button><p id="pi-profile-status" className="muted">Loading…</p></div></form></Surface>
    <Surface as="section" id="sandbox" className="panel stack-lg"><div className="panel-header"><div><h2>Sandbox</h2></div></div><form id="settings-form" className="stack-lg"><div className="form-grid"><label className="full-width"><span>Image ref</span><input id="image-ref" name="imageRef" placeholder="image ref" /><small>Blank = default.</small></label><label><span>Registry username</span><input id="registry-username" name="registryUsername" placeholder="username" autoComplete="username" /></label><label><span>Registry token</span><input id="registry-password" name="registryPassword" type="password" placeholder="token" autoComplete="current-password" /><small>Blank keeps current.</small></label><label className="full-width"><span>Anthropic API key</span><input id="anthropic-api-key" name="anthropicApiKey" type="password" placeholder="API key" autoComplete="off" /><small>Blank keeps current.</small></label></div><div className="form-actions"><Button id="settings-submit" variant="primary" type="submit">Save</Button><p id="settings-status" className="muted">Loading…</p></div></form></Surface>
  </main></>;
}

export const pages = {
  project: ProjectPage,
  workspace: WorkspacePage,
  thread: ThreadPage,
  settings: SettingsPage,
  history: HistoryPage,
  performance: PerformancePage,
};
