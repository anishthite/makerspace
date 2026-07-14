import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ChartLineIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CopySimpleIcon,
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
  XIcon,
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
import onboardingContent from './onboarding-content.json';
import { TraceComponentsPage } from './trace-components-page.jsx';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from './components/ui/sidebar.jsx';
import { cn } from '#lib/utils';

const buttonIconProps = { 'aria-hidden': true, 'data-icon': 'inline-start', className: 'size-4' };
const eyebrowClass = 'mb-2 font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.12em] text-[var(--blue)]';
const mutedClass = 'text-[var(--ink-3)]';
const ledeClass = 'mb-0 max-w-[680px] text-lg text-[var(--ink-2)]';
const topbarClass = 'flex min-h-11 w-full items-center justify-start gap-3.5';
const headerActionsClass = 'ml-auto flex flex-wrap items-center justify-end gap-2';
const surfaceClass = 'rounded-md border border-[var(--rule)] bg-[var(--paper)] shadow-[var(--shadow)]';
const sectionRowClass = 'flex items-center justify-between gap-3';
const statusLineClass = 'min-h-5 text-sm text-[var(--ink-3)]';
const settingsSectionClass = 'mt-6 grid gap-4';
const settingsSectionHeadClass = 'max-w-[720px] [&_p:not(:first-child)]:text-[var(--ink-3)]';
const settingsCardClass = 'rounded-md border border-[var(--rule)] bg-[var(--paper)] p-4 shadow-[var(--shadow)]';
const settingsCardHeadClass = 'grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start';
const settingsMarkClass = 'grid size-8 place-items-center rounded-md border border-[var(--rule)] bg-[var(--paper-2)] text-[var(--blue)]';
const settingsActionsClass = 'mt-3 flex flex-wrap gap-2';
const settingsStatusClass = 'min-h-5 text-sm text-[var(--ink-3)]';

function AuthPills() {
  const pill = 'group inline-flex max-w-full items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-transparent bg-[color-mix(in_srgb,var(--paper)_62%,transparent)] px-2 py-1 font-[var(--mono)] text-[11px] lowercase text-[var(--ink-3)]';
  const dot = 'size-2 shrink-0 rounded-full bg-[var(--green)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--green)_14%,transparent)] group-data-[status=checking]:animate-[status-pulse_1.25s_var(--ease-out)_infinite] group-data-[status=checking]:bg-[var(--yellow)] group-data-[status=checking]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--yellow)_14%,transparent)] group-data-[status=missing]:bg-[var(--yellow)] group-data-[status=missing]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--yellow)_14%,transparent)] group-data-[status=error]:bg-[var(--red)] group-data-[status=error]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--red)_14%,transparent)]';
  return <>
    <a id="codex-auth-pill" className={pill} href="/settings.html#codex" data-status="checking" aria-live="polite"><span className={dot} aria-hidden="true"></span><span id="codex-auth-label">codex</span></a>
    <a id="github-auth-pill" className={pill} href="/settings.html#github" data-status="checking" aria-live="polite"><span className={dot} aria-hidden="true"></span><span id="github-auth-label">github</span></a>
  </>;
}

function GitHubSignInButton({ id, className = '', children = 'Continue with GitHub', ...props }) {
  return <Button id={id} className={`github-login-button ${className}`.trim()} variant="primary" type="button" {...props} data-github-signin><GithubLogoIcon {...buttonIconProps} />{children}</Button>;
}

function GitHubSignInCard({ compact = false }) {
  return <Surface id="github-signin-card" className={cn(surfaceClass, 'grid gap-4 p-4 md:grid-cols-[minmax(0,1.05fr)_minmax(280px,.7fr)]', compact && 'mb-4')} hidden aria-labelledby="github-signin-title">
    <div className="grid gap-3">
      <p className={eyebrowClass}>spanner beta</p>
      <h2 id="github-signin-title">Sign in to Spanner</h2>
      <p id="github-signin-copy" className={ledeClass}>Connect GitHub to launch agents on your repos without sharing credentials with anyone else.</p>
      <ul className="m-0 grid gap-2 pl-5 text-sm text-[var(--ink-2)]" aria-label="What signing in enables">
        <li>private repos stay tied to your GitHub account</li>
        <li>agents run in isolated sandboxes</li>
        <li>settings and auth stay per-user</li>
      </ul>
    </div>
    <div className="grid content-start gap-3 rounded-md border border-[var(--rule)] bg-[var(--paper-2)] p-4" aria-label="Sign in form">
      <p className={eyebrowClass}>account</p>
      <h3>Welcome back</h3>
      <GitHubSignInButton id="github-signin-main" />
      <p id="github-signin-status" className={statusLineClass} aria-live="polite">Checking GitHub sign-in…</p>
      <p className="text-sm text-[var(--ink-3)]">No shared model keys or repo tokens. GitHub opens in a secure OAuth window.</p>
    </div>
  </Surface>;
}

