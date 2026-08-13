import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
  defineToolkit,
  groupPartByType,
  unstable_Interactables,
  unstable_useInteractable,
  useAui,
  useExternalStoreRuntime,
  useScrollLock,
} from '@assistant-ui/react';
import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  ArticleIcon,
  BracketsCurlyIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CodeIcon,
  CopySimpleIcon,
  DatabaseIcon,
  DotsThreeIcon,
  FileCodeIcon,
  GitDiffIcon,
  GlobeHemisphereWestIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlugsConnectedIcon,
  RobotIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WrenchIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { Children, useCallback, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { cn } from '#lib/utils';

const iconProps = { className: 'size-4', 'aria-hidden': true };

const seededMessages = [
  {
    id: 'aui-user-1',
    role: 'user',
    createdAt: new Date('2026-07-29T12:00:00'),
    metadata: {},
    content: [{ type: 'text', text: 'Mock up the agent trace UI using assistant-ui primitives, not hand-drawn replacements.' }],
  },
  {
    id: 'aui-assistant-1',
    role: 'assistant',
    createdAt: new Date('2026-07-29T12:00:02'),
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      timing: { streamStartTime: Date.now() - 83000, firstTokenTime: Date.now() - 82100, totalStreamTime: 83000, tokenCount: 1918, tokensPerSecond: 23.1, totalChunks: 88, toolCallCount: 5 },
    },
    content: [
      { type: 'reasoning', text: 'Use ThreadPrimitive for the scroll container, MessagePrimitive.GroupedParts for grouped reasoning/tools, Tool UI renderers for rich calls, and Interactables for editable artifact-like state.' },
      {
        type: 'tool-call',
        toolCallId: 'tool-read-docs',
        toolName: 'web_search',
        args: { query: 'assistant-ui Tool UI Interactables ThreadPrimitive MessagePrimitive' },
        argsText: '{"query":"assistant-ui Tool UI Interactables ThreadPrimitive MessagePrimitive"}',
        result: { sources: ['Tool UI', 'Interactables', 'Primitives', 'Runtime architecture'] },
        timing: { startTime: Date.now() - 80000, endTime: Date.now() - 77200 },
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-edit-route',
        toolName: 'edit_file',
        args: { file: 'frontend/src/styles/app.css', operation: 'tighten tool trace spacing' },
        argsText: '{"file":"frontend/src/styles/app.css","operation":"tighten tool trace spacing"}',
        result: { changed: 1, additions: 28, deletions: 22, summary: 'Tuned thread-like tool trace rows.' },
        timing: { startTime: Date.now() - 67000, endTime: Date.now() - 52400 },
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-test-route',
        toolName: 'bash',
        args: { command: 'node --test test/frontend-route-manifest.test.js' },
        argsText: '{"command":"node --test test/frontend-route-manifest.test.js"}',
        result: { exitCode: 0, output: '4/4 passed' },
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-build-route',
        toolName: 'bash',
        args: { command: 'npm run build' },
        argsText: '{"command":"npm run build"}',
        result: { exitCode: 0, output: 'vite build completed' },
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-diff-check',
        toolName: 'bash',
        args: { command: 'git diff --check' },
        argsText: '{"command":"git diff --check"}',
        result: { exitCode: 0, output: 'no whitespace errors' },
      },
      {
        type: 'tool-call',
        toolCallId: 'tool-approval',
        toolName: 'request_approval',
        args: { action: 'Run build and screenshot smoke', risk: 'low' },
        argsText: '{"action":"Run build and screenshot smoke","risk":"low"}',
        result: { approved: true, mode: 'allow-once' },
        approval: { id: 'approval-build', approved: true, optionId: 'allow-once' },
      },
      { type: 'text', text: 'root = TextContent("Done. The view below is rendered through assistant-ui runtime context and primitives, with custom tool UIs and editable state surfaces mounted around the live thread.")' },
      {
        type: 'source',
        sourceType: 'url',
        id: 'source-tool-ui',
        title: 'assistant-ui Tool UI',
        url: 'https://www.assistant-ui.com/docs/tools/tool-ui',
      },
    ],
  },
];

const taskBoardSchema = z.object({
  tasks: z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean() })),
});

const toolkit = defineToolkit({
  web_search: { type: 'backend', render: ToolSearchUI },
  edit_file: { type: 'backend', render: EditFileUI },
  bash: { type: 'backend', render: BashUI },
  request_approval: { type: 'backend', render: ApprovalUI },
});

