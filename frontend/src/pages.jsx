import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ChartLineIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  DatabaseIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  GearSixIcon,
  GitDiffIcon,
  GithubLogoIcon,
  OpenAiLogoIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  RobotIcon,
  SignInIcon,
  SignOutIcon,
  StopCircleIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from '@phosphor-icons/react';

import {
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
} from './components/ui.jsx';

const buttonIconProps = { 'aria-hidden': true, 'data-icon': 'inline-start', className: 'size-4' };

function AuthPills() {
  return <>
    <a id="codex-auth-pill" className="auth-pill" href="/settings.html#codex" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="codex-auth-label">codex</span></a>
    <a id="github-auth-pill" className="auth-pill" href="/settings.html#github" data-status="checking" aria-live="polite"><span className="status-dot" aria-hidden="true"></span><span id="github-auth-label">github</span></a>
  </>;
}

function GitHubSignInButton({ id, className = '', children = 'Continue with GitHub' }) {
  return <Button id={id} className={`github-login-button ${className}`.trim()} variant="primary" type="button" data-github-signin><GithubLogoIcon {...buttonIconProps} />{children}</Button>;
}

function GitHubSignInCard({ compact = false }) {
  return <Surface id="github-signin-card" className={`signin-gate${compact ? ' compact' : ''}`} hidden aria-labelledby="github-signin-title">
    <div className="signin-copy">
      <p className="eyebrow">spanner beta</p>
      <h2 id="github-signin-title">Sign in to Spanner</h2>
      <p id="github-signin-copy" className="lede">Connect GitHub to launch agents on your repos without sharing credentials with anyone else.</p>
      <ul className="signin-proof" aria-label="What signing in enables">
        <li>private repos stay tied to your GitHub account</li>
        <li>agents run in isolated sandboxes</li>
        <li>settings and auth stay per-user</li>
      </ul>
    </div>
    <div className="signin-panel" aria-label="Sign in form">
      <p className="eyebrow">account</p>
      <h3>Welcome back</h3>
      <GitHubSignInButton id="github-signin-main" />
      <p id="github-signin-status" className="status-line" aria-live="polite">Checking GitHub sign-in…</p>
      <p className="signin-footnote">No shared model keys or repo tokens. GitHub opens in a secure OAuth window.</p>
    </div>
  </Surface>;
}

function Brand({ href = '/', label = 'Spanner home', children }) {
  return <a className="brand" href={href} aria-label={label}>
    <img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
    <span>spanner</span>
    {children ?? <span id="project-label" className="project-pill" hidden></span>}
  </a>;
}

function RunControls({ launch = false }) {
  return <div className={`composer-controls${launch ? ' launch-controls' : ''}`} aria-label="main agent run controls">
    <div className="attachment-row composer-attachment-row">
      <Button as="label" variant="ghost" size="sm" className="attach-btn" htmlFor="prompt-images" aria-label="add images" title="add images"><PlusIcon {...buttonIconProps} /></Button>
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
  return <nav className="home-topbar" aria-label="Spanner navigation">
    <Brand href="/workspace.html" label="Spanner workspace" />
    <div className="workspace-chip" aria-label="Selected workspace"><strong id="workspace-label">loading…</strong><Button as="a" variant="ghost" size="sm" href="/"><FolderOpenIcon {...buttonIconProps} />switch</Button></div>
    <div className="header-actions home-actions">
      {active === 'workspace' && <AuthPills />}
      {active === 'workspace' && <GitHubSignInButton id="github-signin-nav" className="signin-nav-button">Sign in</GitHubSignInButton>}
      {active !== 'workspace' && <Button as="a" variant="ghost" href="/workspace.html"><RobotIcon {...buttonIconProps} />workspace</Button>}
      {active !== 'settings' && <Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button>}
    </div>
  </nav>;
}