function ProjectOnboardingDialog() {
  const { actions, steps } = onboardingContent;
  return <dialog id="onboarding-dialog" className="onboarding-dialog" aria-labelledby="onboarding-title" aria-describedby="onboarding-copy">
    <div className="onboarding-shell">
      <Button id="onboarding-close" variant="ghost" size="icon" type="button" aria-label="close onboarding"><XIcon className="size-4" aria-hidden="true" /></Button>
      <div className="onboarding-copy">
        <p className={eyebrowClass}>{onboardingContent.eyebrow}</p>
        <h2 id="onboarding-title">{onboardingContent.title}</h2>
        <p id="onboarding-copy">{onboardingContent.copy}</p>
      </div>
      <ol className="onboarding-steps" aria-label="Onboarding checklist">
        {steps.map(({ id, title, body }, index) => <li key={id} data-onboarding-step={id} data-step-number={index + 1} data-state="todo">
          <span className="onboarding-step-num">{index + 1}</span>
          <span className="onboarding-step-body">
            <strong>{title}</strong>
            <small>{body}</small>
            <span className="onboarding-step-action">
              {id === 'github' && <GitHubSignInButton id="onboarding-github" data-onboarding-action="github" hidden>{actions.github}</GitHubSignInButton>}
              {id === 'project' && <Button id="onboarding-pick-repo" data-onboarding-action="project" variant="ghost" type="button" hidden><FolderOpenIcon {...buttonIconProps} />{actions.project}</Button>}
              {id === 'llm' && <Button as="a" id="onboarding-claude" data-onboarding-action="llm" variant="ghost" href="/settings.html#claude-code" hidden><TerminalWindowIcon {...buttonIconProps} />{actions.claude || 'Claude'}</Button>}
              {id === 'llm' && <Button as="a" id="onboarding-codex" data-onboarding-action="llm" variant="ghost" href="/settings.html#codex" hidden><OpenAiLogoIcon {...buttonIconProps} />{actions.codex || 'Codex'}</Button>}
            </span>
          </span>
        </li>)}
      </ol>
    </div>
  </dialog>;
}

function Brand({ href = '/', label = 'Spanner home', children }) {
  return <a className="inline-flex min-w-0 items-center gap-2.5 font-extrabold leading-none tracking-[-.03em] text-[var(--ink)]" href={href} aria-label={label}>
    <img className="block size-8 shrink-0 -translate-y-0.5" src="/logo-mark.svg" alt="" aria-hidden="true" />
    <span>spanner</span>
    {children ?? <span id="project-label" className="max-w-[min(32vw,220px)] overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-[var(--rule)] bg-[var(--paper-2)] px-2 py-1 font-[var(--mono)] text-[11px] font-bold leading-none tracking-normal text-[var(--blue)]" hidden></span>}
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

function WorkspaceManager({ className = '' }) {
  return <div className={cn('flex min-w-0 items-center gap-2 text-[var(--ink-3)]', className)} aria-label="Selected workspace"><strong id="workspace-label" className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.03em]">loading…</strong><Button as="a" variant="ghost" size="sm" className="h-7 shrink-0 px-1.5 text-[10px]" href="/"><FolderOpenIcon {...buttonIconProps} />switch</Button></div>;
}

function WorkspaceNav({ active = 'workspace', showBrand = true, showWorkspaceManager = true }) {
  return <nav className={topbarClass} aria-label="Spanner navigation">
    {showBrand && <Brand href="/workspace.html" label="Spanner workspace" />}
    {showWorkspaceManager && <WorkspaceManager />}
    <div className={headerActionsClass}>
      {active === 'workspace' && <AuthPills />}
      {active === 'workspace' && <GitHubSignInButton id="github-signin-nav" className="signin-nav-button">Sign in</GitHubSignInButton>}
      {active !== 'workspace' && <Button as="a" variant="ghost" href="/workspace.html"><RobotIcon {...buttonIconProps} />workspace</Button>}
      {active !== 'settings' && <Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button>}
    </div>
  </nav>;
}

export function ProjectPage() {
  return <main className="mx-auto w-[min(760px,calc(100%_-_clamp(24px,8vw,160px)))] px-0 py-5 pb-14 max-sm:w-[min(900px,calc(100%_-_24px))]">
    <nav className={topbarClass} aria-label="Spanner navigation">
      <Brand href="/" label="Spanner projects" />
      <div className={headerActionsClass}><AuthPills /><GitHubSignInButton id="github-signin-nav" className="signin-nav-button">Sign in</GitHubSignInButton><Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button></div>
    </nav>

    <GitHubSignInCard />
    <ProjectOnboardingDialog />

    <section id="project-grid" className="mx-auto mt-[clamp(24px,6vh,54px)] grid max-w-[640px] grid-cols-1 gap-4">
      <Surface as="form" id="project-form" className={cn(surfaceClass, 'grid gap-4 overflow-hidden p-4 md:p-5')} aria-labelledby="project-welcome">
        <input id="project-repo-source" name="repoSource" type="hidden" value="" readOnly />
        <input id="project-branch" name="branch" type="hidden" value="" readOnly />

        <div id="project-hero" className="grid gap-1.5 text-left">
          <h1 id="project-welcome" className="mb-0 text-[clamp(28px,3vw,38px)] leading-none tracking-[-.05em]">Welcome back.</h1>
          <p id="project-subtitle" className={cn(ledeClass, 'mb-0 max-w-[520px] text-sm')}>Choose a project to open.</p>
        </div>

        <div className="project-picker-panel grid gap-2.5 rounded-md border border-[var(--rule)] bg-[var(--paper-2)] p-2.5">
          <label className="sr-only" htmlFor="project-repo-url">folder or repo</label>
          <InputGroup as="div" className="relative grid-cols-[minmax(0,1fr)_auto] p-0 [&_input]:px-3 [&_input]:py-2.5">
            <input id="project-repo-url" name="repoUrl" placeholder="owner/repo or URL" aria-label="folder or repo" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="project-repo-options" required />
            <Button id="project-choose-folder" variant="ghost" size="icon" className="project-folder-button" type="button" hidden aria-label="choose local folder" title="choose local folder"><FolderOpenIcon {...buttonIconProps} /></Button>
            <div id="project-repo-options" className="repo-suggestions absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-auto rounded-md border border-[var(--rule-2)] bg-[var(--paper)] p-1 shadow-[var(--shadow-md)]" role="listbox" hidden></div>
          </InputGroup>
          <div id="project-repo-tray" className="flex flex-wrap items-center gap-2">
            <Button id="project-repo-refresh" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh repos</Button>
            <p id="project-repo-hint" className={mutedClass}></p>
          </div>
          <Button id="project-submit" variant="primary" className="w-full" type="submit">open workspace</Button>
          <p id="project-status" className={statusLineClass} aria-live="polite"></p>
        </div>

        <div className="project-recent-panel border-t border-[var(--rule)] pt-3" aria-label="Recent projects">
          <div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="mb-0.5">Recent projects</h2><p className={mutedClass}>One click back into a workspace.</p></div></div>
          <div id="project-recent-list" className="project-list grid gap-2"></div>
        </div>
      </Surface>
    </section>
  </main>;
}