function AssistantUiRuntimeProvider({ children }) {
  const [messages, setMessages] = useState(seededMessages);
  const [isRunning] = useState(false);

  const onNew = (message) => {
    const content = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: String(message.content || 'New request') }];
    const text = content.find((part) => part.type === 'text')?.text || 'New request';
    const assistantId = `aui-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `aui-user-${Date.now()}`, role: 'user', createdAt: new Date(), metadata: {}, content },
      {
        id: assistantId,
        role: 'assistant',
        createdAt: new Date(),
        status: { type: 'complete', reason: 'stop' },
        metadata: {},
        content: [
          { type: 'reasoning', text: `Classify "${text.slice(0, 60)}" against the same runtime/tool/interactable primitives shown in this board.` },
          {
            type: 'tool-call',
            toolCallId: `tool-${Date.now()}`,
            toolName: 'web_search',
            args: { query: text },
            argsText: JSON.stringify({ query: text }),
            result: { sources: ['mock runtime', 'assistant-ui toolkit'] },
          },
          { type: 'text', text: 'Mock response appended through useExternalStoreRuntime.onNew.' },
        ],
      },
    ]);
  };

  const onAddToolResult = ({ messageId, toolCallId, result }) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId) return message;
      return {
        ...message,
        content: message.content.map((part) => part.type === 'tool-call' && part.toolCallId === toolCallId ? { ...part, result } : part),
      };
    }));
  };

  const runtime = useExternalStoreRuntime({ messages, isRunning, onNew, onAddToolResult });
  const aui = useAui({ tools: Tools({ toolkit }), unstable_interactables: unstable_Interactables() });

  return <AssistantRuntimeProvider runtime={runtime} aui={aui}>{children}</AssistantRuntimeProvider>;
}

function AssistantUiThreadPreview() {
  return (
    <ThreadPrimitive.Root className="aui-thread-root">
      <ThreadPrimitive.Viewport className="aui-thread-viewport" turnAnchor="top" autoScroll={false}>
        <ThreadPrimitive.Empty>
          <div className="aui-empty"><SparkleIcon {...iconProps} /><span>No messages yet.</span></div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages>
          {({ message }) => message.role === 'user' ? <UserMessage /> : <AssistantMessage />}
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="aui-thread-footer">
          <div className="aui-thread-meta"><span>3m, 24.1s</span><button type="button">Next unread <CaretRightIcon {...iconProps} /></button></div>
          <ComposerPrimitive.Root className="aui-composer">
            <ComposerPrimitive.Input rows={3} placeholder="Add a follow up" aria-label="Mock assistant-ui composer" />
            <div className="aui-composer-footer">
              <div className="aui-composer-tools" aria-label="Composer settings">
                <span><RobotIcon {...iconProps} />GPT-5.5</span>
                <button type="button" aria-label="Quick action"><SparkleIcon {...iconProps} /></button>
                <button type="button" aria-label="Reasoning effort"><DatabaseIcon {...iconProps} />High</button>
                <button type="button" aria-label="Context map"><GlobeHemisphereWestIcon {...iconProps} /></button>
              </div>
              <div className="aui-composer-send-row">
                <button type="button" aria-label="Attach context">+</button>
                <ComposerPrimitive.Send className="aui-icon-button" aria-label="Send mock message"><ArrowUpIcon weight="bold" /></ComposerPrimitive.Send>
              </div>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-message-row is-user">
      <div className="aui-user-bubble"><MessagePrimitive.Parts /></div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-message-row is-assistant">
      <div className="aui-assistant-stack">
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ['group-chain', 'group-reasoning'],
            'tool-call': ['group-chain', 'group-tool'],
          })}
        >
          {({ part, children }) => {
            if (part.type === 'group-chain') return <ThinkingDisclosure>{children}</ThinkingDisclosure>;
            if (part.type === 'group-reasoning') return <div className="aui-reasoning-group">{children}</div>;
            if (part.type === 'group-tool') return <ToolGroupDisclosure count={part.indices?.length}>{children}</ToolGroupDisclosure>;
            if (part.type === 'text') return <AssistantText text={part.text} />;
            if (part.type === 'reasoning') return <ReasoningPart text={part.text} />;
            if (part.type === 'tool-call') return part.toolUI ?? <GenericToolFallback part={part} />;
            if (part.type === 'source') return <SourcePart part={part} />;
            return null;
          }}
        </MessagePrimitive.GroupedParts>
        <MessageRunFooter />
        <div className="aui-message-actions">
          <ActionBarPrimitive.Root hideWhenRunning={false}>
            <ActionBarPrimitive.Copy className="aui-mini-action" aria-label="Copy message" title="Copy message"><CopySimpleIcon {...iconProps} /><span className="aui-sr-only">copy</span></ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload className="aui-mini-action" aria-label="Reload message" title="Reload message"><ArrowClockwiseIcon {...iconProps} /><span className="aui-sr-only">reload</span></ActionBarPrimitive.Reload>
          </ActionBarPrimitive.Root>
          <BranchPickerPrimitive.Root className="aui-branch-picker">
            <BranchPickerPrimitive.Previous className="aui-mini-action" aria-label="Previous branch" title="Previous branch"><CaretLeftIcon {...iconProps} /><span className="aui-sr-only">prev</span></BranchPickerPrimitive.Previous>
            <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
            <BranchPickerPrimitive.Next className="aui-mini-action" aria-label="Next branch" title="Next branch"><CaretRightIcon {...iconProps} /><span className="aui-sr-only">next</span></BranchPickerPrimitive.Next>
          </BranchPickerPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantText({ text }) {
  if (typeof text === 'string' && text.trim().startsWith('root =')) {
    return <pre className="aui-assistant-code-answer">{text}</pre>;
  }
  return <p className="aui-assistant-text"><MessagePartPrimitive.Text /></p>;
}

function ThinkingDisclosure({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="aui-thinking" data-open={open ? 'true' : 'false'}>
      <button type="button" className="aui-orchestration-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open ? 'true' : 'false'}>
        <CaretRightIcon {...iconProps} />
        <span>14 tool calls, 7 messages</span>
        <TerminalWindowIcon {...iconProps} />
        <GlobeHemisphereWestIcon {...iconProps} />
        <FileCodeIcon {...iconProps} />
      </button>
      {open && <div className="aui-thinking-body">{children}</div>}
    </section>
  );
}

function ReasoningPart({ text }) {
  return <p className="aui-reasoning"><BracketsCurlyIcon {...iconProps} />{text}</p>;
}

function SourcePart({ part }) {
  return <a className="aui-source-part" href={part.url}><GlobeHemisphereWestIcon {...iconProps} />{part.title || part.url}</a>;
}

function MessageRunFooter() {
  return (
    <div className="aui-run-footer">
      <span>1m, 57s</span>
      <button type="button" aria-label="Copy run summary"><CopySimpleIcon {...iconProps} /></button>
      <button type="button" aria-label="More run actions"><DotsThreeIcon {...iconProps} /></button>
      <span className="aui-run-file-chip"><FileCodeIcon {...iconProps} />assistant-ui-components-page.jsx <b>+33</b><em>-9</em></span>
      <span className="aui-run-file-chip"><FileCodeIcon {...iconProps} />app.css <b>+52</b><em>-29</em></span>
    </div>
  );
}

function fileBasename(path = '') {
  return path.split('/').filter(Boolean).at(-1) || path || 'file';
}

function ToolGroupDisclosure({ children, count: explicitCount }) {
  const [open, setOpen] = useState(true);
  const groupRef = useRef(null);
  const lockScroll = useScrollLock(groupRef, 200);
  const count = explicitCount ?? Children.count(children);
  const label = `${count} tool ${count === 1 ? 'call' : 'calls'}`;
  const handleOpenChange = useCallback((nextOpen) => {
    lockScroll();
    setOpen(nextOpen);
  }, [lockScroll]);

  return (
    <section
      ref={groupRef}
      className="aui-tool-group-root aui-tool-group group/tool-group-root"
      data-slot="tool-group-root"
      data-variant="ghost"
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="aui-tool-group-trigger group/trigger"
        data-slot="tool-group-trigger"
        aria-expanded={open ? 'true' : 'false'}
        data-state={open ? 'open' : 'closed'}
        onClick={() => handleOpenChange(!open)}
      >
        <span className="aui-tool-group-loader" data-slot="tool-group-trigger-loader" aria-hidden="true" />
        <span className="aui-tool-group-trigger-label-wrapper" data-slot="tool-group-trigger-label">{label}</span>
        <em>ghost</em>
      </button>
      {open && (
        <div className="aui-tool-group-content" data-slot="tool-group-content">
          <div className="aui-tool-stack">{children}</div>
        </div>
      )}
    </section>
  );
}

function ToolTraceCard({ className, icon, label, status, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className={cn('aui-tool-card', className)} data-open={open ? 'true' : 'false'}>
      <button type="button" className="aui-tool-line" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((value) => !value)}>
        {icon}
        <strong>{label}</strong>
        {summary}
        {status && <span className="aui-tool-state">{status}</span>}
      </button>
      {open && <div className="aui-tool-detail">{children}</div>}
    </article>
  );
}

function ToolArgsResult({ args, result }) {
  return (
    <div className="aui-tool-io">
      <div>
        <span>args</span>
        <pre>{JSON.stringify(args || {}, null, 2)}</pre>
      </div>
      <div>
        <span>result</span>
        <pre>{JSON.stringify(result || {}, null, 2)}</pre>
      </div>
    </div>
  );
}

function ToolOutputBlock({ title, children }) {
  return (
    <div className="aui-tool-output">
      <span>{title}</span>
      <pre>{children}</pre>
    </div>
  );
}

function ToolDiffViewer() {
  const rows = [
    ['ctx', 1, '.aui-threadlike-frame .aui-tool-group-root[data-variant="ghost"] {'],
    ['add', 2, '  display: inline-flex;'],
    ['add', 3, '  justify-content: flex-start;'],
    ['del', 3, '  min-height: 27px;'],
    ['add', 4, '  align-items: center;'],
    ['add', 5, '  gap: 7px;'],
    ['add', 6, '  min-height: 22px;'],
    ['ctx', 7, '  width: max-content;'],
    ['ctx', 8, '  border: 0;'],
    ['add', 9, '  border-radius: 4px;'],
    ['ctx', 10, '  background: transparent;'],
    ['del', 7, '  padding: 2px 0;'],
    ['add', 11, '  padding: 0;'],
    ['ctx', 12, '  color: #9f9894;'],
    ['ctx', 13, '}'],
  ];

  return (
    <div className="aui-tool-diff-viewer" aria-label="Patch preview for app.css">
      {rows.map(([kind, number, code], index) => (
        <div key={`${kind}-${number}-${index}`} className={`is-${kind}`}>
          <span>{number}</span>
          <code>{code}</code>
        </div>
      ))}
    </div>
  );
}

function ToolTerminalTranscript({ command, output }) {
  return (
    <div className="aui-tool-terminal" aria-label="Terminal output">
      <pre>{`> ${command}