export function ProjectPage() {
  return <main className="project-shell">
    <nav className="home-topbar" aria-label="Spanner navigation">
      <Brand href="/" label="Spanner projects" />
      <div className="header-actions home-actions"><AuthPills /><GitHubSignInButton id="github-signin-nav" className="signin-nav-button">Sign in</GitHubSignInButton><Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button></div>
    </nav>

    <header id="project-hero" className="project-hero">
      <h1 id="project-welcome">Welcome back.</h1>
      <p className="lede">Choose a project to continue.</p>
    </header>
    <GitHubSignInCard />

    <section id="project-grid" className="project-grid">
      <Surface as="form" id="project-form" className="project-card" aria-label="Select project">
        <input id="project-repo-source" name="repoSource" type="hidden" value="" readOnly />
        <input id="project-branch" name="branch" type="hidden" value="" readOnly />
        <label className="sr-only" htmlFor="project-repo-url">folder or repo</label>
        <InputGroup as="div" className="project-target repo-input repo-combobox">
          <input id="project-repo-url" name="repoUrl" placeholder="/Users/you/project" aria-label="folder or repo" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="project-repo-options" required />
          <Button id="project-choose-folder" variant="ghost" size="sm" className="folder-picker-btn" type="button" hidden aria-label="choose local folder" title="choose local folder"><FolderOpenIcon {...buttonIconProps} />choose folder</Button>
          <div id="project-repo-options" className="repo-suggestions" role="listbox" hidden></div>
        </InputGroup>
        <div id="project-repo-tray" className="repo-tray project-repo-toolbar">
          <Button id="project-repo-refresh" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh repos</Button>
          <p id="project-repo-hint" className="muted"></p>
        </div>
        <Button id="project-submit" variant="primary" type="submit"><ArrowRightIcon {...buttonIconProps} />open workspace</Button>
        <p id="project-status" className="status-line" aria-live="polite"></p>
      </Surface>
      <Surface className="project-card recent-projects" aria-label="Recent projects">
        <div className="section-row"><div><h2>Recent projects</h2><p className="muted">One click back into a workspace.</p></div></div>
        <div id="project-recent-list" className="project-list"></div>
      </Surface>
    </section>
  </main>;
}

export function WorkspacePage() {
  return <main className="home-shell">
    <WorkspaceNav active="workspace" />
    <h1 className="sr-only">Start a main agent</h1>
    <GitHubSignInCard compact />
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
        <Button id="repo-refresh" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh</Button>
        <Button id="choose-folder" variant="ghost" type="button" hidden><FolderOpenIcon {...buttonIconProps} />choose folder</Button>
        <p id="repo-hint" className="muted">Sign in for repo picker.</p>
      </div>
      <div className="advanced-fields launch-details"><input name="name" placeholder="main agent name" /><div id="provider-banner" className="notice" aria-live="polite">Connecting…</div></div>
      <p id="thread-status" className="status-line"></p>
    </InputMessage>
    <section id="launch-suggestions" className="launch-suggestions" aria-label="Suggested starter prompts">
      <span>suggested</span>
      <button type="button" data-suggested-prompt="Review this project for quick wins, bugs, and confusing code. Keep fixes small.">review this repo</button>
      <button type="button" data-suggested-prompt="Run the smallest relevant tests, fix one failure, and verify it.">fix a test</button>
      <button type="button" data-suggested-prompt="Map the main files and explain where to make the next change.">explain the code</button>
    </section>
    <Surface id="agents-section" className="home-recent action-center" aria-label="Agents">
      <div className="section-row"><div><h2>Agents</h2></div><div className="inline-actions"><Button as="a" variant="ghost" href="/history.html"><ClockCounterClockwiseIcon {...buttonIconProps} />history</Button><Button id="refresh-threads" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh</Button></div></div>
      <ScrollArea id="threads-list" className="action-lanes"></ScrollArea>
    </Surface>
  </main>;
}

