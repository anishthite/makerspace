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
} from './components/ui.jsx';
import onboardingContent from './onboarding-content.json';
import { TraceComponentsPage } from './trace-components-page.jsx';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
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
    {children}
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

function WorkspaceManager({ className = '', prominent = false }) {
  const labelClass = cn(
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-[var(--mono)] font-bold lowercase tracking-[.03em]',
    prominent ? 'text-[15px] leading-none text-[var(--ink)]' : 'text-[11px]'
  );
  const buttonClass = prominent ? 'h-10 shrink-0 px-3 text-[12px]' : 'h-7 shrink-0 px-1.5 text-[10px]';

  return <div className={cn('flex min-w-0 items-center text-[var(--ink-3)]', prominent ? 'gap-3' : 'gap-2', className)} aria-label="Selected workspace"><strong id="workspace-label" className={labelClass}>loading…</strong><Button as="a" variant="ghost" size={prominent ? 'md' : 'sm'} className={buttonClass} href="/"><FolderOpenIcon {...buttonIconProps} />switch</Button></div>;
}

function WorkspaceNav({ active = 'workspace', showBrand = true, showWorkspaceManager = true, workspaceManagerClassName = '', workspaceManagerProminent = false }) {
  return <nav className={topbarClass} aria-label="Spanner navigation">
    {showBrand && <Brand href="/workspace.html" label="Spanner workspace" />}
    {showWorkspaceManager && <WorkspaceManager className={workspaceManagerClassName} prominent={workspaceManagerProminent} />}
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
  return <SidebarProvider className="min-h-svh bg-[var(--bg)]" style={{ '--sidebar-width': 'var(--workspace-sidebar-width, 22rem)' }}>
    <Sidebar className="border-r border-[var(--rule)]" collapsible="none">
      <Surface id="agents-section" className="flex h-full min-h-0 flex-col bg-[var(--paper)]" aria-label="Agents">
        <SidebarHeader className="grid gap-3 border-b border-[var(--rule)] px-3 py-4">
          <Brand href="/workspace.html" label="Spanner workspace" />
        </SidebarHeader>
        <SidebarContent className="min-h-0">
          <ScrollArea id="threads-list" className="action-lanes px-2 pb-5"></ScrollArea>
        </SidebarContent>
      </Surface>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-[var(--bg)] px-[clamp(16px,4vw,56px)] py-6 pb-18 max-sm:px-2.5 max-sm:py-3 max-sm:pb-7">
      <div className="mx-auto mb-5 flex w-[min(1180px,100%)] items-center gap-2 max-sm:mb-3 max-sm:items-start"><WorkspaceNav active="workspace" showBrand={false} workspaceManagerProminent workspaceManagerClassName="max-w-[min(52vw,560px)]" /></div>
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
  return <main className="mx-auto w-[min(1180px,calc(100%_-_34px))] px-0 py-6 pb-18">
    <nav className={topbarClass} aria-label="Settings controls">
      <Brand href="/" label="Spanner home" />
      <div className={headerActionsClass}><Button as="a" variant="ghost" href="/"><RobotIcon {...buttonIconProps} />agents</Button></div>
    </nav>
    <p id="settings-global-status" className={settingsStatusClass} hidden></p>

    <header className="py-8">
      <h1>Settings</h1>
    </header>

    <section className={settingsSectionClass} aria-labelledby="accounts-title">
      <div className="max-w-[720px]"><h2 id="accounts-title" className="mb-0" style={{ fontSize: 'clamp(42px, 6vw, 72px)', lineHeight: '.9', letterSpacing: '-.07em' }}>Accounts</h2></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Surface as="section" id="github" className={settingsCardClass} aria-labelledby="github-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><GithubLogoIcon className="size-4" /></span><div><h3 id="github-title">GitHub</h3><p>Repos, pushes, draft PRs, and workflow file edits.</p></div><div className="flex justify-end gap-2"><Button id="github-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button><Button id="github-logout" variant="ghost" type="button" hidden><SignOutIcon {...buttonIconProps} />Sign out</Button></div></div><p id="github-status" className={settingsStatusClass}>Checking…</p><div className={settingsActionsClass} hidden><Button id="github-app-install" variant="ghost" type="button" hidden><WrenchIcon {...buttonIconProps} />Install app</Button></div></Surface>
        <Surface as="section" id="codex" className={settingsCardClass} aria-labelledby="codex-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><OpenAiLogoIcon className="size-4" /></span><div><h3 id="codex-title">Codex</h3><p>Your OpenAI Codex session for Pi runs.</p></div><div className="flex justify-end gap-2"><Button id="codex-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button><Button id="codex-logout" variant="ghost" type="button" hidden><SignOutIcon {...buttonIconProps} />Sign out</Button></div></div><p id="codex-status" className={settingsStatusClass}>Checking…</p><div id="codex-device" className="notice hidden"></div><dialog id="codex-device-dialog" className="auth-dialog" aria-labelledby="codex-device-dialog-title" aria-describedby="codex-device-dialog-copy"><div className="auth-dialog-shell"><header className="auth-dialog-head"><div><h2 id="codex-device-dialog-title">Sign in with codex</h2></div><Button id="codex-device-close" variant="ghost" size="icon" type="button" aria-label="close"><XIcon className="size-4" aria-hidden="true" /></Button></header><div className="auth-dialog-body"><ol className="auth-steps codex-auth-steps"><li><div className="auth-step-content"><span id="codex-device-dialog-copy" className="auth-step-title">Copy this code</span><div className="auth-code-row"><code id="codex-device-code" className="auth-device-code">Loading…</code><Button id="codex-device-copy" variant="ghost" className="auth-code-copy" type="button" disabled><CopySimpleIcon {...buttonIconProps} /><span id="codex-device-copy-label">copy</span></Button></div></div></li><li><div className="auth-step-content"><span className="auth-step-title">Sign in with codex</span><a id="codex-device-open" className="auth-text-link" target="_blank" rel="noreferrer" aria-disabled="true"><span id="codex-device-open-label">Loading link…</span></a></div></li></ol></div></div></dialog></Surface>
        <Surface as="section" id="claude-code" className={settingsCardClass} aria-labelledby="claude-code-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="claude-code-title">Claude Code</h3><p>Your Claude Code session for Pi runs.</p></div><div className="flex justify-end gap-2"><Button id="claude-code-login" variant="primary" type="button"><SignInIcon {...buttonIconProps} />Sign in</Button><Button id="claude-code-logout" variant="ghost" type="button" hidden><SignOutIcon {...buttonIconProps} />Sign out</Button></div></div><p id="claude-code-status" className={settingsStatusClass}>Checking…</p><dialog id="claude-code-dialog" className="auth-dialog" aria-labelledby="claude-code-dialog-title" aria-describedby="claude-code-dialog-copy"><div className="auth-dialog-shell"><header className="auth-dialog-head"><div><h2 id="claude-code-dialog-title">Sign in with Claude Code</h2></div><Button id="claude-code-close" variant="ghost" size="icon" type="button" aria-label="close"><XIcon className="size-4" aria-hidden="true" /></Button></header><div className="auth-dialog-body"><p id="claude-code-dialog-copy" className="auth-intro">Claude shows a one-time code after you approve access.</p><ol className="auth-steps claude-auth-steps"><li><div className="auth-step-content"><span className="auth-step-title">Open Claude sign-in</span><div className="auth-link-row"><a id="claude-code-open" className="auth-text-link" target="_blank" rel="noreferrer" aria-disabled="true"><span>Open Claude</span></a><Button id="claude-code-copy-link" variant="ghost" className="auth-inline-copy" type="button" disabled>Copy link</Button></div></div></li><li><div className="auth-step-content"><span className="auth-step-title">Copy the code Claude shows</span><p className="auth-step-note">Approve access in Claude, then copy the one-time code.</p></div></li><li><div className="auth-step-content"><span className="auth-step-title">Paste the code here</span><form id="claude-code-code-form" className="auth-code-form hidden"><div className="auth-input-row"><input id="claude-code-code" name="code" placeholder="code#state" autoComplete="off" /><Button id="claude-code-paste" variant="ghost" className="auth-input-action" type="button">Paste</Button></div><div className="auth-inline-actions"><Button id="claude-code-code-submit" variant="primary" type="submit">Finish sign in</Button></div></form></div></li></ol><div id="claude-code-auth" className="notice hidden"></div><p id="claude-code-dialog-status" className="sr-only" aria-live="polite">Starting…</p></div></div></dialog></Surface>
      </div>
    </section>

    <section className={settingsSectionClass} aria-labelledby="pi-profile-title" hidden>
      <div className={settingsSectionHeadClass}><p className={eyebrowClass}>02 · profile</p><h2 id="pi-profile-title">Choose what Pi carries into a run.</h2><p>Instructions and optional resources stay explicit. Nothing is baked into public images.</p></div>
      <Surface as="section" id="pi-profile" className={settingsCardClass} aria-labelledby="pi-profile-title"><form id="pi-profile-form" className="stack-lg"><label className="full-width settings-code-field"><span>AGENTS.md</span><textarea id="pi-agents" rows="8" spellCheck="false" placeholder="Spanner Pi instructions"></textarea><small id="pi-agents-path" className={mutedClass}>Loading…</small></label><Switch id="pi-sync-remote" label="Sync selected profile to remote sandboxes" help="Per run; not baked into public images." /><div className="profile-resource-grid"><div className="settings-resource-panel"><h3>Skills</h3><div id="pi-skills" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Extensions</h3><div id="pi-extensions" className="resource-list muted">Loading…</div></div><div className="settings-resource-panel"><h3>Prompts</h3><div id="pi-prompts" className="resource-list muted">Loading…</div></div></div><div className="form-actions flex flex-wrap items-center gap-2"><Button id="pi-profile-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save profile</Button><p id="pi-profile-status" className={settingsStatusClass}>Loading…</p></div></form></Surface>
    </section>

    <section className={settingsSectionClass} aria-labelledby="runtime-title" hidden>
      <div className={settingsSectionHeadClass}><p className={eyebrowClass}>03 · runtime</p><h2 id="runtime-title">Set remote sandbox defaults.</h2><p>Leave fields blank to keep safe defaults or existing secrets.</p></div>
      <div className="grid gap-4 lg:grid-cols-2"><Surface as="section" id="sandbox" className={settingsCardClass} aria-labelledby="sandbox-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><CubeIcon className="size-4" /></span><div><h3 id="sandbox-title">Sandbox</h3><p>Image and registry credentials for remote environments.</p></div></div><form id="settings-form" className="stack-lg"><div className="form-grid"><label className="full-width"><span>Image ref</span><input id="image-ref" name="imageRef" placeholder="image ref" /><small>Blank = default.</small></label><label><span>Registry username</span><input id="registry-username" name="registryUsername" placeholder="username" autoComplete="username" /></label><label><span>Registry token</span><input id="registry-password" name="registryPassword" type="password" placeholder="token" autoComplete="current-password" /><small>Blank keeps current.</small></label><label className="full-width"><span>Anthropic API key</span><input id="anthropic-api-key" name="anthropicApiKey" type="password" placeholder="API key" autoComplete="off" /><small>Blank keeps current.</small></label></div><div className="form-actions flex flex-wrap items-center gap-2"><Button id="settings-submit" variant="primary" type="submit"><FloppyDiskIcon {...buttonIconProps} />Save sandbox</Button><p id="settings-status" className={settingsStatusClass}>Loading…</p></div></form></Surface><Surface as="section" id="desktop-updates" className={settingsCardClass} hidden aria-labelledby="desktop-updates-title"><div className={settingsCardHeadClass}><span className={settingsMarkClass} aria-hidden="true"><TerminalWindowIcon className="size-4" /></span><div><h3 id="desktop-updates-title">Desktop updates</h3><p>Check GitHub Releases for a newer desktop build.</p></div></div><p id="desktop-update-status" className={settingsStatusClass}>Desktop only.</p><div className={settingsActionsClass}><Button id="desktop-check-updates" variant="ghost" type="button"><ArrowsClockwiseIcon {...buttonIconProps} />Check for updates</Button></div></Surface></div>
    </section>
  </main>;
}

