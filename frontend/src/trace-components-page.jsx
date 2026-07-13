import { Button, ScrollArea, Surface } from './components/ui.jsx';
import { cn } from '#lib/utils';

const surface = 'rounded-md border border-[var(--rule)] bg-[var(--paper)] shadow-[var(--shadow)]';
const eyebrow = 'mb-2 font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.12em] text-[var(--blue)]';
const muted = 'text-[var(--ink-3)]';

const toolGroups = [
  {
    title: 'File search + reads',
    tools: [
      { label: 'find_files', action: 'finding files for ToolCallCard', output: 'find_files({ query: "ToolCallCard", limit: 20 })\n\n12 ranked files', open: false },
      { label: 'grep', action: 'searching frontend/src', output: 'grep({ pattern: "statusTone", path: "frontend/src", glob: "*.tsx", context: 2 })\n\n3 matches across 2 files', open: true },
      { label: 'fff_multi_grep', action: 'searching frontend/src', output: 'fff_multi_grep({ patterns: ["ToolCallCard", "TraceTimeline", "graphTools"], path: "frontend/src", context: 1 })\n\n9 matches across aliases', open: true },
      { label: 'read', action: 'reading frontend/src/runtime/thread.js', output: 'read({ path: "frontend/src/runtime/thread.js", offset: 1898, limit: 80 })\n\nrenderTimelineToolEvent(...)', open: true },
    ],
  },
  {
    title: 'Mutations + shell',
    tools: [
      { label: 'edit', action: 'editing implementation-notes/INDEX.html', state: 'error', output: 'edit({ path: "implementation-notes/INDEX.html", edits: [{ oldText: "<tbody>...", newText: "<tbody>..." }] })\n\nCould not find the exact text. The old text must match exactly.', open: true },
      { label: 'edit', action: 'editing frontend/src/styles/app.css', output: 'edit({ path: "frontend/src/styles/app.css", edits: [...] })\n\nSuccessfully replaced 1 block(s).', open: false },
      { label: 'write', action: 'writing output/playwright/agent-trace-card-board.html', output: 'write({ path: "output/playwright/agent-trace-card-board.html", content: "<!doctype html>..." })\n\nWrote 18KB.', open: true },
      { label: 'bash', action: 'running npm run build', state: 'running', output: 'bash({ command: "npm run build", timeout: 120 })\n\n> vite build\ntransforming...', open: true },
      { label: 'bash', action: 'running npm test -- trace', state: 'error', output: 'bash({ command: "npm test -- trace", timeout: 60 })\n\nstderr: Cannot find module ./ToolCallCard', open: true },
    ],
  },
  {
    title: 'Research + fetched content',
    tools: [
      { label: 'web_search', action: 'searching web for agent trace UI patterns', output: 'web_search({ queries: ["agent trace UI patterns", "tool call timeline design"], numResults: 5, includeContent: true })\n\n10 sources with citations', open: true },
      { label: 'code_search', action: 'searching code for React trace timeline component examples', output: 'code_search({ query: "React trace timeline component examples", maxTokens: 5000 })\n\nDocs and snippets', open: true },
      { label: 'fetch_content', action: 'fetching https://example.com/trace-design', output: 'fetch_content({ url: "https://example.com/trace-design", prompt: "focus on tool-card UI" })\n\nReadable markdown extracted', open: true },
      { label: 'get_search_content', action: 'using srch_123', output: 'get_search_content({ responseId: "srch_123", queryIndex: 0, urlIndex: 1 })\n\nFull source opened', open: false },
    ],
  },
  {
    title: 'Coordination',
    tools: [
      { label: 'todo', action: 'updating tasks', output: 'todo({ action: "create", subject: "Use real trace components", status: "in_progress" })\n\nCreated #1', open: true },
      { label: 'ask_user_question', action: 'asking a question', state: 'running', output: 'ask_user_question({ questions: [{ header: "Density", question: "How dense should trace cards be?", options: [...] }] })\n\nWaiting for user input', open: true },
      { label: 'multi_tool_use.parallel', action: 'using 2 child tool calls', output: 'multi_tool_use.parallel({ tool_uses: [{ recipient_name: "functions.read", parameters: {...} }, { recipient_name: "functions.grep", parameters: {...} }] })\n\n2 child calls grouped', open: true },
      { label: 'workflow', action: 'running workflow', state: 'running', workflow: true, output: 'workflow({ script: "export const meta = { name: \'trace-audit\', description: \'Audit trace cards\' }; phase(\'Review\'); await agent(\'review tool cards\', { label: \'cards\' })" })\n\nRun ID: run-trace-audit-123', open: true },
    ],
  },
  {
    title: 'Autoresearch',
    tools: [
      { label: 'init_experiment', action: 'using render_ms', output: 'init_experiment({ name: "Trace render perf", metric_name: "render_ms", metric_unit: "ms", direction: "lower" })', open: false },
      { label: 'run_experiment', action: 'using npm run bench:trace', state: 'running', output: 'run_experiment({ command: "npm run bench:trace", timeout_seconds: 600 })\n\nMETRIC render_ms=12.4', open: true },
      { label: 'log_experiment', action: 'using abc1234', output: 'log_experiment({ commit: "abc1234", metric: 12.4, status: "keep", description: "Virtualized trace cards", asi: { hypothesis: "render fewer nodes" } })\n\nCommitted keep run', open: true },
    ],
  },
  {
    title: 'Goal lifecycle',
    tools: [
      { label: 'get_goal', action: 'using active session goal', output: 'get_goal()\n\nstatus: active', open: false },
      { label: 'goal_question', action: 'asking a goal decision', state: 'running', output: 'goal_question({ question: "What counts as done?", choices: [...] })\n\nWaiting for answer', open: true },
      { label: 'goal_questionnaire', action: 'asking goal criteria', state: 'running', output: 'goal_questionnaire({ questions: [{ prompt: "What should this goal include?", choices: [...] }] })', open: false },
      { label: 'propose_goal_draft', action: 'using Ship trace cards', state: 'running', output: 'propose_goal_draft({ objective: "Ship trace cards", autoContinue: true, sisyphus: false })\n\nConfirm / Continue Chatting', open: true },
      { label: 'update_goal', action: 'using complete', output: 'update_goal({ status: "complete", evidence: "All requirements verified." })\n\n<approved/>', open: false },
      { label: 'pause_goal', action: 'using missing TRACE_API_KEY', state: 'error', output: 'pause_goal({ reason: "Missing TRACE_API_KEY.", suggestedAction: "Set TRACE_API_KEY and resume." })\n\nTerminal turn', open: true },
      { label: 'abort_goal', action: 'using obsolete objective', output: 'abort_goal({ reason: "Objective is obsolete after product direction changed." })', open: false },
      { label: 'apply_goal_tweak', action: 'using revised objective', output: 'apply_goal_tweak({ newObjective: "=== Goal === ...", changeSummary: "Added trace-card screenshot requirement." })', open: false },
    ],
  },
];