> ### Result
${output || '{"exitCode":0,"output":"passed"}'}
> ### Ran Playwright code
\`\`\`js
await page.setViewportSize({ width: 1680, height: 1180 });
await page.locator(".aui-orchestration-summary").click();
\`\`\`

### Events
- No console errors
- Screenshot saved to output/playwright/`}</pre>
    </div>
  );
}

function ToolSearchResults({ query, sources = [] }) {
  const cards = sources.length ? sources : ['assistant-ui Tool UI', 'Interactables', 'Agent protocols'];
  return (
    <div className="aui-tool-search-results" aria-label="Web search results">
      <div className="aui-search-result-card">
        <p>Web search completed for: {query}</p>
      </div>
      {cards.map((source) => (
        <div key={source} className="aui-search-result-row">
          <GlobeHemisphereWestIcon {...iconProps} />
          <strong>Web Search</strong>
          <code>{source}</code>
        </div>
      ))}
    </div>
  );
}

function GenericToolFallback({ part }) {
  return (
    <ToolTraceCard
      className="is-fallback"
      icon={<WrenchIcon {...iconProps} />}
      label={part.toolName}
      status={part.status?.type || 'complete'}
      summary={<span className="aui-tool-pill">backend tool</span>}
    >
      <ToolArgsResult args={part.args} result={part.result} />
    </ToolTraceCard>
  );
}