function DesktopLandingPage() {
  const workflowSteps = [
    ['Choose a repo', 'Pick a GitHub repo or local folder. Spanner keeps the boring project setup out of the prompt.'],
    ['Build the sandbox', 'A remote machine starts with the repo, setup commands, and scoped credentials.'],
    ['Load your Pi setup', 'AGENTS.md, skills, prompts, providers, and checks arrive before work starts.'],
    ['Let the agent work', 'Pi reads files, edits a branch, runs commands, and streams the transcript back.'],
    ['Review the evidence', 'Diffs, logs, screenshots, notes, and failures stay attached to the run.'],
    ['Resume later', 'Reopen the thread tomorrow with the same rules and a fresh sandbox.'],
  ];
  const proofMarkdown = `# Remote Pi Plan
Goal: keep local Pi setup and remote sandbox work reviewable.

Move the setup receipt above {==the agent transcript==}{>>This should be the main proof, not a footnote.<<}{#c1}

{~~remote runner~>browser sandbox~~}{#s1} that loads AGENTS.md, skills, prompts, and checks before work starts.

Keep screenshots, diffs, logs, and comments attached to the run.`;
  return <>
    <style>{`
      /* Design source: roughdraft.md + DESIGN.md */
      .landing-page { --ds-bg:var(--bg,#050607); --ds-surface:var(--paper,#1D2530); --ds-surface-2:var(--paper-2,#263142); --ds-text:var(--ink,#F1F5FA); --ds-muted:var(--ink-2,#D3DAE7); --ds-quiet:var(--ink-3,#9BA8BA); --ds-line:var(--rule,rgba(140,189,253,.18)); --ds-line-strong:var(--rule-2,rgba(140,189,253,.32)); --ds-accent:var(--blue,#8CBDFD); --ds-green:#64da70; --ds-yellow:#d99a18; --ds-red:var(--red,#F1A1B6); --landing-font:'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; position:relative; min-height:100svh; overflow:hidden; background:var(--ds-bg); color:var(--ds-text); font:16px/1.5 var(--landing-font); font-optical-sizing:auto; }
      .landing-page::before { content:''; position:absolute; inset:0; z-index:1; pointer-events:none; opacity:.16; background-image:radial-gradient(rgba(245,242,234,.22) .55px, transparent .7px),radial-gradient(rgba(245,242,234,.12) .45px, transparent .7px); background-position:0 0,2px 2px; background-size:4px 4px; }
      .landing-shell { position:relative; z-index:2; display:grid; grid-template-rows:auto 1fr; width:min(1500px, calc(100% - 48px)); min-height:100svh; margin:0 auto; padding:32px 0; }
      .landing-nav, .landing-links, .landing-actions, .landing-shot-menu, .landing-window-title, .landing-step-head, .landing-footer, .landing-result-toolbar, .landing-agent-head { display:flex; align-items:center; }
      .landing-nav, .landing-footer, .landing-agent-head { justify-content:space-between; gap:18px; }
      .landing-brand { display:inline-flex; align-items:center; gap:10px; color:var(--ds-text); text-decoration:none; font-size:clamp(18px,.9rem + .35vw,22px); font-weight:850; letter-spacing:-.03em; }
      .landing-brand-mark { display:block; width:34px; height:34px; object-fit:contain; transform:translateY(-1px); }
      .landing-links { gap:18px; }
      .landing-links a, .landing-footer a, .landing-link-button, .landing-github-link { color:var(--ds-quiet); font:inherit; font-size:13px; font-weight:750; text-decoration:none; }
      .landing-link-button { border:0; background:transparent; cursor:pointer; padding:0; }
      .landing-page .landing-link-button { color:var(--ds-quiet) !important; background:transparent !important; }
      .landing-hero { align-self:center; display:grid; grid-template-columns:minmax(0,.92fr) minmax(360px,.54fr); gap:clamp(34px,6vw,92px); align-items:center; padding:0 0 clamp(48px,12vh,120px); }
      .landing-page h1 { max-width:920px; margin:0 0 24px; color:var(--ds-text); font-size:clamp(60px,8.2vw,112px); line-height:.9; letter-spacing:-.055em; font-weight:650; }
      .landing-lede { max-width:760px; margin:0; color:var(--ds-muted); font-size:clamp(18px,1.35vw,24px); line-height:1.08; font-weight:650; }
      .landing-actions { flex-wrap:wrap; gap:14px; margin-top:32px; }
      .landing-button { display:inline-flex; min-height:56px; align-items:center; justify-content:center; border:1px solid color-mix(in srgb,var(--ds-accent) 70%,var(--ds-line)); border-radius:10px; padding:0 22px; background:#f3f1e8; color:#081018; font-size:clamp(18px,1rem + .45vw,20px); font-weight:950; text-decoration:none; }
      .landing-github-link { display:inline-flex; min-height:56px; align-items:center; color:color-mix(in srgb,var(--ds-text) 58%,transparent); }
      .landing-agent-loop { position:relative; min-height:520px; border-left:1px solid rgba(255,255,255,.08); padding-left:30px; }
      .landing-agent-head { position:relative; z-index:1; margin-bottom:18px; color:color-mix(in srgb,var(--ds-text) 58%,transparent); font:900 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; text-transform:lowercase; }
      .landing-agent-stack { position:relative; z-index:1; height:352px; overflow:hidden; mask-image:linear-gradient(transparent 0,#000 9%,#000 88%,transparent 100%); }
      .landing-agent { position:absolute; left:0; right:0; display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:14px; align-items:center; min-height:74px; border:1px solid rgba(255,255,255,.07); border-radius:15px; background:linear-gradient(90deg,rgba(255,255,255,.035),rgba(255,255,255,.012)); padding:14px 16px; transform:translateY(calc(var(--slot) * 86px)); transition:transform .72s cubic-bezier(.2,.8,.2,1),opacity .45s ease,border-color .3s ease,background .3s ease; }
      .landing-agent.is-leaving { transform:translateY(-88px); opacity:0; }
      .landing-agent.is-entering { transform:translateY(430px); opacity:0; }
      .landing-agent.is-done { border-color:rgba(100,218,112,.22); background:linear-gradient(90deg,rgba(100,218,112,.055),rgba(255,255,255,.012)); }
      .landing-agent-dot { position:relative; width:22px; height:22px; }
      .landing-agent-dot::before, .landing-agent-dot::after { content:''; position:absolute; inset:50% auto auto 50%; border-radius:999px; transform:translate(-50%,-50%); }
      .landing-agent-dot::before { width:10px; height:10px; background:var(--ds-yellow); box-shadow:0 0 15px rgba(217,154,24,.88),0 0 34px rgba(217,154,24,.28); animation:landing-agent-pulse 1.8s ease-in-out infinite; }
      .landing-agent-dot::after { width:26px; height:26px; background:rgba(217,154,24,.11); animation:landing-agent-halo 1.8s ease-in-out infinite; }
      .landing-agent.is-done .landing-agent-dot::before { background:var(--ds-green); box-shadow:0 0 15px rgba(100,218,112,.9),0 0 34px rgba(100,218,112,.3); animation:none; }
      .landing-agent.is-done .landing-agent-dot::after { background:rgba(100,218,112,.12); animation:landing-agent-pop .55s ease-out both; }
      .landing-agent strong { display:block; overflow:hidden; color:var(--ds-text); font-size:18px; line-height:1.1; white-space:nowrap; text-overflow:ellipsis; letter-spacing:-.035em; }
      .landing-agent small { display:block; margin-top:4px; color:var(--ds-quiet); font-size:14px; }
      .landing-agent-time { color:color-mix(in srgb,var(--ds-text) 45%,transparent); font:800 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
      .landing-agent-composer { position:relative; z-index:1; display:grid; grid-template-columns:22px minmax(0,1fr) auto; gap:12px; align-items:center; min-height:54px; margin-top:14px; border:1px solid rgba(255,255,255,.09); border-radius:15px; background:rgba(255,255,255,.018); padding:0 14px; color:color-mix(in srgb,var(--ds-text) 66%,transparent); font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace; transition:border-color .2s ease,box-shadow .2s ease; }
      .landing-agent-composer.is-submitting { border-color:rgba(217,154,24,.26); box-shadow:0 0 34px rgba(217,154,24,.08); }
      .landing-agent-plus, .landing-agent-return { color:color-mix(in srgb,var(--ds-text) 42%,transparent); }
      .landing-agent-prompt { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .landing-agent-caret { display:inline-block; width:1px; height:18px; background:color-mix(in srgb,var(--ds-text) 58%,transparent); animation:landing-agent-caret 1s steps(1,end) infinite; }
      @keyframes landing-agent-pulse { 0%,100%{transform:translate(-50%,-50%) scale(.76);opacity:.62} 50%{transform:translate(-50%,-50%) scale(1.08);opacity:1} }
      @keyframes landing-agent-halo { 0%,100%{transform:translate(-50%,-50%) scale(.72);opacity:.2} 50%{transform:translate(-50%,-50%) scale(1.18);opacity:.46} }
      @keyframes landing-agent-pop { from{transform:translate(-50%,-50%) scale(.8);opacity:.65} to{transform:translate(-50%,-50%) scale(1.35);opacity:0} }
      @keyframes landing-agent-caret { 0%,50%{opacity:1} 51%,100%{opacity:0} }
      .landing-shot, .landing-workflow, .landing-proof, .landing-footer { display:none; }
      .landing-shot { margin-top:18px; overflow:hidden; border:1px solid var(--ds-line); border-radius:14px; background:#101722; box-shadow:var(--shadow-xl,0 24px 70px rgba(0,0,0,.24)); }
      .landing-shot-menu { min-height:34px; justify-content:flex-start; gap:22px; padding:0 16px; background:linear-gradient(180deg,rgba(140,189,253,.22),rgba(140,189,253,.06)); color:var(--ds-muted); font-size:13px; font-weight:800; }
      .landing-shot-menu time { margin-left:auto; }
      .landing-shot-body { position:relative; min-height:760px; padding:48px min(5vw,72px); background:radial-gradient(circle at 80% 18%,rgba(140,189,253,.34) 0 16%,transparent 30%),radial-gradient(circle at 98% 92%,rgba(38,96,203,.72) 0 18%,transparent 40%),radial-gradient(circle at 8% 88%,rgba(142,219,210,.35) 0 17%,transparent 36%),linear-gradient(135deg,#1B2130 0,#172234 42%,#111827 100%); }
      .landing-app-window { width:min(1120px,88%); min-height:690px; overflow:hidden; border:1px solid var(--ds-line); border-radius:18px; background:color-mix(in srgb,var(--ds-surface) 92%,transparent); box-shadow:0 24px 80px rgba(0,0,0,.38); }
      .landing-window-title { min-height:42px; gap:12px; border-bottom:1px solid var(--ds-line); padding:0 16px; color:var(--ds-quiet); font:800 13px/1 var(--landing-font); }
      .landing-lights { display:inline-flex; gap:8px; }
      .landing-lights span { width:11px; height:11px; border-radius:999px; background:#F38BA8; }
      .landing-lights span:nth-child(2) { background:var(--ds-yellow); }
      .landing-lights span:nth-child(3) { background:var(--ds-green); }
      .landing-window-content { position:relative; display:grid; grid-template-columns:minmax(520px,1fr) minmax(220px,.42fr); gap:46px; padding:60px 74px 48px; }
      .landing-doc, .landing-result, .landing-mini-doc { border:1px solid var(--ds-line); background:var(--ds-surface); box-shadow:var(--shadow-md,0 10px 30px rgba(0,0,0,.20)); }
      .landing-doc { min-height:540px; border-radius:14px; padding:56px min(5vw,70px); }
      .landing-doc h2, .landing-section-title { margin:0; font-size:clamp(36px,4vw,54px); line-height:.95; letter-spacing:-.06em; font-weight:900; }
      .landing-doc h2 { max-width:430px; }
      .landing-doc p { margin:24px 0 0; max-width:520px; color:var(--ds-muted); font-size:19px; line-height:1.55; }
      .landing-doc mark { border-radius:4px; background:color-mix(in srgb,var(--ds-yellow) 42%,transparent); color:var(--ds-text); }
      .landing-callout { border-left:4px solid var(--ds-line-strong); padding-left:22px; color:var(--ds-quiet) !important; }
      .landing-checks { display:grid; gap:12px; margin-top:48px; color:var(--ds-muted); font-size:18px; font-weight:750; }
      .landing-checks span { display:flex; gap:12px; align-items:center; }
      .landing-checks b { display:grid; width:20px; height:20px; place-items:center; border-radius:5px; background:var(--ds-accent); color:#08111D; font-size:13px; }
      .landing-terminal-card { border:1px solid rgba(0,0,0,.52); border-radius:12px; background:#101722; color:var(--ds-text); box-shadow:0 22px 54px rgba(0,0,0,.34); font-family:var(--landing-font); }
      .landing-shot .landing-terminal-card { position:absolute; top:100px; right:48px; width:min(620px,45%); }
      .landing-terminal-top { display:flex; min-height:38px; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--ds-line); padding:0 14px; color:var(--ds-quiet); font-size:12px; font-weight:850; }
      .landing-terminal-body { display:grid; gap:16px; padding:20px; color:var(--ds-muted); font-size:14px; line-height:1.55; }
      .landing-prompt { margin:0 -20px; padding:8px 20px; background:rgba(255,255,255,.06); color:var(--ds-text); }
      .landing-tool { color:var(--ds-accent); }
      .landing-comments { align-self:end; border-left:2px solid var(--ds-line-strong); padding-left:24px; }
      .landing-comment { margin-top:22px; color:var(--ds-muted); font-size:15px; line-height:1.55; }
      .landing-avatar { display:inline-grid; width:28px; height:28px; place-items:center; margin-right:8px; border-radius:999px; background:var(--ds-surface-2); color:var(--ds-text); font-size:12px; font-weight:850; }
      .landing-workflow { margin-top:72px; border-top:1px solid var(--ds-line); padding-top:52px; }
      .landing-workflow h2, .landing-proof h2 { text-align:center; }
      .landing-workflow .landing-section-title { font-size:clamp(56px,2.4rem + 2.6vw,68px); letter-spacing:-.055em; }
      .landing-proof .landing-section-title { font-size:clamp(34px,2vw + 18px,46px); letter-spacing:-.055em; }
      .landing-workflow-grid { display:grid; grid-template-columns:minmax(0,.8fr) minmax(300px,1.2fr); gap:clamp(28px,5vw,70px); align-items:start; margin-top:36px; }
      .landing-workflow-visual { position:sticky; top:28px; }
      .landing-workflow-visual .landing-terminal-card { min-height:260px; }
      .landing-mini-doc { margin-top:18px; border-radius:12px; padding:22px; }
      .landing-mini-doc h3 { margin:0 0 10px; font-size:24px; letter-spacing:-.04em; }
      .landing-mini-doc p { margin:0; color:var(--ds-muted); }
      .landing-steps { display:grid; gap:0; margin:0; padding:0; list-style:none; }
      .landing-step { min-height:270px; border-top:1px solid var(--ds-line); padding:42px 0; }
      .landing-step:first-child { border-top:0; }
      .landing-step-head { gap:16px; }
      .landing-step-num { display:grid; min-width:48px; height:48px; place-items:center; border-radius:999px; background:var(--ds-text); color:var(--ds-bg); font-size:28px; font-weight:900; }
      .landing-step h3 { margin:0; font-size:clamp(28px,3vw,42px); line-height:1; letter-spacing:-.055em; font-weight:900; }
      .landing-step p { max-width:560px; margin:16px 0 0 64px; color:var(--ds-muted); font-size:18px; line-height:1.55; }
      .landing-proof { margin-top:64px; border-top:1px solid var(--ds-line); padding-top:50px; }
      .landing-proof-intro { max-width:760px; margin:14px auto 0; color:var(--ds-muted); text-align:center; font-size:18px; }
      .landing-proof-grid { display:grid; grid-template-columns:minmax(280px,.72fr) 40px minmax(0,1.28fr); gap:18px; align-items:stretch; margin-top:30px; }
      .landing-pane-label { min-height:34px; color:var(--ds-quiet); font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
      .landing-source pre { position:relative; min-height:430px; margin:0; overflow:auto; border:1px solid rgba(0,0,0,.52); border-radius:12px; background:#101722; color:var(--ds-muted); padding:52px 18px 18px; box-shadow:0 20px 48px rgba(0,0,0,.28); font:13px/1.55 var(--landing-font); white-space:pre-wrap; }
      .landing-source pre::before { content:'markdown_source'; position:absolute; top:0; right:0; left:0; min-height:40px; border-bottom:1px solid var(--ds-line); padding:12px 14px 0 72px; color:var(--ds-quiet); font:800 12px/1 var(--landing-font); }
      .landing-source pre::after { content:''; position:absolute; top:15px; left:14px; width:10px; height:10px; border-radius:999px; background:#F38BA8; box-shadow:18px 0 0 var(--ds-yellow),36px 0 0 var(--ds-green); }
      .landing-arrow { display:grid; place-items:start center; padding-top:58px; color:var(--ds-quiet); font-size:24px; }
      .landing-result { min-height:430px; border-radius:14px; overflow:hidden; padding:0; }
      .landing-result-toolbar { min-height:40px; gap:10px; border-bottom:1px solid var(--ds-line); padding:0 14px; color:var(--ds-quiet); font-size:12px; font-weight:800; }
      .landing-result-body { padding:34px 42px 42px; }
      .landing-result h3 { margin:0 0 18px; font-size:34px; line-height:1; letter-spacing:-.05em; }
      .landing-result p { color:var(--ds-muted); font-size:17px; line-height:1.65; }
      .landing-highlight { border-radius:3px; background:color-mix(in srgb,var(--ds-yellow) 36%,transparent); color:var(--ds-text); }
      .landing-old { border-radius:4px; background:color-mix(in srgb,var(--ds-red) 20%,transparent); color:var(--ds-red); text-decoration:line-through; text-decoration-color:var(--ds-red); }
      .landing-new { border-radius:4px; background:color-mix(in srgb,var(--ds-green) 20%,transparent); color:var(--ds-green); text-decoration:underline; text-decoration-color:var(--ds-green); text-underline-offset:3px; }
      .landing-thread { margin-top:22px; display:grid; grid-template-columns:36px minmax(0,1fr); gap:12px; border-left:2px solid var(--ds-line-strong); padding-left:16px; }
      .signin-modal { width:min(480px, calc(100% - 28px)); border:1px solid var(--ds-line); border-radius:12px; padding:0; background:var(--ds-surface); color:var(--ds-text); box-shadow:0 24px 70px rgba(0,0,0,.52); }
      .signin-modal::backdrop { background:rgba(0,0,0,.68); backdrop-filter:blur(5px); }
      .modal-card { padding:24px; }
      .modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; }
      .modal-head h2 { margin:0 0 8px; font-size:30px; line-height:1; }
      .modal-head p { color:var(--ds-muted); }
      .close-button { width:34px; height:34px; border:1px solid var(--ds-line); border-radius:999px; background:transparent; color:var(--ds-muted); font-size:20px; cursor:pointer; }
      .github-button { width:100%; min-height:50px; border:1px solid color-mix(in srgb,var(--ds-accent) 70%,var(--ds-line)); border-radius:8px; background:var(--ds-accent); color:#08111D; font-weight:900; cursor:pointer; }
      .github-button:disabled { opacity:.55; cursor:not-allowed; }
      .modal-proof { margin:18px 0 0; padding-left:18px; color:var(--ds-muted); }
      .modal-status { min-height:21px; margin-top:14px; color:var(--ds-muted); font-size:14px; }
      .landing-footer { margin-top:64px; border-top:1px solid var(--ds-line); padding-top:22px; color:var(--ds-muted); font-size:14px; }
      @media (max-width:900px) { .landing-page { overflow:auto; } .landing-shell { width:min(100% - 28px,1120px); padding-top:24px; } .landing-nav, .landing-footer { align-items:flex-start; flex-direction:column; } .landing-links { width:100%; justify-content:space-between; } .landing-hero { grid-template-columns:1fr; padding-top:58px; } .landing-page h1 { font-size:clamp(52px,17vw,82px); } .landing-agent-loop { min-height:440px; border-left:0; padding-left:0; } .landing-agent-time { display:none; } .landing-button, .landing-github-link { width:100%; justify-content:center; } .landing-shot-menu time, .landing-shot-menu span:nth-of-type(n+3) { display:none; } .landing-shot-body { min-height:auto; padding:22px; } .landing-app-window { width:auto; min-height:0; } .landing-window-content { display:block; padding:24px; } .landing-doc { min-height:0; padding:30px 24px; } .landing-shot .landing-terminal-card { position:static; width:auto; margin-top:16px; } .landing-comments { margin-top:18px; } .landing-workflow-grid, .landing-proof-grid { grid-template-columns:1fr; } .landing-workflow-visual { position:static; } .landing-step { min-height:0; } .landing-step p { margin-left:0; } .landing-arrow { display:none; } }
    `}</style>
    <div className="landing-page">
      <main className="landing-shell">
        <nav className="landing-nav" aria-label="Spanner navigation">
          <a className="landing-brand" href="/"><img className="landing-brand-mark" src="/logo-mark.svg" alt="" aria-hidden="true" />spanner</a>
          <div className="landing-links"><button id="signin-open" className="landing-link-button" type="button" data-open-signin>Sign in</button></div>
        </nav>

        <section className="landing-hero" aria-labelledby="title">
          <div>
            <h1 id="title">Easier remote coding with your agent</h1>
            <p className="landing-lede">Spanner gives Pi a real browser sandbox, loads your AGENTS.md, skills, prompts, providers, setup commands, and checks, then brings back evidence you can review.</p>
            <div className="landing-actions"><a className="landing-button" href="/">Open a Pi sandbox</a><a className="landing-github-link" href="https://github.com/anishthite/spanner-downloads/releases/latest">View desktop release</a></div>
          </div>
          <aside className="landing-agent-loop" aria-label="Live agent status loop">
            <div className="landing-agent-head"><span>running agents</span></div>
            <div className="landing-agent-stack" data-landing-agent-loop>
              <article className="landing-agent" style={{ '--slot': 0 }}><span className="landing-agent-dot"></span><span><strong>Settings Page Review</strong><small>answering</small></span><span className="landing-agent-time">running</span></article>
              <article className="landing-agent" style={{ '--slot': 1 }}><span className="landing-agent-dot"></span><span><strong>Mobile UI Walkthrough</strong><small>running command</small></span><span className="landing-agent-time">running</span></article>
              <article className="landing-agent" style={{ '--slot': 2 }}><span className="landing-agent-dot"></span><span><strong>Separation Borders</strong><small>editing CSS</small></span><span className="landing-agent-time">running</span></article>
              <article className="landing-agent" style={{ '--slot': 3 }}><span className="landing-agent-dot"></span><span><strong>Main Screen Layout</strong><small>thinking</small></span><span className="landing-agent-time">running</span></article>
            </div>
            <div className="landing-agent-composer" data-landing-agent-composer aria-hidden="true"><span className="landing-agent-plus">+</span><span className="landing-agent-prompt" data-landing-agent-prompt></span><span className="landing-agent-return">↵</span></div>
          </aside>
        </section>

        <section className="landing-shot" aria-label="Spanner review workspace">
          <div className="landing-shot-menu"><strong>Spanner</strong><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><time>Tue Apr 28&nbsp;&nbsp;11:47 AM</time></div>
          <div className="landing-shot-body">
            <div className="landing-app-window">
              <div className="landing-window-title"><span className="landing-lights" aria-hidden="true"><span></span><span></span><span></span></span><span>~/workspaces/spanner/thread/remote-run.md</span></div>
              <div className="landing-window-content">
                <article className="landing-doc" aria-label="Run brief">
                  <h2>Fix plan ready for review</h2>
                  <p>Spanner opened the repo, loaded <mark>your Pi defaults</mark>, and kept the agent work tied to one branch.</p>
                  <p className="landing-callout">Please check the risk notes, the screenshot, and the failing-test explanation before continuing.</p>
                  <div className="landing-checks" aria-label="Run checklist"><span><b>✓</b> setup receipt saved</span><span><b>✓</b> diff and logs attached</span><span><b>□</b> user review before merge</span></div>
                </article>
                <aside className="landing-comments" aria-label="Review comments"><div className="landing-comment"><span className="landing-avatar">A</span><strong>AI</strong><br />The run used your existing AGENTS.md and only scoped GitHub credentials.</div><div className="landing-comment"><span className="landing-avatar">Y</span><strong>You</strong><br />Looks safe. Continue with the smaller fix first.</div></aside>
              </div>
            </div>
            <aside className="landing-terminal-card" aria-label="Agent terminal">
              <div className="landing-terminal-top"><span className="landing-lights" aria-hidden="true"><span></span><span></span><span></span></span><span>spanner / remote-pi</span></div>
              <div className="landing-terminal-body"><div>Coding agent<br /><span style={{ color: 'var(--ds-quiet)' }}>workspace ~/repo</span></div><p className="landing-prompt">› fix the auth callback race and show evidence</p><div><span className="landing-tool">Read</span> frontend/src/runtime/desktop.js</div><div><span className="landing-tool">Edit</span> src/server/auth.js</div><div><span className="landing-tool">Check</span> npm test</div><div>Ready: diff, logs, screenshot, next action.</div></div>
            </aside>
          </div>
        </section>

        <section className="landing-workflow" id="how-it-works" aria-labelledby="workflow-title">
          <h2 id="workflow-title" className="landing-section-title">How it works</h2>
          <div className="landing-workflow-grid">
            <ol className="landing-steps">
              {workflowSteps.map(([title, body], index) => <li className="landing-step" key={title}><div className="landing-step-head"><span className="landing-step-num">{index + 1}</span><h3>{title}</h3></div><p>{body}</p></li>)}
            </ol>
            <div className="landing-workflow-visual">
              <aside className="landing-terminal-card" aria-label="Workflow terminal">
                <div className="landing-terminal-top"><span className="landing-lights" aria-hidden="true"><span></span><span></span><span></span></span><span>local-agent / spanner</span></div>
                <div className="landing-terminal-body"><div>Coding agent<br /><span style={{ color: 'var(--ds-quiet)' }}>workspace ~/project</span></div><p className="landing-prompt">› run this in a clean remote sandbox</p><div><span className="landing-tool">Loaded</span> AGENTS.md · skills · prompts</div><div><span className="landing-tool">Running</span> setup commands and checks</div><div><span className="landing-tool">Returned</span> diff + logs + screenshot</div></div>
              </aside>
              <article className="landing-mini-doc"><h3>remote-run.md</h3><p>Setup receipt, comments, and next action are ready for review.</p></article>
            </div>
          </div>
        </section>

        <section className="landing-proof" aria-labelledby="proof-title">
          <h2 id="proof-title" className="landing-section-title">It is still Markdown</h2>
          <p className="landing-proof-intro">Comments and suggested edits stay portable enough for the agent to read on the next turn.</p>
          <div className="landing-proof-grid">
            <div className="landing-source"><div className="landing-pane-label">Source</div><pre>{proofMarkdown}</pre></div>
            <div className="landing-arrow" aria-hidden="true">→</div>
            <div><div className="landing-pane-label">Result</div><article className="landing-result"><div className="landing-result-toolbar"><span className="landing-lights" aria-hidden="true"><span></span><span></span><span></span></span><span>remote-run.md</span></div><div className="landing-result-body"><h3>Remote Pi Plan</h3><p>Goal: keep local Pi setup and remote sandbox work reviewable.</p><p>Move the setup receipt above <span className="landing-highlight">the agent transcript</span>.</p><p><span className="landing-old">remote runner</span> <span className="landing-new">browser sandbox</span> that loads AGENTS.md, skills, prompts, and checks before work starts.</p><div className="landing-thread"><span className="landing-avatar">Y</span><p><strong>You</strong><br />Make the setup receipt the main proof, not a footnote.</p></div></div></article></div>
          </div>
        </section>

        <footer className="landing-footer"><span>For Pi users who want their local setup, review habits, and project checks to work after the laptop closes.</span><a href="https://github.com/anishthite/spanner-downloads/releases/latest">desktop release</a></footer>
      </main>
      <dialog id="signin-modal" className="signin-modal" aria-labelledby="signin-title">
        <div className="modal-card">
          <div className="modal-head"><div><h2 id="signin-title">Build with your repos.</h2><p>Sign in with GitHub so Spanner can launch agents against the repos you choose.</p></div><button id="signin-close" className="close-button" type="button" aria-label="Close sign-in modal">×</button></div>
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