function ToolCard({ label, action, state = 'done', output = '', open = false, workflow = false }) {
  return <article className={cn('timeline-item tool-item', workflow && 'workflow-item')}>
    <div className="timeline-dot" aria-hidden="true"></div>
    <details className={cn('tool-card', workflow && 'workflow-card')} data-state={state} data-phase={state === 'done' ? 'end' : 'start'} open={open}>
      <summary>
        <span data-tool-label>{label}</span>
        <span className="tool-target" data-tool-action>{action}</span>
        <span className="badge">{state}</span>
      </summary>
      <pre>{output}</pre>
    </details>
  </article>;
}

function TimelineCard({ kind = 'status', title, detail, children }) {
  return <article className={cn('timeline-item', kind)}>
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="timeline-card">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  </article>;
}

function ThinkingCard() {
  return <article className="timeline-item thinking-item">
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="thinking-card">
      <div className="message-head"><strong>thinking steps</strong></div>
      <div className="thinking-body">**Validating HTML and tasks**\nUse the literal .tool-card DOM and app CSS, not a mock screenshot style.</div>
    </div>
  </article>;
}

function RunSummaryCard() {
  return <article className="timeline-item run-summary-item">
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="run-summary-card">
      <button className="run-summary muted" type="button" aria-controls="agent-trace" aria-expanded="true" title="show full trace">ran 2m 14s</button>
      <p className="run-summary-detail muted" data-run-summary-detail>Working · editing frontend/src/trace-components-page.jsx</p>
    </div>
  </article>;
}