export function WorkspacePage() {
  return <SidebarProvider className="workspace-shell min-h-svh bg-[var(--bg)]" style={{ '--sidebar-width': 'var(--workspace-sidebar-width, 22rem)' }}>
    <Sidebar className="border-r border-[var(--rule)]">
      <Surface id="agents-section" className="flex h-full min-h-0 flex-col bg-[var(--paper)]" aria-label="Agents">
        <SidebarHeader className="grid gap-3 border-b border-[var(--rule)] px-3 py-4">
          <Brand href="/workspace.html" label="Spanner workspace" />
          <div className={sectionRowClass}><WorkspaceManager className="w-full justify-between" /></div>
        </SidebarHeader>
        <SidebarContent className="min-h-0">
          <ScrollArea id="threads-list" className="action-lanes px-2 pb-5"></ScrollArea>
        </SidebarContent>
      </Surface>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-[var(--bg)] px-[clamp(16px,4vw,56px)] py-6 pb-18 max-sm:px-2.5 max-sm:py-2 max-sm:pb-7">
      <div className="workspace-mobile-nav mx-auto mb-5 flex w-[min(1180px,100%)] items-center gap-2 max-sm:mb-3">
        <SidebarTrigger className="workspace-sidebar-trigger border-[var(--rule)] bg-[var(--paper)] px-3 font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.04em] text-[var(--ink-2)] hover:bg-[var(--blue-soft)] hover:text-[var(--blue)] md:hidden">agents</SidebarTrigger>
        <WorkspaceNav active="workspace" showBrand={false} showWorkspaceManager={false} />
      </div>
      <h1 className="sr-only">Start a main agent</h1>
      <GitHubSignInCard compact />
      <InputMessage as="form" id="thread-form" className="launch-card" aria-label="Spin up a main agent">
        <input id="repo-url" name="repoUrl" type="hidden" value="" readOnly />
        <input name="branch" type="hidden" value="" readOnly />
        <input name="repoSource" type="hidden" value="" readOnly />
        <label className="sr-only" htmlFor="prompt">Task</label>
        <div className="launch-input-panel">
          <textarea id="prompt" name="prompt" rows="4" placeholder="Tell the main agent what to do…" required></textarea>
          <RunControls launch />
          <div className="target-row workspace-run-row"><Button id="thread-submit" variant="primary" className="run-btn" type="submit">start agent</Button></div>
        </div>
        <div className="repo-tray" hidden>
          <Select id="repo-picker" className="board-select" disabled><option value="">GitHub repos</option></Select>
          <Button id="repo-refresh" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh</Button>
          <Button id="choose-folder" variant="ghost" type="button" hidden><FolderOpenIcon {...buttonIconProps} />choose folder</Button>
          <p id="repo-hint" className="muted">Sign in for repo picker.</p>
        </div>
        <div className="advanced-fields launch-details"><input name="name" placeholder="main agent name" /><div id="provider-banner" className="notice" aria-live="polite">Connecting…</div></div>
        <section id="launch-suggestions" className="launch-suggestions" aria-label="Suggested starter prompts">
          <button type="button" data-suggested-prompt="Review the current diff, recent implementation notes, and latest finished agents, then pick the highest-leverage next task and do the smallest safe piece."><strong>Find next move</strong><span>Review diff, notes, and recent agents; do the smallest safe piece.</span></button>
          <button type="button" data-suggested-prompt="Use the product's main flow, identify one confusing or broken interaction, fix it, and run the narrowest check that proves it."><strong>Fix a paper cut</strong><span>Walk the core flow, repair one edge, and verify it.</span></button>
          <button type="button" data-suggested-prompt="Read the current workspace state and prepare a concise handoff with risks, next commands, and one safe cleanup if obvious."><strong>Prep a handoff</strong><span>Summarize risks, next commands, and one safe cleanup.</span></button>
        </section>
        <p id="thread-status" className="status-line"></p>
      </InputMessage>
    </SidebarInset>
  </SidebarProvider>;
}