export function ThreadPage() {
  return <main className="thread-flow-shell">
    <section className="thread-stage" aria-label="Main agent workspace">
      <header className="thread-main-header">
        <div className="thread-main-row">
          <a className="brand" href="/workspace.html" aria-label="Back to workspace"><span className="brand-box"><ArrowLeftIcon className="size-4" aria-hidden="true" /></span><span id="project-label" className="project-pill" hidden></span></a>
          <h1 id="thinking-title">Loading</h1>
          <div className="header-actions"><StatusPill id="thread-status">connecting</StatusPill><Button id="stop-thread" variant="ghost" className="thread-stop-btn" type="button" hidden><StopCircleIcon {...buttonIconProps} />stop</Button><Button id="suspend-thread" variant="ghost" className="thread-suspend-btn" type="button" hidden>suspend</Button><Button id="resume-thread" variant="ghost" className="thread-resume-btn" type="button" hidden>resume</Button><Button id="delete-thread" variant="ghost" className="thread-delete-btn" type="button" hidden>delete</Button><Button id="archive-thread" variant="primary" className="thread-done-btn" type="button" hidden><CheckCircleIcon {...buttonIconProps} />mark as done</Button></div>
        </div>
        <p id="thinking-detail" className="muted"></p>
        <div className="sr-only"><strong id="thread-title">Loading</strong><span id="thread-meta"></span></div>
      </header>
      <aside className="agent-column" aria-label="Workflow agents">
        <Surface as="div" id="agent-rail" className="agent-rail flow-card" aria-label="Workflow agent trace" role="button" tabIndex="0" aria-controls="agent-trace" aria-expanded="false">
          <div className="rail-head"><span>workflow agents</span><strong id="agent-graph-count">idle</strong></div>
          <p className="rail-hint">click for full workflow trace</p>
          <div id="agent-graph" className="agent-graph"></div>
        </Surface>
        <button id="diff-box" className="diff-box flow-card" type="button" hidden><span className="inline-flex items-center gap-1.5"><GitDiffIcon className="size-4" aria-hidden="true" />changes</span><strong id="diff-count">0 files edited · 0 lines</strong></button>
      </aside>
      <section className="flow-wrap thread-workspace" aria-label="Main agent conversation">
        <section className="conversation-main flow-card" aria-label="Main agent conversation">
          <ScrollArea id="timeline" className="timeline-flow" aria-live="polite"></ScrollArea>
          <aside id="agent-trace" className="agent-activity agent-trace-inline" aria-label="Full workflow trace" aria-hidden="true" hidden>
            <div className="agent-activity-head"><div className="rail-head"><span>workflow trace</span><strong>events</strong></div><Button id="agent-activity-close" variant="ghost" type="button"><ArrowLeftIcon {...buttonIconProps} />hide</Button></div>
            <ScrollArea id="trace-timeline" className="timeline-flow" aria-live="polite"></ScrollArea>
          </aside>
        </section>
        <Surface id="suggested-next-steps" className="next-steps-main flow-card" aria-label="Suggested next steps" hidden><div className="rail-head"><span>suggested next steps</span><strong>prompts</strong></div><div id="suggested-next-steps-list" className="next-steps-list"></div></Surface>
        <Surface className="notes-main flow-card" aria-label="Implementation notes" hidden><div className="rail-head"><span>implementation notes</span><strong id="notes-count">0</strong></div><div id="notes-list" className="notes-list"></div></Surface>
        <InputMessage as="form" id="prompt-form" className="flow-composer">
          <div className="composer-field"><label className="sr-only" htmlFor="prompt">Prompt</label><textarea id="prompt" rows="3" placeholder="Next task…"></textarea><small id="composer-hint" className="composer-hint muted">Enter sends · Shift+Enter adds a line</small><RunControls /></div>
          <Button id="send" variant="primary" type="submit"><PaperPlaneTiltIcon {...buttonIconProps} />send</Button>
        </InputMessage>
      </section>
    </section>
    <dialog id="diff-dialog" className="diff-dialog" aria-labelledby="diff-dialog-title">
      <div className="diff-dialog-shell">
        <header className="diff-dialog-head"><div><p className="eyebrow">changes</p><h2 id="diff-dialog-title">Full diff</h2></div><Button id="diff-dialog-close" variant="ghost" type="button"><ArrowLeftIcon {...buttonIconProps} />close</Button></header>
        <div id="diff-dialog-files" className="diff-dialog-files" role="list"></div>
        <div id="diff-dialog-body" className="diff-dialog-body" aria-label="Full diff"></div>
      </div>
    </dialog>
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
  const isLocal = globalThis.location?.pathname?.includes('local-telemetry');
  return <main className="home-shell performance-shell">
    <nav className="home-topbar" aria-label="Spanner navigation"><Brand href="/" /><div className="header-actions home-actions"><Button as="a" variant="ghost" href="/workspace.html"><RobotIcon {...buttonIconProps} />agents</Button><Button as="a" variant="ghost" href={isLocal ? '/telemetry.html' : '/local-telemetry.html'}>{isLocal ? <DatabaseIcon {...buttonIconProps} /> : <ClockCounterClockwiseIcon {...buttonIconProps} />}{isLocal ? 'db telemetry' : 'local sessions'}</Button><Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button></div></nav>
    <section className="performance-hero"><p className="eyebrow">telemetry</p><h1>{isLocal ? 'Local session telemetry' : 'Agent telemetry'}</h1><p id="performance-status" className="muted">Loading {isLocal ? 'local session' : 'DB-derived'} agent metrics…</p><p className="muted">{isLocal ? 'Reads the desktop/local sessions file and ignores old browser-session IDs.' : 'Estimated from the session DB plus live run events. No extra product tracking.'}</p></section>
    <section id="performance-stats" className="performance-stats" aria-label="Telemetry summary"></section>
    <section className="performance-grid"><div className="performance-side-stack"><Surface className="performance-panel"><div className="section-row"><h2>Signals</h2><Button id="refresh-performance" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh</Button></div><ul id="performance-insights" className="signal-list"></ul></Surface><Surface className="performance-panel"><div className="section-row"><h2>What this can show</h2><ChartLineIcon className="size-4" aria-hidden="true" /></div><ul id="telemetry-sources" className="signal-list telemetry-source-list"></ul></Surface></div><Surface className="performance-panel table-panel"><div className="section-row"><h2>Main agents</h2><p id="performance-count" className="muted"></p></div><ScrollArea className="performance-table-wrap"><table className="performance-table"><thead><tr><th>main agent</th><th>status</th><th>first llm</th><th>duration</th><th>tools</th><th>tokens</th><th>cache</th><th>analysis</th><th>flags</th></tr></thead><tbody id="performance-rows"></tbody></table></ScrollArea></Surface></section>
  </main>;
}