function ToolSearchUI({ args = {}, result, status = { type: 'complete' } }) {
  return (
    <ToolTraceCard
      className="is-search"
      icon={<GlobeHemisphereWestIcon {...iconProps} />}
      label="Web Search"
      status={status.type}
      summary={<span className="aui-tool-pill">{args.query}</span>}
    >
      <div className="aui-tool-chips">{(result?.sources || ['streaming args']).map((source) => <span key={source}>{source}</span>)}</div>
      <ToolSearchResults query={args.query} sources={result?.sources} />
    </ToolTraceCard>
  );
}

function EditFileUI({ args = {}, result, status = { type: 'complete' } }) {
  return (
    <ToolTraceCard
      className="is-edit"
      icon={<PencilSimpleIcon {...iconProps} />}
      label="Edit"
      status={status.type}
      defaultOpen
      summary={(
        <>
        <span className="aui-file-pill"><FileCodeIcon {...iconProps} />{fileBasename(args.file)}</span>
        <DiffStatLabel plus={result?.additions ?? 0} minus={result?.deletions ?? 0} />
        </>
      )}
    >
      <dl>
        <div><dt>operation</dt><dd>{args.operation}</dd></div>
        <div><dt>changed</dt><dd>{result?.changed ?? 0} file</dd></div>
      </dl>
      <ToolDiffViewer />
    </ToolTraceCard>
  );
}

function BashUI({ args = {}, result, status = { type: 'complete' } }) {
  const ok = result?.exitCode === 0;
  return (
    <ToolTraceCard
      className={cn('is-bash', !ok && 'is-error')}
      icon={<TerminalWindowIcon {...iconProps} />}
      label="Bash"
      status={ok ? status.type : 'error'}
      summary={<span className="aui-command-pill">{args.command}</span>}
    >
      {result?.output && <p>{result.output}</p>}
      <ToolTerminalTranscript command={args.command} output={result?.output} />
    </ToolTraceCard>
  );
}

function ApprovalUI({ args = {}, result, approval }) {
  return (
    <ToolTraceCard
      className="is-approval"
      icon={<ShieldCheckIcon {...iconProps} />}
      label="Approval"
      status={approval?.approved ? 'approved' : 'pending'}
      summary={<span className="aui-tool-pill">{args.action}</span>}
    >
      <div className="aui-approval-row">
        <button type="button" disabled={Boolean(result)}><CheckCircleIcon {...iconProps} />allow once</button>
        <button type="button" disabled={Boolean(result)}><XCircleIcon {...iconProps} />deny</button>
      </div>
      <ToolOutputBlock title="Decision">
        {JSON.stringify(result || approval || { pending: true }, null, 2)}
      </ToolOutputBlock>
    </ToolTraceCard>
  );
}