export function ThreadPage() {
  return <main className="thread-flow-shell">
    <section className="thread-stage" aria-label="Main agent workspace">
      <header className="thread-main-header">
        <div className="thread-main-row">
          <a className="brand" href="/workspace.html" aria-label="Back to workspace"><span className="brand-box"><ArrowLeftIcon className="size-4" aria-hidden="true" /></span><span id="project-label" className="project-pill" hidden></span></a>
          <h1 id="thinking-title">Loading</h1>
          <div className="header-actions"><StatusPill id="thread-status">connecting</StatusPill><Button id="stop-thread" variant="ghost" className="thread-stop-btn" type="button" hidden><StopCircleIcon {...buttonIconProps} />stop</Button><Button id="resume-thread" variant="ghost" className="thread-resume-btn" type="button" hidden>resume</Button><Button id="delete-thread" variant="ghost" className="thread-delete-btn" type="button" hidden>delete</Button><Button id="archive-thread" variant="primary" className="thread-done-btn" type="button" hidden><CheckCircleIcon {...buttonIconProps} />archive</Button></div>
        </div>
        <p id="thinking-detail" className={mutedClass}></p>
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
        <Surface id="suggested-next-steps" className="next-steps-main launch-suggestions" aria-label="Suggested next steps" hidden><div id="suggested-next-steps-list" className="next-steps-list"></div></Surface>
        <Surface className="notes-main flow-card" aria-label="Implementation notes" hidden><div className="rail-head"><span>implementation notes</span><strong id="notes-count">0</strong></div><div id="notes-list" className="notes-list"></div></Surface>
        <InputMessage as="form" id="prompt-form" className="flow-composer">
          <div className="composer-field"><label className="sr-only" htmlFor="prompt">Prompt</label><textarea id="prompt" rows="3" placeholder="Next task…"></textarea><small id="composer-hint" className="composer-hint muted">Enter sends · Shift+Enter adds a line</small><RunControls /></div>
          <Button id="send" variant="primary" type="submit"><PaperPlaneTiltIcon {...buttonIconProps} />send</Button>
        </InputMessage>
      </section>
    </section>
    <dialog id="diff-dialog" className="diff-dialog" aria-labelledby="diff-dialog-title">
      <div className="diff-dialog-shell">
        <header className="diff-dialog-head"><div><p className={eyebrowClass}>changes</p><h2 id="diff-dialog-title">Full diff</h2></div><Button id="diff-dialog-close" variant="ghost" type="button"><ArrowLeftIcon {...buttonIconProps} />close</Button></header>
        <div id="diff-dialog-files" className="diff-dialog-files" role="list"></div>
        <div id="diff-dialog-body" className="diff-dialog-body" aria-label="Full diff"></div>
      </div>
    </dialog>
  </main>;
}

export function HistoryPage() {
  return <main className="mx-auto w-[min(1180px,calc(100%_-_34px))] px-0 py-6 pb-18">
    <WorkspaceNav active="history" />
    <header className="grid gap-4 py-8 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-end"><div><p className={eyebrowClass}>project history</p><h1>Past agents for this workspace</h1><p id="history-status" className={mutedClass}>Loading this project’s saved agents…</p></div><InputGroup label="search"><input id="history-search" type="search" placeholder="repo, prompt, status, name" /></InputGroup></header>
    <section id="history-stats" className="history-stats grid gap-3 md:grid-cols-4" aria-label="History summary"></section>
    <ScrollArea as="section" id="history-list" className="history-list mt-4 grid gap-3" aria-label="Past threads, sessions, and agents"></ScrollArea>
  </main>;
}