export function SettingsPage() {
  const settingsTabs = [
    { href: '#github', label: 'GitHub' },
    { href: '#codex', label: 'Codex' },
    { href: '#claude-code', label: 'Claude Code' },
    { href: '#pi-profile', label: 'Pi profile' },
    { href: '#sandbox', label: 'Sandbox' },
  ];

  return <main className="shell settings-shell">
    <nav className="settings-nav" aria-label="Settings controls">
      <a className="brand-mark has-logo" href="/" aria-label="Spanner home"><img className="brand-logo" src="/logo-mark.svg" alt="" aria-hidden="true" /><strong>spanner</strong></a>
      <Button as="a" variant="ghost" href="/"><RobotIcon {...buttonIconProps} />agents</Button>
    </nav>
    <p id="settings-global-status" className="settings-global-status" hidden></p>

    <header className="settings-hero">
      <div className="settings-hero-copy"><p className="eyebrow">settings</p><h1>Settings</h1><p className="lede">Connect accounts, sync your Pi profile, and set the sandbox defaults agents use.</p></div>
      <Tabs className="settings-tabs" items={settingsTabs} />
    </header>

    <section className="settings-section" aria-labelledby="accounts-title">
      <div className="settings-section-head"><p className="eyebrow">01 · accounts</p><h2 id="accounts-title">Connect the tools agents use.</h2><p>Spanner forwards the right credentials into each run; reconnect when a provider needs fresh scope.</p></div>
      <div className="settings-auth-grid">
        <Surface as="section" id="github" className="settings-card settings-auth-card" aria-labelledby="github-title"><div className="settings-card-head"><span className="settings-mark" aria-hidden="true"><GithubLogoIcon className="size-4" /></span><div><h3 id="github-title">GitHub</h3><p>Repos, pushes, draft PRs, and workflow file edits.</p></div><Button id="github-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="github-status" className="settings-status-line">Checking…</p><div className="settings-actions settings-secondary-actions"><Button id="github-app-install" variant="ghost" type="button"><WrenchIcon {...buttonIconProps} />Install app</Button><Button id="github-logout" variant="ghost" type="button"><SignOutIcon {...buttonIconProps} />Sign out</Button></div></Surface>
        <Surface as="section" id="codex" className="settings-card settings-auth-card" aria-labelledby="codex-title"><div className="settings-card-head"><span className="settings-mark" aria-hidden="true"><OpenAiLogoIcon className="size-4" /></span><div><h3 id="codex-title">Codex</h3><p>Your OpenAI Codex session for Pi runs.</p></div><Button id="codex-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="codex-status" className="settings-status-line">Checking…</p><div id="codex-device" className="notice hidden"></div></Surface>
        <Surface as="section" id="claude-code" className="settings-card settings-auth-card" aria-labelledby="claude-code-title"><div className="settings-card-head"><span className="settings-mark" aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="claude-code-title">Claude Code</h3><p>Your Claude Code session for Pi runs.</p></div><Button id="claude-code-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="claude-code-status" className="settings-status-line">Checking…</p><div id="claude-code-auth" className="notice hidden"></div><form id="claude-code-code-form" className="stack-lg hidden"><label className="full-width"><span>Paste the code Claude shows</span><input id="claude-code-code" name="code" placeholder="code#state" autoComplete="off" /></label><div className="form-actions"><Button id="claude-code-paste" variant="ghost" type="button">Paste from clipboard</Button><Button id="claude-code-code-submit" variant="primary" type="submit"><SignInIcon {...buttonIconProps} />Finish sign in</Button></div></form></Surface>
      </div>
    </section>

    <section className="settings-section" aria-labelledby="pi-profile-title">
      <div className="settings-section-head"><p className="eyebrow">02 · profile</p><h2 id="pi-profile-title">Choose what Pi carries into a run.</h2><p>Instructions and optional resources stay explicit. Nothing is baked into public images.</p></div>
      <Surface as="section" id="pi-profile" className="settings-card settings-profile-card" aria-labelledby="pi-profile-title"><form id="pi-profile-form" className="stack-lg"><label className="full-width settings-code-field"><span>AGENTS.md</span><textarea id="pi-agents" rows="8" spellCheck="false" placeholder="Spanner Pi instructions"></textarea><small id="pi-agents-path" className="muted">Loading…</small></label><Switch id="pi-sync-remote" label="Sync selected profile to remote sandboxes" help="Per run; not baked into public images." /><div className="profile-resource-grid"><div className="settings-resource-panel"><h3>Skills</h3><div id="pi-skills" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Extensions</h3><div id="pi-extensions" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Prompts</h3><div id="pi-prompts" className="resource-list muted">Loading…</div></div></div><div className="form-actions settings-save-row"><Button id="pi-profile-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save profile</Button><p id="pi-profile-status" className="settings-status-line">Loading…</p></div></form></Surface>
    </section>

    <section className="settings-section" aria-labelledby="runtime-title">
      <div className="settings-section-head"><p className="eyebrow">03 · runtime</p><h2 id="runtime-title">Set remote sandbox defaults.</h2><p>Leave fields blank to keep safe defaults or existing secrets.</p></div>
      <div className="settings-split-grid"><Surface as="section" id="sandbox" className="settings-card settings-sandbox-card" aria-labelledby="sandbox-title"><div className="settings-card-head"><span className="settings-mark" aria-hidden="true"><CubeIcon className="size-4" /></span><div><h3 id="sandbox-title">Sandbox</h3><p>Image and registry credentials for remote environments.</p></div></div><form id="settings-form" className="stack-lg"><div className="form-grid"><label className="full-width"><span>Image ref</span><input id="image-ref" name="imageRef" placeholder="image ref" /><small>Blank = default.</small></label><label><span>Registry username</span><input id="registry-username" name="registryUsername" placeholder="username" autoComplete="username" /></label><label><span>Registry token</span><input id="registry-password" name="registryPassword" type="password" placeholder="token" autoComplete="current-password" /><small>Blank keeps current.</small></label><label className="full-width"><span>Anthropic API key</span><input id="anthropic-api-key" name="anthropicApiKey" type="password" placeholder="API key" autoComplete="off" /><small>Blank keeps current.</small></label></div><div className="form-actions settings-save-row"><Button id="settings-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save sandbox</Button><p id="settings-status" className="settings-status-line">Loading…</p></div></form></Surface><Surface as="section" id="desktop-updates" className="settings-card settings-desktop-card" hidden aria-labelledby="desktop-updates-title"><div className="settings-card-head"><span className="settings-mark" aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="desktop-updates-title">Desktop updates</h3><p>Check GitHub Releases for a newer desktop build.</p></div></div><p id="desktop-update-status" className="settings-status-line">Desktop only.</p><div className="settings-actions"><Button id="desktop-check-updates" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />Check for updates</Button></div></Surface></div>
    </section>
  </main>;
}

export const pages = {
  project: ProjectPage,
  workspace: WorkspacePage,
  thread: ThreadPage,
  settings: SettingsPage,
  history: HistoryPage,
  performance: PerformancePage,
};