function TaskBoardInteractable() {
  const [state, { setState }] = unstable_useInteractable('traceTaskBoard', {
    description: 'A task board artifact the agent and user can both edit while discussing a trace run.',
    stateSchema: taskBoardSchema,
    initialState: {
      tasks: [
        { id: 'tool-ui', title: 'Render custom tool cards', done: true },
        { id: 'artifact', title: 'Wire editable artifact state', done: false },
        { id: 'adapter', title: 'Show runtime adapter matrix', done: false },
      ],
    },
  });

  return (
    <section className="aui-interactable-card">
      <header><ClipboardTextIcon {...iconProps} /><strong>unstable_useInteractable</strong><span>agent editable</span></header>
      <ul>
        {state.tasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => setState((previous) => ({ tasks: previous.tasks.map((item) => item.id === task.id ? { ...item, done: !item.done } : item) }))}
              />
              <span>{task.title}</span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setState((previous) => ({ tasks: [...previous.tasks, { id: `task-${previous.tasks.length + 1}`, title: 'Review next trace surface', done: false }] }))}>add task</button>
    </section>
  );
}

function ThreadSyncPill() {
  return (
    <div className="aui-sync-pill" role="status" aria-label="Syncing latest assistant work">
      <span className="aui-sync-spinner" aria-hidden="true" />
      <span>Syncing latest assistant work</span>
    </div>
  );
}