export function PerformancePage() {
  const isLocal = globalThis.location?.pathname?.includes('local-telemetry');
  return <main className="mx-auto w-[min(1180px,calc(100%_-_34px))] px-0 py-6 pb-18">
    <nav className={topbarClass} aria-label="Spanner navigation"><Brand href="/" /><div className={headerActionsClass}><Button as="a" variant="ghost" href="/workspace.html"><RobotIcon {...buttonIconProps} />agents</Button><Button as="a" variant="ghost" href={isLocal ? '/telemetry.html' : '/local-telemetry.html'}>{isLocal ? <DatabaseIcon {...buttonIconProps} /> : <ClockCounterClockwiseIcon {...buttonIconProps} />}{isLocal ? 'db telemetry' : 'local sessions'}</Button><Button as="a" variant="ghost" href="/settings.html"><GearSixIcon {...buttonIconProps} />settings</Button></div></nav>
    <section className="grid gap-3 py-8"><p className={eyebrowClass}>telemetry</p><h1>{isLocal ? 'Local session telemetry' : 'Agent telemetry'}</h1><p id="performance-status" className={mutedClass}>Loading {isLocal ? 'local session' : 'DB-derived'} agent metrics…</p><p className={mutedClass}>{isLocal ? 'Reads the desktop/local sessions file and ignores old browser-session IDs.' : 'Estimated from the session DB plus live run events. No extra product tracking.'}</p></section>
    <section id="performance-stats" className="performance-stats grid gap-3 md:grid-cols-4" aria-label="Telemetry summary"></section>
    <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"><div className="grid content-start gap-4"><Surface className={cn(surfaceClass, 'p-4')}><div className={sectionRowClass}><h2>Signals</h2><Button id="refresh-performance" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />refresh</Button></div><ul id="performance-insights" className="signal-list mt-3 grid gap-2"></ul></Surface><Surface className={cn(surfaceClass, 'p-4')}><div className={sectionRowClass}><h2>What this can show</h2><ChartLineIcon className="size-4" aria-hidden="true" /></div><ul id="telemetry-sources" className="signal-list telemetry-source-list mt-3 grid gap-2"></ul></Surface></div><Surface className={cn(surfaceClass, 'table-panel min-w-0 p-4')}><div className={sectionRowClass}><h2>Main agents</h2><p id="performance-count" className={mutedClass}></p></div><ScrollArea className="performance-table-wrap mt-3 overflow-auto"><table className="performance-table"><thead><tr><th>main agent</th><th>status</th><th>first llm</th><th>duration</th><th>tools</th><th>tokens</th><th>cache</th><th>analysis</th><th>flags</th></tr></thead><tbody id="performance-rows"></tbody></table></ScrollArea></Surface></section>
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

  return <main className="mx-auto w-[min(1180px,calc(100%_-_34px))] px-0 py-6 pb-18">
    <nav className={topbarClass} aria-label="Settings controls">
      <Brand href="/" label="Spanner home" />
      <div className={headerActionsClass}><Button as="a" variant="ghost" href="/"><RobotIcon {...buttonIconProps} />agents</Button></div>
    </nav>
    <p id="settings-global-status" className={settingsStatusClass} hidden></p>

    <header className="grid gap-4 py-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div><p className={eyebrowClass}>settings</p><h1>Settings</h1><p className={ledeClass}>Connect accounts, sync your Pi profile, and set the sandbox defaults agents use.</p></div>
      <Tabs className="justify-self-start md:justify-self-end" items={settingsTabs} />
    </header>

    <section className={settingsSectionClass} aria-labelledby="accounts-title">
      <div className={settingsSectionHeadClass}><p className={eyebrowClass}>01 · accounts</p><h2 id="accounts-title">Connect the tools agents use.</h2><p>Spanner forwards the right credentials into each run; reconnect when a provider needs fresh scope.</p></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Surface as="section" id="github" className={settingsCardClass} aria-labelledby="github-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><GithubLogoIcon className="size-4" /></span><div><h3 id="github-title">GitHub</h3><p>Repos, pushes, draft PRs, and workflow file edits.</p></div><Button id="github-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="github-status" className={settingsStatusClass}>Checking…</p><div className={settingsActionsClass}><Button id="github-app-install" variant="ghost" type="button"><WrenchIcon {...buttonIconProps} />Install app</Button><Button id="github-logout" variant="ghost" type="button"><SignOutIcon {...buttonIconProps} />Sign out</Button></div></Surface>
        <Surface as="section" id="codex" className={settingsCardClass} aria-labelledby="codex-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><OpenAiLogoIcon className="size-4" /></span><div><h3 id="codex-title">Codex</h3><p>Your OpenAI Codex session for Pi runs.</p></div><Button id="codex-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="codex-status" className={settingsStatusClass}>Checking…</p><div id="codex-device" className="notice hidden"></div><dialog id="codex-device-dialog" className="auth-dialog" aria-labelledby="codex-device-dialog-title" aria-describedby="codex-device-dialog-copy"><div className="auth-dialog-shell"><header className="auth-dialog-head"><div><h2 id="codex-device-dialog-title">Sign in with codex</h2></div><Button id="codex-device-close" variant="ghost" size="icon" type="button" aria-label="close"><XIcon className="size-4" aria-hidden="true" /></Button></header><div className="auth-dialog-body"><ol className="auth-steps codex-auth-steps"><li><div className="auth-step-content"><span id="codex-device-dialog-copy" className="auth-step-title">Copy this code</span><div className="auth-code-row"><code id="codex-device-code" className="auth-device-code">Loading…</code><Button id="codex-device-copy" variant="ghost" className="auth-code-copy" type="button" disabled><CopySimpleIcon {...buttonIconProps} /><span id="codex-device-copy-label">copy</span></Button></div></div></li><li><div className="auth-step-content"><span className="auth-step-title">Sign in with codex</span><a id="codex-device-open" className="auth-text-link" target="_blank" rel="noreferrer" aria-disabled="true"><span id="codex-device-open-label">Loading link…</span></a></div></li></ol></div></div></dialog></Surface>
        <Surface as="section" id="claude-code" className={settingsCardClass} aria-labelledby="claude-code-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="claude-code-title">Claude Code</h3><p>Your Claude Code session for Pi runs.</p></div><Button id="claude-code-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button></div><p id="claude-code-status" className={settingsStatusClass}>Checking…</p><dialog id="claude-code-dialog" className="auth-dialog" aria-labelledby="claude-code-dialog-title" aria-describedby="claude-code-dialog-copy"><div className="auth-dialog-shell"><header className="auth-dialog-head"><div><h2 id="claude-code-dialog-title">Sign in with Claude Code</h2></div><Button id="claude-code-close" variant="ghost" size="icon" type="button" aria-label="close"><XIcon className="size-4" aria-hidden="true" /></Button></header><div className="auth-dialog-body"><p id="claude-code-dialog-copy" className="auth-intro">Claude shows a one-time code after you approve access.</p><ol className="auth-steps claude-auth-steps"><li><div className="auth-step-content"><span className="auth-step-title">Open Claude sign-in</span><div className="auth-link-row"><a id="claude-code-open" className="auth-text-link" target="_blank" rel="noreferrer" aria-disabled="true"><span>Open Claude</span></a><Button id="claude-code-copy-link" variant="ghost" className="auth-inline-copy" type="button" disabled>Copy link</Button></div></div></li><li><div className="auth-step-content"><span className="auth-step-title">Copy the code Claude shows</span><p className="auth-step-note">Approve access in Claude, then copy the one-time code.</p></div></li><li><div className="auth-step-content"><span className="auth-step-title">Paste the code here</span><form id="claude-code-code-form" className="auth-code-form hidden"><div className="auth-input-row"><input id="claude-code-code" name="code" placeholder="code#state" autoComplete="off" /><Button id="claude-code-paste" variant="ghost" className="auth-input-action" type="button">Paste</Button></div><div className="auth-inline-actions"><Button id="claude-code-code-submit" variant="primary" type="submit">Finish sign in</Button></div></form></div></li></ol><div id="claude-code-auth" className="notice hidden"></div><p id="claude-code-dialog-status" className="sr-only" aria-live="polite">Starting…</p></div></div></dialog></Surface>
      </div>
    </section>

    <section className={settingsSectionClass} aria-labelledby="pi-profile-title">
      <div className={settingsSectionHeadClass}><p className={eyebrowClass}>02 · profile</p><h2 id="pi-profile-title">Choose what Pi carries into a run.</h2><p>Instructions and optional resources stay explicit. Nothing is baked into public images.</p></div>
      <Surface as="section" id="pi-profile" className={settingsCardClass} aria-labelledby="pi-profile-title"><form id="pi-profile-form" className="stack-lg"><label className="full-width settings-code-field"><span>AGENTS.md</span><textarea id="pi-agents" rows="8" spellCheck="false" placeholder="Spanner Pi instructions"></textarea><small id="pi-agents-path" className={mutedClass}>Loading…</small></label><Switch id="pi-sync-remote" label="Sync selected profile to remote sandboxes" help="Per run; not baked into public images." /><div className="profile-resource-grid"><div className="settings-resource-panel"><h3>Skills</h3><div id="pi-skills" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Extensions</h3><div id="pi-extensions" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Prompts</h3><div id="pi-prompts" className="resource-list muted">Loading…</div></div></div><div className="form-actions flex flex-wrap items-center gap-2"><Button id="pi-profile-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save profile</Button><p id="pi-profile-status" className={settingsStatusClass}>Loading…</p></div></form></Surface>
    </section>

    <section className={settingsSectionClass} aria-labelledby="runtime-title">
      <div className={settingsSectionHeadClass}><p className={eyebrowClass}>03 · runtime</p><h2 id="runtime-title">Set remote sandbox defaults.</h2><p>Leave fields blank to keep safe defaults or existing secrets.</p></div>
      <div className="grid gap-4 lg:grid-cols-2"><Surface as="section" id="sandbox" className={settingsCardClass} aria-labelledby="sandbox-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><CubeIcon className="size-4" /></span><div><h3 id="sandbox-title">Sandbox</h3><p>Image and registry credentials for remote environments.</p></div></div><form id="settings-form" className="stack-lg"><div className="form-grid"><label className="full-width"><span>Image ref</span><input id="image-ref" name="imageRef" placeholder="image ref" /><small>Blank = default.</small></label><label><span>Registry username</span><input id="registry-username" name="registryUsername" placeholder="username" autoComplete="username" /></label><label><span>Registry token</span><input id="registry-password" name="registryPassword" type="password" placeholder="token" autoComplete="current-password" /><small>Blank keeps current.</small></label><label className="full-width"><span>Anthropic API key</span><input id="anthropic-api-key" name="anthropicApiKey" type="password" placeholder="API key" autoComplete="off" /><small>Blank keeps current.</small></label></div><div className="form-actions flex flex-wrap items-center gap-2"><Button id="settings-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save sandbox</Button><p id="settings-status" className={settingsStatusClass}>Loading…</p></div></form></Surface><Surface as="section" id="desktop-updates" className={settingsCardClass} hidden aria-labelledby="desktop-updates-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="desktop-updates-title">Desktop updates</h3><p>Check GitHub Releases for a newer desktop build.</p></div></div><p id="desktop-update-status" className={settingsStatusClass}>Desktop only.</p><div className={settingsActionsClass}><Button id="desktop-check-updates" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />Check for updates</Button></div></Surface></div>
    </section>
  </main>;
}