function AgentGraph() {
  return <Surface as="aside" className={cn(surface, 'agent-rail is-open')} aria-label="Literal agent graph components">
    <div className="rail-head"><span>workflow agents</span><strong>working · 3</strong></div>
    <p className="rail-hint">same agent-node/workflow-view-node classes</p>
    <div className="agent-graph">
      <div className="agent-node pi working"><span>main agent</span><small>working</small></div>
      <div className="agent-edge"></div>
      <div className="subagent-stack workflow-agent-stack">
        <div className="workflow-map">
          <div className="workflow-map-head workflow-title running"><span>trace-audit</span></div>
          <div className="workflow-flow">
            <section className="workflow-lane"><div className="workflow-lane-head"><span><i>1</i>review</span><small>1 running</small></div><div className="workflow-agent-grid"><article className="workflow-view-node workflow-agent done"><div className="workflow-node-top"><span>cards</span><b>done</b></div><small>Tool card density is readable.</small></article><article className="workflow-view-node workflow-agent running"><div className="workflow-node-top"><span>mobile</span><b>running</b></div><small>Checking narrow layout.</small></article></div></section>
            <section className="workflow-lane"><div className="workflow-lane-head"><span><i>2</i>verify</span><small>0/1 done</small></div><div className="workflow-agent-grid"><article className="workflow-view-node workflow-agent error"><div className="workflow-node-top"><span>accessibility</span><b>failed</b></div><small>Needs focus-ring pass.</small></article></div></section>
          </div>
        </div>
      </div>
    </div>
  </Surface>;
}

export function TraceComponentsPage() {
  return <main className="thread-flow-shell py-6">
    <header className="thread-main-header static mb-4">
      <div className="thread-main-row">
        <a className="brand" href="/workspace.html" aria-label="Back to workspace"><span className="brand-box">←</span></a>
        <h1>Literal trace components</h1>
        <div className="header-actions"><Button as="a" href="/thread.html" variant="ghost">open thread</Button></div>
      </div>
      <p className={muted}>Uses the same <code>.timeline-item</code>, <code>.tool-card</code>, <code>.thinking-card</code>, <code>.timeline-card</code>, and workflow-node DOM that the live thread renderer emits.</p>
    </header>

    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <section className="grid min-w-0 gap-4">
        <Surface className={cn(surface, 'grid gap-3 p-4')}>
          <p className={eyebrow}>timeline primitives</p>
          <ScrollArea className="timeline-flow" style={{ paddingBottom: 24 }}>
            <RunSummaryCard />
            <ThinkingCard />
            <TimelineCard kind="status" title="status" detail="Running · streaming updates" />
            <TimelineCard kind="workflow-item" title="workflow finished" detail="trace-audit · run-trace-audit-123 · continuing main agent">
              <details><summary>workflow result</summary><pre>confirmed: edit the literal .tool-card component first</pre></details>
            </TimelineCard>
            <TimelineCard kind="summary-item" title="summary" detail="Built a literal trace-card board for editing the product components." />
          </ScrollArea>
        </Surface>

        {toolGroups.map((group) => <Surface key={group.title} className={cn(surface, 'grid gap-3 p-4')}>
          <p className={eyebrow}>{group.title}</p>
          <ScrollArea className="timeline-flow" style={{ paddingBottom: 24 }}>
            {group.tools.map((tool, index) => <ToolCard key={`${group.title}-${tool.label}-${index}`} {...tool} />)}
          </ScrollArea>
        </Surface>)}
      </section>

      <aside className="grid content-start gap-4">
        <AgentGraph />
        <Surface className={cn(surface, 'grid gap-3 p-4')}>
          <p className={eyebrow}>edit targets</p>
          <div className="fact-list">
            <div className="fact"><span>tool markup</span><code>frontend/src/runtime/thread.js</code></div>
            <div className="fact"><span>card styles</span><code>frontend/src/styles/app.css</code></div>
            <div className="fact"><span>this board</span><code>frontend/src/trace-components-page.jsx</code></div>
          </div>
          <p className={muted}>ponytail: this page is a component board only; live behavior stays in the thread renderer until we pick the card shape.</p>
        </Surface>
      </aside>
    </section>
  </main>;
}