function ComposerContextStrip() {
  const [active, setActive] = useState('preview');
  const contexts = [
    ['terminal', <TerminalWindowIcon {...iconProps} />, 'dev server'],
    ['file', <FileCodeIcon {...iconProps} />, 'assistant-ui-components-page.jsx'],
    ['preview', <ArticleIcon {...iconProps} />, 'screenshot annotation'],
  ];

  return (
    <section className="aui-context-surface" aria-label="Composer contexts">
      <header><PaperPlaneTiltIcon {...iconProps} /><strong>composer contexts</strong><span>3 attached</span></header>
      <div className="aui-context-strip">
        {contexts.map(([id, icon, label]) => (
          <button key={id} type="button" className={active === id ? 'is-active' : ''} aria-pressed={active === id ? 'true' : 'false'} onClick={() => setActive(id)}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </div>
      <div className="aui-composer-control-row">
        <button type="button"><GlobeHemisphereWestIcon {...iconProps} />search</button>
        <button type="button"><GitDiffIcon {...iconProps} />diff</button>
        <button type="button"><DotsThreeIcon {...iconProps} />more</button>
      </div>
    </section>
  );
}

function ApprovalQueueSurface() {
  const [decision, setDecision] = useState('pending');
  return (
    <section className="aui-pending-panel">
      <div className="aui-pending-head">
        <span>Pending approval</span>
        <strong>Command approval requested</strong>
        <em>1/2</em>
      </div>
      <div className="aui-pending-detail">
        <span>Command</span>
        <pre>{'npm run build\nnode --test test/frontend-route-manifest.test.js'}</pre>
      </div>
      <div className="aui-approval-actions" data-decision={decision}>
        <button type="button" onClick={() => setDecision('cancelled')}>cancel turn</button>
        <button type="button" onClick={() => setDecision('declined')}>decline</button>
        <button type="button" onClick={() => setDecision('session')}>always allow this session</button>
        <button type="button" onClick={() => setDecision('once')}>approve once</button>
      </div>
    </section>
  );
}

function PendingUserInputSurface() {
  const [selected, setSelected] = useState('ghost');
  const options = [
    ['ghost', 'Ghost controls everywhere possible', 'Keep the UI quiet until hover, focus, or selection.'],
    ['dense', 'Denser trace scanning', 'Favor compact rows, file chips, and visible diff stats.'],
    ['full', 'Full artifact states', 'Show pending, trusted, collapsed, expanded, and dismissed states.'],
  ];

  return (
    <section className="aui-user-input-panel">
      <header><span>Design direction</span><em>1/1</em></header>
      <p>Which T3 interaction should this component page emphasize?</p>
      <div className="aui-choice-list">
        {options.map(([id, label, detail], index) => (
          <button key={id} type="button" className={selected === id ? 'is-selected' : ''} aria-pressed={selected === id ? 'true' : 'false'} onClick={() => setSelected(id)}>
            <span><strong>{label}</strong><small>{detail}</small></span>
            {selected === id ? <CheckCircleIcon {...iconProps} /> : <kbd>{index + 1}</kbd>}
          </button>
        ))}
      </div>
    </section>
  );
}

function DiffStatLabel({ plus, minus }) {
  return (
    <span className="aui-diff-stat" aria-label={`${plus} additions and ${minus} deletions`}>
      <span>+{plus}</span><span>-{minus}</span>
    </span>
  );
}

function ChangedFilesSurface() {
  const [expanded, setExpanded] = useState(false);
  const files = [
    ['frontend/src/assistant-ui-components-page.jsx', 189, 22],
    ['frontend/src/styles/app.css', 256, 18],
    ['implementation-notes/2026-07-30-t3code-agent-ui-component-lift.html', 34, 0],
  ];
  const previewFiles = files.map(([path]) => path.split('/').at(-1));

  return (
    <section className="aui-change-card" data-expanded={expanded ? 'true' : 'false'}>
      <div className="aui-change-head">
        <button type="button" aria-expanded={expanded ? 'true' : 'false'} onClick={() => setExpanded((value) => !value)}>
          <CaretRightIcon {...iconProps} /><strong>{files.length} changed files</strong><DiffStatLabel plus={479} minus={40} />
        </button>
        <button type="button"><GitDiffIcon {...iconProps} />open diff</button>
      </div>
      {!expanded && (
        <div className="aui-file-chips">
          {previewFiles.map((file) => <button key={file} type="button"><FileCodeIcon {...iconProps} /><span>{file}</span></button>)}
          <button type="button" onClick={() => setExpanded(true)}>show all</button>
        </div>
      )}
      {expanded && (
        <div className="aui-change-tree" role="tree">
          <button type="button" role="treeitem" aria-expanded="true"><CaretRightIcon {...iconProps} /><strong>frontend</strong></button>
          {files.slice(0, 2).map(([path, plus, minus]) => (
            <button key={path} type="button" role="treeitem">
              <FileCodeIcon {...iconProps} /><span>{path}</span><DiffStatLabel plus={plus} minus={minus} />
            </button>
          ))}
          <button type="button" role="treeitem" aria-expanded="true"><CaretRightIcon {...iconProps} /><strong>implementation-notes</strong></button>
          <button type="button" role="treeitem"><ArticleIcon {...iconProps} /><span>{files[2][0]}</span><DiffStatLabel plus={files[2][1]} minus={files[2][2]} /></button>
        </div>
      )}
    </section>
  );
}

function ProposedPlanSurface() {
  const [expanded, setExpanded] = useState(false);
  const lines = [
    'Compare each current assistant-ui specimen with the closest T3 Code surface.',
    'Add status, approval, user input, context chip, changed-file, plan, and inbox specimens.',
    'Keep controls ghost by default and expose active state only through hover, focus, or selection.',
    'Verify desktop, mobile, click states, and route build health before handing off.',
  ];
  const visibleLines = expanded ? lines : lines.slice(0, 2);

  return (
    <section className="aui-plan-card" data-expanded={expanded ? 'true' : 'false'}>
      <header>
        <div><span>Plan</span><strong>T3-informed component pass</strong></div>
        <button type="button" aria-label="Plan actions"><DotsThreeIcon {...iconProps} /></button>
      </header>
      <ol>
        {visibleLines.map((line) => <li key={line}>{line}</li>)}
      </ol>
      {!expanded && <div className="aui-plan-fade" aria-hidden="true" />}
      <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'collapse plan' : 'expand plan'}</button>
    </section>
  );
}

function PreviewAnnotationSurface() {
  const [visible, setVisible] = useState(true);
  if (!visible) {
    return <button className="aui-dismissed-annotation" type="button" onClick={() => setVisible(true)}>restore preview annotation</button>;
  }

  return (
    <section className="aui-annotation-card">
      <div className="aui-annotation-thumb" aria-hidden="true"><span /></div>
      <div className="aui-annotation-body">
        <header><strong>assistant-ui-components.png</strong><button type="button" aria-label="Remove annotation" onClick={() => setVisible(false)}><XCircleIcon {...iconProps} /></button></header>
        <p>Hero density overlaps less after compacting the thread/status region.</p>
        <div><span>1280x900</span><span>2 pins</span><span>review</span></div>
      </div>
    </section>
  );
}

function ThreadInboxSurface() {
  const [selected, setSelected] = useState('active');
  const rows = [
    ['active', 'running', 'T3 component lift', 'Syncing mock route and screenshots'],
    ['review', 'settled', 'Assistant UI ghosts', 'Ready for design review'],
    ['archived', 'settled', 'Trace components gallery', 'Shipped yesterday'],
  ];

  return (
    <section className="aui-inbox-preview" aria-label="Thread rows">
      <div className="aui-inbox-divider"><span>Active</span></div>
      {rows.map(([id, state, title, detail], index) => (
        <button key={id} type="button" className={cn(selected === id && 'is-selected', state === 'running' ? 'is-active' : 'is-settled')} onClick={() => setSelected(id)}>
          <span className="aui-row-dot" aria-hidden="true" />
          <span><strong>{title}</strong><small>{detail}</small></span>
          <em>{index === 0 ? 'now' : 'done'}</em>
        </button>
      ))}
    </section>
  );
}

function StaticToolStateBoard() {
  return (
    <section className="aui-spec-grid" aria-label="assistant-ui component specimens">
      <SpecimenCard eyebrow="Thread runtime" title="ThreadPrimitive + ComposerPrimitive" icon={<PaperPlaneTiltIcon {...iconProps} />}>
        <ThreadSyncPill />
        <ThreadInboxSurface />
      </SpecimenCard>
      <SpecimenCard eyebrow="Message parts" title="MessagePrimitive.GroupedParts" icon={<SparkleIcon {...iconProps} />}>
        <p>Reasoning and tool-call parts are grouped into one collapsible thinking region.</p>
        <code>groupPartByType</code>
      </SpecimenCard>
      <SpecimenCard eyebrow="Tool UI" title="Custom renderers" icon={<WrenchIcon {...iconProps} />}>
        <ToolSearchUI args={{ query: 'agent trace UI' }} result={{ sources: ['docs', 'repo', 'screenshots'] }} status={{ type: 'complete' }} />
        <ChangedFilesSurface />
      </SpecimenCard>
      <SpecimenCard eyebrow="Human state" title="Approval surface" icon={<ShieldCheckIcon {...iconProps} />}>
        <ApprovalQueueSurface />
        <PendingUserInputSurface />
      </SpecimenCard>
      <SpecimenCard eyebrow="Interactables" title="Editable artifact state" icon={<ClipboardTextIcon {...iconProps} />}>
        <ComposerContextStrip />
        <TaskBoardInteractable />
      </SpecimenCard>
      <SpecimenCard eyebrow="Artifacts" title="Document, diff, code, app" icon={<ArticleIcon {...iconProps} />}>
        <ProposedPlanSurface />
        <ArtifactPreview />
        <PreviewAnnotationSurface />
      </SpecimenCard>
      <SpecimenCard eyebrow="Adapters" title="Runtime extension slots" icon={<PlugsConnectedIcon {...iconProps} />}>
        <AdapterMatrix />
      </SpecimenCard>
      <SpecimenCard eyebrow="Protocols" title="Agent protocol adapters" icon={<DatabaseIcon {...iconProps} />}>
        <ProtocolStack />
      </SpecimenCard>
    </section>
  );
}

function SpecimenCard({ eyebrow, title, icon, children }) {
  return (
    <article className="aui-spec-card">
      <header>{icon}<span>{eyebrow}</span></header>
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function ArtifactPreview() {
  const [trusted, setTrusted] = useState(false);
  return (
    <div className="aui-artifact-preview">
      <div className="aui-artifact-tabs">
        <span><ArticleIcon {...iconProps} />notes.md</span>
        <span><GitDiffIcon {...iconProps} />diff</span>
        <span><FileCodeIcon {...iconProps} />html</span>
      </div>
      <pre>{`+ <MessagePrimitive.GroupedParts />
+ <TaskBoardInteractable />
+ <ToolSearchUI />`}</pre>
      <button type="button" aria-pressed={trusted ? 'true' : 'false'} onClick={() => setTrusted((value) => !value)}>{trusted ? 'interactive artifact' : 'trust artifact'}</button>
    </div>
  );
}

function AdapterMatrix() {
  const rows = [
    ['attachments', 'paperclip + upload lifecycle', 'ready'],
    ['history', 'thread persistence reload', 'mocked'],
    ['feedback', 'thumbs / ratings callback', 'ready'],
    ['suggestions', 'starter prompts', 'ready'],
    ['speech', 'dictation / TTS controls', 'deferred'],
  ];
  return <div className="aui-adapter-matrix">{rows.map(([name, detail, state]) => <div key={name}><strong>{name}</strong><span>{detail}</span><em>{state}</em></div>)}</div>;
}

function ProtocolStack() {
  return (
    <div className="aui-protocol-stack">
      {[
        ['react-ag-ui', 'AG-UI event agents'],
        ['react-a2a', 'A2A protocol servers'],
        ['AssistantTransport', 'state snapshots + commands'],
        ['DataStream', 'message-part streaming'],
        ['LocalRuntime', 'custom model adapter'],
      ].map(([name, detail]) => <div key={name}><CodeIcon {...iconProps} /><strong>{name}</strong><span>{detail}</span></div>)}
    </div>
  );
}

function ReferenceSources() {
  return (
    <aside className="aui-sources">
      <span>sources</span>
      <a href="https://www.assistant-ui.com/docs/primitives">primitives</a>
      <a href="https://www.assistant-ui.com/docs/tools/tool-ui">Tool UI</a>
      <a href="https://www.assistant-ui.com/docs/tools/interactables">Interactables</a>
      <a href="https://www.assistant-ui.com/docs/runtimes/concepts/architecture">runtime architecture</a>
      <a href="https://www.assistant-ui.com/docs/runtimes/concepts/adapters">adapters</a>
    </aside>
  );
}

function AppSidebar() {
  return (
    <aside className="aui-app-sidebar" aria-label="Assistant UI app navigation">
      <div className="aui-app-brand">
        <span><RobotIcon weight="fill" /></span>
        <div><strong>agent review</strong><small>assistant-ui runtime</small></div>
      </div>
      <ThreadSyncPill />
      <ThreadInboxSurface />
      <nav className="aui-app-links" aria-label="Reference routes">
        <a href="/trace-components.html">trace board</a>
        <a href="/trace-components.html#trace-library">trace library</a>
        <a href="https://www.assistant-ui.com/docs/tools/tool-ui">assistant-ui docs</a>
      </nav>
    </aside>
  );
}

function CurrentTurnRail() {
  return (
    <aside className="aui-current-rail" aria-label="Current turn details">
      <header>
        <span>Current turn</span>
        <strong>Review agent UI components</strong>
      </header>
      <ApprovalQueueSurface />
      <PendingUserInputSurface />
      <ChangedFilesSurface />
      <ProposedPlanSurface />
      <ArtifactPreview />
      <PreviewAnnotationSurface />
    </aside>
  );
}

function InspectorFiles() {
  const threads = [
    ['active', 'T3 component lift', 'Syncing mock route and screenshots', '+10k', '-1.2k'],
    ['review', 'Assistant UI ghosts', 'Ready for design review', '+335', '-2'],
    ['settled', 'Trace components gallery', 'Shipped yesterday', '+35', '-0'],
    ['settled', 'Current pricing page', 'No active changes', '', ''],
  ];
  const files = [
    ['2026-07-29-assistant-ui-components-view.html', 'U', '+89'],
    ['2026-07-29-end-to-end-trace-mock.html', 'U', '+35'],
    ['2026-07-29-t3code-sidebar-v2.html', 'U', '+1'],
    ['2026-07-29-thread-shaped-trace-mock.html', 'U', '+35'],
    ['2026-07-29-trace-components-clickthrough.html', 'U', '+35'],
    ['2026-07-29-trace-components-gallery.html', 'U', '+35'],
    ['2026-07-30-assistant-ui-in-app-layout.html', 'U', '+1'],
    ['2026-07-30-assistant-ui-tool-dropdown-polish.html', 'U', '+1'],
    ['2026-07-30-assistant-ui-tool-trace-polish.html', 'U', '+1'],
    ['2026-07-30-t3code-agent-ui-component-lift.html', 'U', '+1'],
  ];

  return (
    <div className="aui-inspector-files" aria-label="Workspace inspector">
      <section className="aui-right-thread-list" aria-label="Threads">
        <header><span>Threads</span><button type="button" aria-label="New worktree">+</button></header>
        {threads.map(([state, title, detail, plus, minus], index) => (
          <button key={title} type="button" className={index === 0 ? 'is-selected' : ''} aria-current={index === 0 ? 'true' : undefined}>
            <span className={`aui-right-thread-dot is-${state}`} aria-hidden="true" />
            <span><strong>{title}</strong><small>{detail}</small></span>
            {plus && <em>{plus}</em>}
            {minus && <i>{minus}</i>}
          </button>
        ))}
      </section>
      <section className="aui-right-file-list" aria-label="Changed files">
        <header><span>Changed files</span><strong>10</strong></header>
        {files.map(([file, status, plus]) => (
          <button key={file} type="button">
            <span className="aui-right-file-name">{file}</span>
            <kbd>{status}</kbd>
            <em>{plus}</em>
            <span className="aui-right-file-action" aria-hidden="true">+</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function RunInspectorPanel() {
  return (
    <aside className="aui-thread-inspector" aria-label="Run inspector">
      <InspectorFiles />
      <div className="aui-run-tabs" role="tablist" aria-label="Run views">
        <button type="button" aria-expanded="false"><CaretRightIcon {...iconProps} /></button>
        <button type="button" role="tab">Setup</button>
        <button type="button" role="tab" aria-selected="true">Run</button>
        <button type="button" role="tab">Terminal</button>
        <button type="button" aria-label="Add tab">+</button>
      </div>
      <div className="aui-run-empty">
        <button type="button">Add run script</button>
        <p>Run tests or a development command against changes in this workspace.</p>
      </div>
      <div className="aui-update-card" role="status">
        <button type="button" aria-label="Dismiss update"><XCircleIcon {...iconProps} /></button>
        <strong>New update available</strong>
        <div>
          <button type="button">See changes</button>
          <button type="button">Restart when ready</button>
        </div>
      </div>
    </aside>
  );
}

function RuntimeToolbar({ densityLabel, onToggleDensity }) {
  return (
    <header className="aui-runtime-toolbar">
      <div>
        <span>workspace</span>
        <h1>Agent trace UI review</h1>
      </div>
      <div className="aui-runtime-actions">
        <button type="button" onClick={onToggleDensity}>{densityLabel}</button>
        <a href="#assistant-ui-inventory">components</a>
      </div>
    </header>
  );
}

function ComponentInventoryDock() {
  return (
    <section className="aui-component-dock" id="assistant-ui-inventory" aria-label="Assistant UI component inventory">
      <header>
        <div>
          <span>component inventory</span>
          <h2>Everything mounted for implementation review</h2>
        </div>
        <ReferenceSources />
      </header>
      <StaticToolStateBoard />
    </section>
  );
}

export function AssistantUiComponentsPage() {
  const [density, setDensity] = useState('full');
  const densityLabel = useMemo(() => density === 'full' ? 'full surfaces' : 'compact surfaces', [density]);

  return (
    <AssistantUiRuntimeProvider>
      <main className={cn('assistant-ui-components-page', density === 'compact' && 'is-compact')}>
        <section className="aui-threadlike-frame">
          <section className="aui-runtime-panel" aria-label="Assistant thread">
            <RuntimeToolbar densityLabel={densityLabel} onToggleDensity={() => setDensity((value) => value === 'full' ? 'compact' : 'full')} />
            <AssistantUiThreadPreview />
          </section>
          <RunInspectorPanel />
        </section>
        <ComponentInventoryDock />
      </main>
    </AssistantUiRuntimeProvider>
  );
}