function DesktopLandingPage() {
  const receiptRows = [
    ['AGENTS.md', '✓'],
    ['skills + prompts', '✓'],
    ['providers', '✓'],
    ['env keys', '6 scoped'],
    ['checks', 'npm test'],
  ];
  const workRows = [
    ['diff', '3 files'],
    ['checks', 'passed'],
    ['screenshot', <span className="landing-thumb" aria-hidden="true" />],
  ];
  const cards = [
    ['Starts with your Pi', 'Every run begins by loading the setup you already trust: repo instructions, skills, prompts, providers, setup commands, secrets, and checks.'],
    ['Runs in a real browser sandbox', 'Start, watch, and reopen Pi work from any browser while the coding agent runs on a remote machine built for the repo.'],
    ['Comes back with evidence', 'Standing runs return diffs, logs, checks, screenshots, decisions, failures, and next actions—not vague agent summaries.'],
  ];
  return <>
    <style>{`
      /* Design source: DESIGN.md */
      .landing-page { --ds-bg:#FAF8F3; --ds-surface:#FFFDF8; --ds-surface-2:#EFEAD9; --ds-text:#241A12; --ds-muted:#4B3A2D; --ds-quiet:#78635A; --ds-line:rgba(31,94,156,.16); --ds-line-strong:rgba(31,94,156,.30); --ds-accent:#1F5E9C; --ds-success:#17634A; min-height:100vh; background-color:var(--ds-bg); background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.14, 0 0 0 0 0.10, 0 0 0 0 0.07, 0 0 0 0.025 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); color:var(--ds-text); font:16px/1.5 var(--sans); }
      .landing-shell { width:min(1120px, calc(100% - 40px)); margin:0 auto; padding:28px 0 56px; }
      .landing-nav, .landing-actions, .landing-footer, .landing-links, .landing-browser-title, .landing-tabs, .landing-row, .landing-tomorrow { display:flex; align-items:center; }
      .landing-nav, .landing-footer { justify-content:space-between; gap:16px; }
      .landing-brand { display:inline-flex; align-items:center; gap:10px; color:inherit; text-decoration:none; font-weight:900; letter-spacing:-.05em; }
      .landing-brand img { width:30px; height:30px; image-rendering:pixelated; }
      .landing-links { gap:14px; }
      .landing-links a, .landing-footer a, .landing-link-button { color:var(--ds-muted); font:inherit; font-size:14px; font-weight:800; text-decoration:none; }
      .landing-link-button { border:1px solid var(--ds-line); border-radius:8px; padding:8px 11px; background:var(--ds-surface); cursor:pointer; text-transform:lowercase; letter-spacing:.04em; }
      .landing-page .landing-link-button { background:var(--ds-surface) !important; color:var(--ds-muted) !important; }
      .landing-hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,400px); gap:clamp(30px,6vw,78px); align-items:center; padding:clamp(58px,10vw,116px) 0 46px; }
      .landing-kicker, .landing-eyebrow { margin:0; color:var(--ds-accent); font-size:11px; font-weight:900; letter-spacing:.13em; text-transform:lowercase; }
      .landing-page h1 { max-width:830px; margin:12px 0 18px; font-size:clamp(54px,8.8vw,104px); line-height:.84; letter-spacing:-.1em; font-weight:900; }
      .landing-lede { max-width:710px; margin:0; color:var(--ds-muted); font-size:clamp(19px,2.2vw,24px); line-height:1.34; font-weight:650; }
      .landing-actions { justify-content:flex-start; flex-wrap:wrap; gap:12px; margin-top:34px; }
      .landing-button { display:inline-flex; min-height:48px; align-items:center; justify-content:center; border:1px solid var(--ds-accent); border-radius:8px; padding:0 18px; background:var(--ds-accent); color:#FAF8F3; font-weight:900; text-decoration:none; text-transform:lowercase; }
      .landing-button.secondary { background:var(--ds-surface); color:var(--ds-accent); border-color:var(--ds-line); }
      .landing-browser, .landing-card, .signin-modal { border:1px solid var(--ds-line); background:var(--ds-surface); }
      .landing-browser { border-radius:22px; overflow:hidden; box-shadow:0 24px 80px rgba(31,94,156,.10); }
      .landing-browser-title { justify-content:space-between; gap:12px; padding:13px 16px; border-bottom:1px solid var(--ds-line); }
      .landing-tabs { gap:6px; }
      .landing-dot { width:9px; height:9px; border-radius:999px; background:#B8AB9B; }
      .landing-url { margin-left:8px; border:1px solid var(--ds-line); border-radius:999px; padding:5px 10px; color:var(--ds-quiet); background:#fff; font-size:12px; font-weight:800; }
      .landing-state { color:var(--ds-success); font-size:13px; font-weight:900; }
      .landing-browser-body { display:grid; grid-template-columns:.88fr 1.12fr; gap:12px; padding:14px; }
      .landing-receipt, .landing-work, .landing-tomorrow { border:1px solid var(--ds-line); border-radius:16px; background:#FFFDF8; }
      .landing-receipt, .landing-work { padding:13px; }
      .landing-receipt h2, .landing-work h2 { margin:0 0 10px; font-size:16px; letter-spacing:-.04em; font-weight:900; }
      .landing-row { justify-content:space-between; gap:8px; border-top:1px solid var(--ds-line); padding:9px 0; color:var(--ds-muted); font-size:13px; font-weight:800; }
      .landing-row:first-of-type { border-top:0; }
      .landing-check { color:var(--ds-success); font-weight:900; }
      .landing-terminal { border:1px solid var(--ds-line-strong); border-radius:12px; padding:11px; background:#DDEBF6; color:var(--ds-text); font-weight:800; }
      .landing-terminal span { display:block; margin-top:5px; color:var(--ds-muted); font-size:13px; }
      .landing-thumb { width:54px; height:34px; border:1px solid var(--ds-line); border-radius:8px; background:linear-gradient(135deg,#DDEBF6,#DDEDE6); }
      .landing-tomorrow { grid-column:1/-1; justify-content:space-between; gap:12px; padding:12px 13px; background:#DDEDE6; color:var(--ds-muted); font-weight:800; }
      .landing-tomorrow strong { color:var(--ds-success); }
      .landing-strip { border-top:1px solid var(--ds-line); border-bottom:1px solid var(--ds-line); padding:17px 0; color:var(--ds-muted); font-weight:850; }
      .landing-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-top:16px; }
      .landing-card { min-height:148px; border-radius:16px; padding:18px; }
      .landing-card h2 { margin:0 0 8px; font-size:20px; letter-spacing:-.045em; line-height:1.1; font-weight:900; }
      .landing-page p { margin:0; color:var(--ds-muted); }
      .landing-footer { margin-top:52px; color:var(--ds-muted); font-size:13px; }
      .signin-modal { width:min(480px, calc(100% - 28px)); border-radius:12px; padding:0; color:var(--ds-text); box-shadow:0 24px 70px rgba(31,94,156,.10); }
      .signin-modal::backdrop { background:rgba(0,0,0,.68); backdrop-filter:blur(5px); }
      .modal-card { padding:24px; }
      .modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; }
      .modal-head h2 { margin:4px 0 8px; font-size:30px; line-height:1; }
      .close-button { width:34px; height:34px; border:1px solid var(--ds-line); border-radius:999px; background:transparent; color:var(--ds-muted); font-size:20px; cursor:pointer; }
      .github-button { width:100%; min-height:50px; border:1px solid var(--ds-accent); border-radius:8px; background:var(--ds-accent); color:#FAF8F3; font-weight:900; cursor:pointer; text-transform:lowercase; }
      .github-button:disabled { opacity:.55; cursor:not-allowed; }
      .modal-proof { margin:18px 0 0; padding-left:18px; color:var(--ds-muted); }
      .modal-status { min-height:21px; margin-top:14px; color:var(--ds-muted); font-size:14px; }
      @media (max-width:900px) { .landing-shell { width:min(100% - 28px,1120px); } .landing-nav, .landing-footer { align-items:flex-start; flex-direction:column; } .landing-links { width:100%; justify-content:space-between; } .landing-hero, .landing-grid, .landing-browser-body { grid-template-columns:1fr; } .landing-button { width:100%; } }
    `}</style>
    <div className="landing-page">
      <main className="landing-shell">
        <nav className="landing-nav" aria-label="Spanner navigation">
          <a className="landing-brand" href="/"><img src="/logo-mark.svg" alt="" aria-hidden="true" /><span>spanner</span></a>
          <div className="landing-links"><button id="signin-open" className="landing-link-button" type="button" data-open-signin>Sign in</button><a href="/">web app</a></div>
        </nav>
        <section className="landing-hero" aria-labelledby="title">
          <div>
            <p className="landing-kicker">remote pi, your setup</p>
            <h1 id="title">Run your Pi setup in a browser sandbox.</h1>
            <p className="landing-lede">Spanner opens a real remote coding sandbox, loads your AGENTS.md, skills, prompts, providers, setup commands, and checks, then returns the work as diffs, logs, screenshots, and a run you can reopen tomorrow.</p>
            <div className="landing-actions"><a className="landing-button" href="/">Open a Pi sandbox</a><a className="landing-button secondary" href="#receipt">See the setup receipt</a></div>
          </div>
          <aside className="landing-browser" aria-label="Example agent run" id="receipt">
            <div className="landing-browser-title"><div className="landing-tabs"><span className="landing-dot"></span><span className="landing-dot"></span><span className="landing-dot"></span><span className="landing-url">spanner.run/thread/pi</span></div><span className="landing-state">remote ready</span></div>
            <div className="landing-browser-body">
              <div className="landing-receipt"><p className="landing-eyebrow">setup receipt</p><h2>Loaded before work starts</h2>{receiptRows.map(([label, value]) => <div className="landing-row" key={label}><span>{label}</span><span className={value === '✓' ? 'landing-check' : ''}>{value}</span></div>)}</div>
              <div className="landing-work"><p className="landing-eyebrow">remote sandbox</p><h2>Pi is working in the repo</h2><div className="landing-terminal">$ pi fix the auth callback race<span>reading files · editing branch · running checks</span></div>{workRows.map(([label, value]) => <div className="landing-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
              <div className="landing-tomorrow"><span>Tomorrow&apos;s pass</span><strong>same Pi setup · fresh sandbox · new evidence</strong></div>
            </div>
          </aside>
        </section>
        <div className="landing-strip">Your Pi habits · fresh remote sandboxes · reviewable work · repeat tomorrow</div>
        <section className="landing-grid" aria-label="Spanner features">{cards.map(([title, body]) => <article className="landing-card" key={title}><h2>{title}</h2><p>{body}</p></article>)}</section>
        <footer className="landing-footer"><span>For Pi users who want their local setup to keep working when the laptop closes, the repo needs another pass, or tomorrow&apos;s agent should remember today&apos;s rules.</span><a href="https://github.com/anishthite/spanner-downloads/releases/latest">desktop release</a></footer>
      </main>
      <dialog id="signin-modal" className="signin-modal" aria-labelledby="signin-title">
        <div className="modal-card">
          <div className="modal-head"><div><p className="landing-eyebrow">GitHub sign-in</p><h2 id="signin-title">Build with your repos.</h2><p>Sign in with GitHub so Spanner can launch agents against the repos you choose.</p></div><button id="signin-close" className="close-button" type="button" aria-label="Close sign-in modal">×</button></div>
          <button id="github-signin" className="github-button" type="button">Continue with GitHub</button>
          <p id="signin-status" className="modal-status" role="status" aria-live="polite">Checking GitHub sign-in…</p>
          <ul className="modal-proof"><li>private repos stay tied to your GitHub account</li><li>agents run in isolated workspaces</li><li>you review every diff before it lands</li></ul>
        </div>
      </dialog>
    </div>
  </>;
}

export const pages = {
  project: ProjectPage,
  workspace: WorkspacePage,
  thread: ThreadPage,
  settings: SettingsPage,
  history: HistoryPage,
  performance: PerformancePage,
  desktop: DesktopLandingPage,
  traceComponents: TraceComponentsPage,
};
