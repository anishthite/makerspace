import {
  ArrowLeftIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CodeIcon,
  CopyIcon,
  FileIcon,
  FileJsIcon,
  FileTextIcon,
  GitDiffIcon,
  GlobeHemisphereWestIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  StopCircleIcon,
  TerminalWindowIcon,
  WrenchIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';

import { Button, InputGroup, ScrollArea, Select, StatusPill, Surface } from './components/ui.jsx';
import { cn } from '#lib/utils';

const buttonIconProps = { 'aria-hidden': true, 'data-icon': 'inline-start', className: 'size-4' };
const surface = 'rounded-md border border-[var(--rule)] bg-[var(--paper)] shadow-[var(--shadow)]';
const eyebrow = 'mb-2 font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.12em] text-[var(--blue)]';
const muted = 'text-[var(--ink-3)]';
const referenceFileIcons = {
  css: [CodeIcon, 'regular'],
  image: [FileIcon, 'fill'],
  md: [FileTextIcon, 'regular'],
  react: [FileJsIcon, 'fill'],
};
const referenceRowIcons = {
  bash: [TerminalWindowIcon, 'regular'],
  error: [XCircleIcon, 'fill'],
  mcp: [WrenchIcon, 'regular'],
  web: [GlobeHemisphereWestIcon, 'regular'],
  write: [PencilSimpleIcon, 'regular'],
};

const referenceRows = [
  { kind: 'read', label: 'Read 60 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read 128 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read image', file: 'image.png', fileKind: 'image' },
  { kind: 'bash', label: 'Bash', command: "curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:5189/trace-components.html#trace-library" },
  { kind: 'bash', label: 'Bash', command: 'npm run build' },
  { kind: 'error', label: 'Error', command: 'npm error code E404 npm error 404 Not Found - GET https://registry.npmjs.org/prompt-kit' },
  { kind: 'mcp', label: 'mcp__node_repl__js' },
  { kind: 'web', label: 'Web Search', command: 'https://www.assistant-ui.com/docs/ui/thread' },
  { kind: 'write', label: 'Write 232 lines', file: 'trace-components-page.jsx', fileKind: 'react' },
  { kind: 'write', label: 'Write 403 lines', file: 'trace-components.css', fileKind: 'css' },
];

const changedFiles = [
  { file: 'route-manifest.json', plus: 5, minus: 0, kind: 'json' },
  { file: 'trace-components-page.jsx', plus: 312, minus: 18, kind: 'react' },
  { file: 'app.css', plus: 244, minus: 0, kind: 'css' },
  { file: '+4 more', plus: 225, minus: 13, kind: 'doc' },
];

const missingTracePieces = [
  'approval / permission prompt state',
  'parallel tool group with child rows',
  'streaming partial output row',
  'cancelled / interrupted run state',
  'hidden redacted secret value',
  'retry / rerun affordance',
  'artifact download/open failure',
  'subagent handoff summary',
];

const codePreviewLines = [
  '---',
  'name: implementation-notes',
  'description: Maintain a durable, append-only log of design decisions, deviations, and tradeoffs.',
  '---',
  '',
  '# Implementation Notes',
  '',
  'Durable log of *why*, not *what*. The diff is the what.',
  '',
  '## Activate when',
  '',
  'Spec is ambiguous · deviating from convention · weighing real alternatives',
  '',
  '**Skip for:** one-line fixes, renames, lint, restating the spec.',
];

const mockFullTraceRows = [
  { kind: 'read', label: 'Read 49 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read 60 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read 220 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read 128 lines', file: 'SKILL.md', fileKind: 'md' },
  { kind: 'read', label: 'Read image', file: 'image.png', fileKind: 'image' },
  { kind: 'write', label: 'Write 184 lines', file: 'trace-components-page.jsx', fileKind: 'react' },
  { kind: 'write', label: 'Write 196 lines', file: 'app.css', fileKind: 'css' },
  { kind: 'bash', label: 'Bash', command: 'npm run build && node --test test/frontend-route-manifest.test.js' },
  { kind: 'mcp', label: 'Chrome verify', command: 'Trace component library · 0 console errors · no horizontal overflow' },
];

const mockFullCodeLines = [
  'function TraceFullRunMock() {',
  '  return <section className="trace-full-run" id="trace-full">',
  '    <TraceUserBubble segments={["ok ok ok so basically use that plus these images", "build out a new component library for traces"]} />',
  '    <TraceGroupSummary count="9 tool calls, 4 messages" />',
  '    <TraceReferenceRow row={mockFullTraceRows[0]} />',
  '    <TraceCodeBlock lines={mockFullCodeLines} />',
  '    <TraceFinalSummary />',
  '    <TraceDiffStrip files={mockFullDiffFiles} />',
  '  </section>;',
  '}',
];

const mockVerificationLines = [
  '> spanner@0.0.13 build',
  '> vite build',
  '',
  '✓ 1921 modules transformed.',
  '✓ built in 713ms',
  '',
  'TAP version 13',
  'ok 1 - React core routes are explicit Vite MPA entries',
  'ok 2 - active storage keys and deploy aliases are listed',
];

const mockFullDiffFiles = [
  { file: 'trace-components-page.jsx', plus: 184, minus: 12, kind: 'react' },
  { file: 'app.css', plus: 196, minus: 0, kind: 'css' },
  { file: 'trace-components-gallery.html', plus: 17, minus: 3, kind: 'doc' },
];

function ReferenceFileIcon({ kind }) {
  const [Icon, weight] = referenceFileIcons[kind] || [FileIcon, 'regular'];
  return <Icon weight={weight} />;
}

function ReferenceRowIcon({ kind }) {
  const [Icon, weight] = referenceRowIcons[kind] || [FileTextIcon, 'regular'];
  return <Icon weight={weight} />;
}

function traceRowKey(row) {
  return `${row.label}-${row.command || row.file || row.kind}`;
}

function traceReferenceKey(row) {
  return `${row.kind}-${traceRowKey(row)}`;
}

function FilePill({ file, kind = 'doc', children }) {
  return (
    <span className={cn('trace-ref-pill', kind && `is-${kind}`)}>
      <ReferenceFileIcon kind={kind} />
      <span>{file || children}</span>
    </span>
  );
}

function TraceReferenceRow({ row, active = false, onSelect }) {
  const Comp = onSelect ? 'button' : 'div';
  return (
    <Comp className={cn('trace-ref-row', `is-${row.kind}`, active && 'is-active')} type={onSelect ? 'button' : undefined} data-button={onSelect ? true : undefined} aria-pressed={onSelect ? active : undefined} onClick={onSelect}>
      <CaretRightIcon className="trace-ref-caret" weight="bold" />
      <ReferenceRowIcon kind={row.kind} />
      <strong>{row.label}</strong>
      {row.file && <FilePill file={row.file} kind={row.fileKind} />}
      {row.command && <code>{row.command}</code>}
    </Comp>
  );
}

function TraceGroupSummary({ count = '47 tool calls, 36 messages', expanded = true, onClick }) {
  return (
    <button className="trace-group-summary" type="button" aria-expanded={expanded ? 'true' : 'false'} onClick={onClick}>
      {expanded ? <CaretDownIcon weight="bold" /> : <CaretRightIcon weight="bold" />}
      <span>{count}</span>
      <FileTextIcon />
      <MagnifyingGlassIcon />
      <TerminalWindowIcon />
      <PencilSimpleIcon />
      <WrenchIcon />
      <FileIcon />
    </button>
  );
}

function TraceCodeBlock({ collapsed = false, lines: sourceLines = codePreviewLines, label = 'Code preview block' }) {
  const lines = collapsed ? sourceLines.slice(0, 5) : sourceLines;
  return (
    <div className="trace-code-block" aria-label={label}>
      <ol>
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>
            <span>{index + 1}</span>
            <code>{line || ' '}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TraceUserBubble({ segments = ['none of this looks as good tho', 'for example look at this'], file = 'image.png', files }) {
  const attachmentFiles = files || (file ? [file] : []);
  const visibleAttachments = attachmentFiles.slice(0, 2);
  const hiddenAttachmentCount = attachmentFiles.length - visibleAttachments.length;
  return (
    <div className="trace-user-bubble">
      <span>{segments[0]}</span>
      {attachmentFiles.length > 0 && <div className="trace-user-attachments">
        {visibleAttachments.map((attachment) => <FilePill key={attachment} file={attachment} kind="image" />)}
        {hiddenAttachmentCount > 0 && <span className="trace-ref-pill is-image trace-attachment-count">+{hiddenAttachmentCount} images</span>}
      </div>}
      {segments.slice(1).map((segment) => <span key={segment}>{segment}</span>)}
    </div>
  );
}

function TraceFinalSummary({
  intro = 'Done. It’s running and open in Chrome:',
  url = 'http://127.0.0.1:5189/trace-components.html#trace-library',
  checks = [
    { label: 'server returns', code: '200' },
    { label: 'React page mounted:', code: 'Trace component library' },
    { label: 'server is running on port', code: '5189' },
  ],
}) {
  return (
    <section className="trace-final-summary" aria-label="Final response summary">
      <p>{intro}</p>
      <a className="trace-url-pill" href={url.replace('http://127.0.0.1:5189', '')}>
        <span>{url}</span>
        <span aria-hidden="true">↗</span>
      </a>
      <p>Verified:</p>
      <ul>
        {checks.map((check) => <li key={`${check.label}-${check.code}`}>{check.label} <code>{check.code}</code></li>)}
      </ul>
    </section>
  );
}

function TraceDiffStrip({ copied = false, activeFile = '', files = changedFiles, onCopy, onOpen, onSelectFile }) {
  return (
    <div className="trace-diff-strip" aria-label="Changed files">
      <span className="trace-age">8m, 13s</span>
      <button type="button" aria-label="Copy summary" onClick={onCopy}>{copied ? 'copied' : <CopyIcon />}</button>
      <button type="button" aria-label="Open full diff" onClick={onOpen}>...</button>
      {files.map((file) => (
        <button className={cn('trace-diff-file', activeFile === file.file && 'is-active')} type="button" key={file.file} onClick={() => onSelectFile?.(file.file)}>
          <FilePill file={file.file} kind={file.kind} />
          <b>+{file.plus}</b>
          <em>-{file.minus}</em>
        </button>
      ))}
    </div>
  );
}

function TraceComponentSpec({ name, children, coverage }) {
  return (
    <article className="trace-spec-card">
      <header>
        <span>{coverage}</span>
        <h3>{name}</h3>
      </header>
      {children}
    </article>
  );
}

function TraceMissingPanel() {
  return (
    <aside className="trace-missing-panel">
      <p className="trace-section-label">beyond the screenshots</p>
      <h2>States now mocked as specimens</h2>
      <ul>
        {missingTracePieces.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </aside>
  );
}

function TraceFullRunMock({ copied = false, activeFile = '', onCopy, onOpen, onSelectFile }) {
  return (
    <section className="trace-full-run" id="trace-full" aria-label="End to end mock trace">
      <header className="trace-full-head">
        <div>
          <p className="trace-section-label">end-to-end mock run</p>
          <h2>Build a trace component library from screenshots</h2>
        </div>
        <span>12m 08s · completed</span>
      </header>

      <div className="trace-run-turn is-user">
        <TraceUserBubble
          file="image.png"
          segments={[
            'ok ok ok so basically use that plus these other images',
            'build out a new component library for traces and tell me if anything is missing',
          ]}
        />
      </div>

      <div className="trace-run-turn is-assistant">
        <p className="trace-ref-copy">I’ll treat the screenshots as the visual source of truth and build a full trace surface that shows the whole run, not only separate component samples.</p>
      </div>

      <div className="trace-run-stage">
        <TraceGroupSummary count="9 tool calls, 4 messages" expanded />
        <div className="trace-ref-list">
          {mockFullTraceRows.slice(0, 4).map((row) => <TraceReferenceRow key={traceReferenceKey(row)} row={row} />)}
        </div>
        <p className="trace-ref-copy">The package search dead-ended on one library, so the trace falls back to local primitives that match the product screenshots: dark transcript canvas, tiny file pills, mono output, and a restrained diff footer.</p>
      </div>

      <TraceCodeBlock lines={mockFullCodeLines} label="End to end mock implementation code" />

      <div className="trace-run-stage is-verify">
        <TraceGroupSummary count="5 verification calls, 2 rendered checks" expanded />
        <div className="trace-ref-list">
          {mockFullTraceRows.slice(4).map((row) => <TraceReferenceRow key={traceReferenceKey(row)} row={row} />)}
        </div>
      </div>

      <TraceCodeBlock lines={mockVerificationLines} label="Build and route verification output" />

      <TraceFinalSummary
        intro="Done. The full mock trace is rendered as one end-to-end run:"
        url="http://127.0.0.1:5189/trace-components.html#trace-full"
        checks={[
          { label: 'screenshot-derived states:', code: 'header, rows, code, final, diff' },
          { label: 'missing states listed:', code: '8' },
          { label: 'desktop/mobile overflow:', code: '0' },
        ]}
      />

      <TraceDiffStrip copied={copied} activeFile={activeFile} files={mockFullDiffFiles} onCopy={onCopy} onOpen={onOpen} onSelectFile={onSelectFile} />
    </section>
  );
}

function TraceReferenceLibraryPage() {
  const [groupOpen, setGroupOpen] = useState(true);
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeRow, setActiveRow] = useState('Bash');
  const [activeFile, setActiveFile] = useState('trace-components-page.jsx');
  const visibleRows = groupOpen ? referenceRows : referenceRows.slice(0, 3);
  const selectedRow = referenceRows.find((row) => traceRowKey(row) === activeRow) || referenceRows[3];

  function copySummary() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  return (
    <main className="trace-library-page">
      <header className="trace-library-hero">
        <a href="/trace-components.html">current board</a>
        <p>trace components / reference library</p>
        <h1>Trace component library</h1>
        <span>Built from the attached Conductor/ChatGPT-style screenshots.</span>
        <div className="trace-click-toolbar" aria-label="Trace library controls">
          <a href="/trace-components.html#trace-elements">individual elements</a>
          <a href="/trace-components.html#trace-full">full mock trace</a>
          <button type="button" onClick={() => setGroupOpen((value) => !value)}>{groupOpen ? 'collapse calls' : 'expand calls'}</button>
          <button type="button" onClick={() => setCodeCollapsed((value) => !value)}>{codeCollapsed ? 'show full code' : 'shorten code'}</button>
          <button type="button" onClick={copySummary}>{copied ? 'copied summary' : 'copy summary'}</button>
        </div>
      </header>

      <section className="trace-library-shell" aria-label="Trace reference transcript">
        <TraceGroupSummary expanded={groupOpen} count={groupOpen ? '47 tool calls, 36 messages' : '3 visible calls, trace collapsed'} onClick={() => setGroupOpen((value) => !value)} />
        <p className="trace-ref-copy">I’m going to inspect the screenshot closely and adjust the demo toward that specific visual language.</p>
        <div className="trace-ref-list">
          {visibleRows.slice(0, 3).map((row) => {
            const key = traceRowKey(row);
            return <TraceReferenceRow key={traceReferenceKey(row)} row={row} active={activeRow === key} onSelect={() => setActiveRow(key)} />;
          })}
        </div>
        {groupOpen && <>
          <p className="trace-ref-copy">The quality is from restraint: dark canvas, large readable transcript rhythm, tiny tool rows, command pills, and almost no card chrome.</p>
          <TraceCodeBlock collapsed={codeCollapsed} />
          <div className="trace-ref-list">
            {visibleRows.slice(3, 8).map((row) => {
              const key = traceRowKey(row);
              return <TraceReferenceRow key={traceReferenceKey(row)} row={row} active={activeRow === key} onSelect={() => setActiveRow(key)} />;
            })}
          </div>
        </>}
        <TraceFinalSummary />
        <TraceUserBubble />
        <TraceDiffStrip copied={copied} activeFile={activeFile} onCopy={copySummary} onOpen={() => setActiveFile('__all__')} onSelectFile={setActiveFile} />
        <aside className="trace-selection-panel" aria-live="polite">
          <strong>selected</strong>
          <span>{selectedRow.label}</span>
          <code>{activeFile === '__all__' ? 'full diff' : activeFile}</code>
        </aside>
      </section>

      <section className="trace-spec-grid" aria-label="Trace component specifications">
        <TraceComponentSpec name="TraceGroupSummary" coverage="header">
          <TraceGroupSummary count="15 tool calls, 6 messages" expanded={groupOpen} onClick={() => setGroupOpen((value) => !value)} />
        </TraceComponentSpec>
        <TraceComponentSpec name="TraceActionRow" coverage="tool rows">
          <div className="trace-ref-list compact">
            {referenceRows.slice(3, 10).map((row) => {
              const key = traceRowKey(row);
              return <TraceReferenceRow key={traceReferenceKey(row)} row={row} active={activeRow === key} onSelect={() => setActiveRow(key)} />;
            })}
          </div>
        </TraceComponentSpec>
        <TraceComponentSpec name="TraceCodeBlock" coverage="code output">
          <TraceCodeBlock collapsed={codeCollapsed} />
        </TraceComponentSpec>
        <TraceComponentSpec name="TraceResultSummary" coverage="final answer">
          <TraceFinalSummary />
        </TraceComponentSpec>
        <TraceComponentSpec name="TraceAttachmentBubble" coverage="user message">
          <TraceUserBubble />
        </TraceComponentSpec>
        <TraceComponentSpec name="TraceDiffStrip" coverage="changed files">
          <TraceDiffStrip copied={copied} activeFile={activeFile} onCopy={copySummary} onOpen={() => setActiveFile('__all__')} onSelectFile={setActiveFile} />
        </TraceComponentSpec>
      </section>

      <TraceMissingPanel />
    </main>
  );
}

function TraceElementSpecimen({ name, type, children }) {
  return <article className="trace-element-card">
    <header>
      <span>{type}</span>
      <h2>{name}</h2>
    </header>
    <div className="trace-element-preview">
      {children}
    </div>
  </article>;
}

function TraceElementsPage() {
  const [copied, setCopied] = useState(false);
  const [groupOpen, setGroupOpen] = useState(true);
  const [artifactTrusted, setArtifactTrusted] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState('cards');

  function copySummary() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  return <main id="trace-elements" className="trace-library-page trace-elements-page">
    <header className="trace-library-hero trace-elements-hero">
      <a href="/trace-components.html#trace-full">full thread mock</a>
      <p>trace components / individual elements</p>
      <h1>Trace elements</h1>
      <span>Every mocked trace piece rendered by itself, without the full thread page around it.</span>
      <div className="trace-click-toolbar" aria-label="Trace element navigation">
        <a href="/trace-components.html#trace-library">reference library</a>
        <a href="/trace-components.html">legacy board</a>
      </div>
    </header>

    <section className="trace-elements-grid" aria-label="Individual trace component specimens">
      <TraceElementSpecimen name="FilePill" type="primitive">
        <div className="trace-element-row">
          <FilePill file="trace-components-page.jsx" kind="react" />
          <FilePill file="app.css" kind="css" />
          <FilePill file="SKILL.md" kind="md" />
          <FilePill file="image.png" kind="image" />
          <FilePill file="route-manifest.json" kind="json" />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceGroupSummary" type="trace header">
        <div className="trace-element-stack">
          <TraceGroupSummary count="47 tool calls, 36 messages" expanded={groupOpen} onClick={() => setGroupOpen((value) => !value)} />
          <TraceGroupSummary count="3 visible calls, trace collapsed" expanded={false} onClick={() => setGroupOpen((value) => !value)} />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceReferenceRow" type="tool rows">
        <div className="trace-ref-list">
          {referenceRows.map((row) => <TraceReferenceRow key={traceReferenceKey(row)} row={row} active={row.kind === 'bash'} />)}
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceCodeBlock" type="output">
        <TraceCodeBlock lines={mockVerificationLines} label="Build verification output specimen" />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceUserBubble" type="message">
        <TraceUserBubble
          files={['h0pJ4M/image.png', 'A270Om/image.png', 'TBKD97/image.png', 'SUgReX/image.png', 'L1Grkx/image.png']}
          segments={['use these screenshots too', 'make the trace components cleaner']}
        />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceFinalSummary" type="assistant result">
        <TraceFinalSummary
          intro="Done. The trace elements are available as isolated specimens:"
          url="http://127.0.0.1:5189/trace-components.html#trace-elements"
          checks={[
            { label: 'individual elements:', code: 'visible' },
            { label: 'thread mock:', code: '#trace-full' },
            { label: 'reference library:', code: '#trace-library' },
          ]}
        />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceDiffStrip" type="changed files">
        <TraceDiffStrip copied={copied} activeFile="trace-components-page.jsx" files={mockFullDiffFiles} onCopy={copySummary} />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="RunSummaryCard" type="timeline">
        <div className="trace-element-timeline">
          <RunSummaryCard expanded detail="completed · rebuilt trace element specimens" label="6m, 10s" />
          <RunSummaryCard expanded={false} detail="" label="worked for 48s" />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="MessageCard" type="timeline">
        <div className="trace-element-timeline">
          {messageSamples.map((message, index) => <MessageCard key={`${message.role}-${index}`} {...message} copied={copied && index === 0} onCopy={copySummary} />)}
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ThinkingCard" type="timeline">
        <div className="trace-element-timeline">
          <ThinkingCard />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ToolCard" type="tool call">
        <div className="trace-element-timeline">
          <ToolCard {...toolGroups[1].tools[1]} open />
          <ToolCard {...toolGroups[1].tools[3]} open />
          <ToolCard {...toolGroups[1].tools[4]} open />
          <ToolCard {...toolGroups[3].tools[3]} open workflow />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TimelineCard" type="events">
        <div className="trace-element-timeline">
          {timelineCards.map((card) => <TimelineCard key={`${card.kind}-${card.title}`} {...card} />)}
          <ImplementationNoteCard />
          <LegacyLogCard />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="TraceReviewPanel" type="side pane">
        <div className="trace-element-review-preview">
          <TraceReviewPanel />
        </div>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="AgentGraph" type="workflow">
        <AgentGraph selected={selectedWorkflow} onSelect={setSelectedWorkflow} />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ArtifactBoard" type="artifacts">
        <ArtifactBoard trusted={artifactTrusted} copied={copied} onTrust={() => setArtifactTrusted((value) => !value)} onCopy={copySummary} />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="DiffAndNotesBoard" type="rail">
        <DiffAndNotesBoard activeFile="trace-components-page.jsx" />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ComposerControls" type="input controls">
        <form className="flow-composer trace-element-composer" onSubmit={(event) => event.preventDefault()}>
          <div className="composer-field">
            <label className="sr-only" htmlFor="trace-elements-prompt">Prompt</label>
            <textarea id="trace-elements-prompt" rows="2" placeholder="Next task..." defaultValue="make the individual element view easier to scan" readOnly></textarea>
            <small className="composer-hint muted">Enter sends · Shift+Enter adds a line</small>
            <ThreadMockRunControls />
          </div>
          <Button variant="primary" type="submit"><PaperPlaneTiltIcon {...buttonIconProps} />send</Button>
        </form>
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ApprovalPromptState" type="missing state">
        <TraceApprovalPrompt />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ParallelToolGroup" type="missing state">
        <TraceParallelToolGroup />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="StreamingPartialOutput" type="missing state">
        <TraceStreamingOutput />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="CancelledRunState" type="missing state">
        <TraceCancelledRun />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="RedactedSecretValue" type="missing state">
        <TraceRedactedSecret />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="RetryRerunAffordance" type="missing state">
        <TraceRetryAffordance />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="ArtifactOpenFailure" type="missing state">
        <TraceArtifactFailure />
      </TraceElementSpecimen>

      <TraceElementSpecimen name="SubagentHandoffSummary" type="missing state">
        <TraceSubagentHandoff />
      </TraceElementSpecimen>
    </section>

    <TraceMissingPanel />
  </main>;
}

function getTraceComponentsView() {
  if (typeof window === 'undefined') return 'gallery';

  const url = new URL(window.location.href);
  if (url.hash === '#trace-elements' || url.searchParams.get('view') === 'trace-elements') {
    return 'elements';
  }

  if (url.hash === '#trace-full' || url.searchParams.get('view') === 'thread-mock') {
    return 'thread-mock';
  }

  if (url.hash === '#trace-library' || url.searchParams.get('view') === 'trace-library') {
    return 'library';
  }

  return 'gallery';
}

const timelineCards = [
  { kind: 'status', title: 'status', detail: 'Running · streaming updates' },
  { kind: 'metric', title: 'metric', detail: 'first model call started · 1.8s' },
  { kind: 'log', title: 'log', detail: '[system] Pi session trace: /tmp/pi-session.jsonl' },
  { kind: 'system-line', title: 'system', detail: 'Backend unavailable. Check Settings.' },
  { kind: 'summary-item', title: 'summary', detail: 'Built a literal trace-card board for editing the product components.' },
];

const messageSamples = [
  {
    role: 'user',
    label: 'you',
    body: 'can you mock up all of our current components for showing agent traces, etc.',
  },
  {
    role: 'assistant',
    label: 'main agent',
    body: 'I found the existing trace board and expanded it with live DOM classes for messages, tool calls, thinking, notes, diffs, artifacts, and workflow state.',
    color: 'green',
  },
  {
    role: 'assistant',
    label: 'main agent',
    body: 'Waiting on one decision: should tool outputs default open for failed calls only, or for every mutating command?',
    color: 'amber',
  },
  {
    role: 'assistant',
    label: 'main agent',
    body: 'Raw streaming text block\n- preserves whitespace\n- uses the mono render mode',
    color: 'gray',
    renderMode: 'text',
  },
];

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

const flatToolItems = toolGroups.flatMap((group) => group.tools.map((tool, index) => ({ ...tool, group: group.title, key: `${group.title}-${tool.label}-${index}` })));
const initialToolOpenState = Object.fromEntries(flatToolItems.map((tool) => [tool.key, Boolean(tool.open)]));

function MessageCard({ role = 'assistant', label, body, color = '', renderMode = 'html', copied = false, onCopy }) {
  return <article className={cn('timeline-item message-item', role)} data-turn-color={role === 'assistant' ? color || undefined : undefined}>
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="message-card">
      <div className="message-head"><strong>{label}</strong></div>
      <div className="message-body" data-render-mode={renderMode}>{body}</div>
      {role === 'assistant' && <button className="copy-button" type="button" aria-label={`copy ${label} message`} onClick={onCopy}>{copied ? 'copied' : 'copy'}</button>}
    </div>
  </article>;
}

function ToolCard({ label, action, state = 'done', output = '', open = false, workflow = false, onToggle }) {
  return <article className={cn('timeline-item tool-item', workflow && 'workflow-item')}>
    <div className="timeline-dot" aria-hidden="true"></div>
    <details className={cn('tool-card', workflow && 'workflow-card')} data-state={state} data-phase={state === 'done' ? 'end' : 'start'} open={open} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
      <summary>
        <span data-tool-label>{label}</span>
        <span className="tool-target" data-tool-action>{action}</span>
        <span className="badge">{state}</span>
      </summary>
      <pre>{output}</pre>
    </details>
  </article>;
}

function LegacyLogCard() {
  return <article className="timeline-item tool-item legacy-log">
    <div className="timeline-dot" aria-hidden="true"></div>
    <details className="tool-card" data-state="done" data-phase="end" open>
      <summary>
        <span data-tool-label>system trace</span>
        <span className="tool-target" data-tool-action>parsed from legacy stdout</span>
        <span className="badge">done</span>
      </summary>
      <pre>[2026-07-29T10:41:00Z] [system] main agent session trace: /tmp/pi-session.jsonl
[2026-07-29T10:41:03Z] [system] ready</pre>
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

function ImplementationNoteCard() {
  return <article className="timeline-item implementation-note">
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="timeline-card note-card">
      <strong>implementation note</strong>
      <p>Trace component gallery</p>
      <p className="note-path"><code>implementation-notes/2026-07-29-trace-components-gallery.html</code></p>
      <ul className="note-files">
        <li><code>frontend/src/trace-components-page.jsx</code><span>touch · Add message, artifact, note, and trace-shell specimens.</span></li>
        <li><code>frontend/route-manifest.json</code><span>touch · List the existing trace board route.</span></li>
      </ul>
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

function RunSummaryCard({ expanded = true, detail = 'Working · editing frontend/src/trace-components-page.jsx', label = 'ran 2m 14s', onToggle }) {
  return <article className="timeline-item run-summary-item">
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className="run-summary-card">
      <button className="run-summary muted" type="button" aria-controls="agent-trace" aria-expanded={expanded ? 'true' : 'false'} title="show full trace" onClick={onToggle}>{label}</button>
      <p className="run-summary-detail muted" data-run-summary-detail hidden={!detail}>{detail}</p>
    </div>
  </article>;
}

function DiffPreviewDialog({ open, onClose, activeFile }) {
  if (!open) return null;
  return <div className="trace-modal-backdrop" role="presentation" onClick={onClose}>
    <section className="diff-dialog trace-modal" role="dialog" aria-modal="true" aria-labelledby="trace-diff-title" onClick={(event) => event.stopPropagation()}>
      <div className="diff-dialog-shell">
        <header className="diff-dialog-head">
          <h2 id="trace-diff-title">{activeFile === '__all__' ? 'Full diff' : activeFile || 'trace-components-page.jsx'}</h2>
          <button className="textbtn" type="button" onClick={onClose}>close</button>
        </header>
        <nav className="diff-dialog-files" aria-label="Diff files">
          {changedFiles.map((file) => <button className={cn('diff-file', activeFile === file.file && 'is-active')} type="button" key={file.file}>{file.file}</button>)}
        </nav>
        <div className="diff-dialog-body">
          <pre className="diff-plain-preview">{`diff --git a/frontend/src/trace-components-page.jsx b/frontend/src/trace-components-page.jsx
@@
+ const [traceOpen, setTraceOpen] = useState(true);
+ const [toolFilter, setToolFilter] = useState('all');
+ <DiffPreviewDialog open={diffOpen} />`}</pre>
        </div>
      </div>
    </section>
  </div>;
}

function DiffAndNotesBoard({ onOpenDiff, activeFile = '' }) {
  return <Surface className={cn(surface, 'grid gap-3 p-4')}>
    <p className={eyebrow}>diff + notes rail</p>
    <div className="grid gap-3">
      <button className="diff-box" type="button" aria-label="Open changes: 3 files changed" onClick={onOpenDiff}>
        <span>changes</span>
        <strong>{activeFile ? `${activeFile} · +96 -12` : '3 files · +96 -12'}</strong>
      </button>
      <div className="hidden-tool-hint muted">Hidden activity stays summarized until the run summary opens the full trace.</div>
      <article className="rail-note has-preview">
        <div className="rail-note-head">
          <strong>Trace component gallery</strong>
          <code>implementation-notes/2026-07-29-trace-components-gallery.html</code>
        </div>
        <p className="rail-note-summary">Expose every current trace/output component on the board route.</p>
        <iframe
          className="html-preview note-html-preview"
          title="implementation note preview"
          sandbox="allow-same-origin"
          scrolling="no"
          srcDoc="<html><body style='margin:0;padding:12px;background:#fff;color:#111;font:400 13px Inter,ui-sans-serif,system-ui,sans-serif'><strong>Trace component gallery</strong><p>Files · Decisions · Verification</p></body></html>"
        />
      </article>
    </div>
  </Surface>;
}

function ArtifactBoard({ trusted = false, copied = false, onTrust, onCopy }) {
  return <Surface className={cn(surface, 'grid gap-3 p-4')}>
    <p className={eyebrow}>assistant artifact cards</p>
    <div className="message-card html-rendered openui-rendered">
      <div className="message-body" data-render-mode="html">
        <section className="excalidraw-artifacts diagram-artifacts" aria-label="Diagram artifacts">
          <article className="excalidraw-card diagram-image-card" title="output/playwright/trace-components-literal-desktop.png">
            <div className="excalidraw-card-head"><strong>trace-components-literal-desktop.png</strong><a href="/favicon.svg">open</a></div>
            <img className="diagram-inline-image" src="/favicon.svg" alt="Diagram preview placeholder" loading="lazy" />
          </article>
          <article className="excalidraw-card" title="interactive-agent-ui-plan.excalidraw">
            <div className="excalidraw-card-head"><strong>interactive-agent-ui-plan.excalidraw</strong><span className="excalidraw-card-links"><a href="/favicon.svg">open</a><a href="/favicon.svg">source</a></span></div>
            <iframe
              className="excalidraw-inline-viewer"
              title="Excalidraw artifact preview"
              sandbox="allow-same-origin"
              srcDoc="<html><body style='margin:0;display:grid;place-items:center;height:100%;background:#151923;color:#8CBDFD;font:400 12px Inter,ui-sans-serif,system-ui,sans-serif'>excalidraw viewer</body></html>"
            />
            <div className="excalidraw-card-actions"><button type="button">simplify</button><button type="button">relayout</button><button type="button">edit diagram</button></div>
          </article>
        </section>

        <section className="excalidraw-artifacts html-artifacts" aria-label="HTML artifacts">
          <article className={cn('excalidraw-card html-artifact-card', trusted && 'is-interactive')} title="output/playwright/agent-trace-tool-cards.html">
            <div className="excalidraw-card-head"><strong>agent-trace-tool-cards.html</strong><span className="html-artifact-controls"><a href="/trace-components.html">open</a><button className="html-artifact-interact" type="button" aria-pressed={trusted ? 'true' : 'false'} onClick={onTrust}>{trusted ? 'interactive' : 'interact'}</button></span></div>
            <iframe
              className={cn('html-artifact-frame', trusted && 'is-interactive')}
              title="HTML artifact preview"
              sandbox={trusted ? 'allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals' : ''}
              srcDoc="<html><body style='margin:0;padding:18px;background:#0E1118;color:#E6EDF3;font:400 13px Inter,ui-sans-serif,system-ui,sans-serif'><strong>artifact preview</strong><p>trusted iframe state</p></body></html>"
            />
          </article>
        </section>

        <section className="interactive-artifacts" aria-label="Interactive assistant controls">
          <article className="interactive-artifact-card">
            <div className="interactive-artifact-head"><strong>Steer the next pass</strong><span>interactive</span></div>
            <p className="interactive-artifact-description">Adjust the trace gallery before sending the next instruction.</p>
            <div className="interactive-controls">
              <label className="interactive-control"><span className="interactive-control-label">Density</span><span className="interactive-slider-row"><input type="range" min="1" max="10" defaultValue="6" /><output>6</output></span><p className="interactive-control-help">Lower values keep cards compact.</p></label>
              <label className="interactive-control"><span className="interactive-control-label">Mode</span><Select defaultValue="all"><option value="all">All components</option><option value="trace">Trace only</option></Select></label>
              <div className="interactive-control"><span className="interactive-control-label">Include</span><div className="interactive-choice-list"><label className="interactive-choice"><input type="checkbox" defaultChecked /> artifacts</label><label className="interactive-choice"><input type="checkbox" defaultChecked /> notes</label></div></div>
            </div>
            <div className="interactive-actions"><button className="interactive-action-button" type="button">Revise</button></div>
          </article>
        </section>

        <section className="openui-artifacts" aria-label="OpenUI assistant components">
          <article className="openui-artifact-card">
            <div className="openui-artifact-host" data-openui-root="1">
              <div className="openui-artifact-rendered"><div className="openui-card openui-card-card"><p>OpenUI rendered answer host</p></div></div>
            </div>
          </article>
        </section>
      </div>
      <button className="copy-button" type="button" aria-label="copy artifact message" onClick={onCopy}>{copied ? 'copied' : 'copy'}</button>
    </div>
  </Surface>;
}

function AgentGraph({ selected = 'mobile', onSelect }) {
  return <Surface as="aside" className={cn(surface, 'agent-rail is-open')} aria-label="Literal agent graph components">
    <div className="rail-head"><span>workflow agents</span><strong>{selected} · selected</strong></div>
    <p className="rail-hint">same agent-node/workflow-view-node classes</p>
    <div className="agent-graph">
      <div className="agent-node pi working"><span>main agent</span><small>working</small></div>
      <div className="agent-edge"></div>
      <div className="subagent-stack workflow-agent-stack">
        <div className="workflow-map">
          <div className="workflow-map-head workflow-title running"><span>trace-audit</span></div>
          <div className="workflow-flow">
            <section className="workflow-lane"><div className="workflow-lane-head"><span><i>1</i>review</span><small>1 running</small></div><div className="workflow-agent-grid"><button data-button className={cn('workflow-view-node workflow-agent done', selected === 'cards' && 'is-selected')} type="button" onClick={() => onSelect?.('cards')}><div className="workflow-node-top"><span>cards</span><b>done</b></div><small>Tool card density is readable.</small></button><button data-button className={cn('workflow-view-node workflow-agent running', selected === 'mobile' && 'is-selected')} type="button" onClick={() => onSelect?.('mobile')}><div className="workflow-node-top"><span>mobile</span><b>running</b></div><small>Checking narrow layout.</small></button></div></section>
            <section className="workflow-lane"><div className="workflow-lane-head"><span><i>2</i>verify</span><small>0/1 done</small></div><div className="workflow-agent-grid"><button data-button className={cn('workflow-view-node workflow-agent error', selected === 'accessibility' && 'is-selected')} type="button" onClick={() => onSelect?.('accessibility')}><div className="workflow-node-top"><span>accessibility</span><b>failed</b></div><small>Needs focus-ring pass.</small></button></div></section>
          </div>
        </div>
      </div>
    </div>
  </Surface>;
}

function ThreadMockRunControls() {
  return <div className="composer-controls min-w-0 max-sm:w-full max-sm:flex-wrap" aria-label="main agent run controls">
    <div className="attachment-row composer-attachment-row max-sm:flex-[1_1_auto]">
      <Button as="label" variant="ghost" size="sm" className="attach-btn" htmlFor="trace-mock-images" aria-label="add images" title="add images"><PlusIcon {...buttonIconProps} /></Button>
      <input id="trace-mock-images" className="image-input" name="images" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple />
      <span className="attachment-status muted" role="status" aria-live="polite">5 images</span>
    </div>
    <InputGroup label="model" className="model-picker max-sm:flex-[1_1_100%]">
      <Select name="modelRef" variant="inline" defaultValue="codex-gpt-5"><option value="codex-gpt-5">codex · gpt-5</option></Select>
    </InputGroup>
    <InputGroup label="thinking" className="thinking-picker max-sm:flex-[1_1_100%]">
      <Select name="thinkingLevel" variant="inline" aria-label="Thinking level" defaultValue="xhigh"><option value="off">off</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></Select>
    </InputGroup>
  </div>;
}

function ThreadMockMessage({ role = 'assistant', children, attachments = false, turnStatus = '', runId = 'trace-mock-run', componentized = false }) {
  return <article className={cn('timeline-item message-item', role)} data-run-id={runId} data-turn-color={role === 'assistant' ? turnStatus || undefined : undefined}>
    <div className="timeline-dot" aria-hidden="true"></div>
    <div className={cn('message-card', componentized && 'trace-thread-component-card')}>
      {componentized ? children : <div className="message-body" data-render-mode="text">
          {children}
          {attachments && <div className="message-attachments">
            {['h0pJ4M/image.png', 'A270Om/image.png', 'TBKD97/image.png', 'SUgReX/image.png', 'L1Grkx/image.png'].map((image) => <div className="trace-thread-attachment message-attachment-image" key={image}><FileIcon aria-hidden="true" />{image}</div>)}
          </div>}
        </div>}
      {role === 'assistant' && <button className="copy-button" type="button" aria-label="copy assistant message">copy</button>}
    </div>
  </article>;
}

function ThreadTraceComponentRun() {
  return <article className="timeline-item tool-item trace-thread-component-run" data-run-id="trace-mock-run">
    <div className="timeline-dot" aria-hidden="true"></div>
    <section className="trace-thread-component-stack" aria-label="Componentized trace run">
      <TraceGroupSummary count="9 tool calls, 4 messages" expanded />
      <p className="trace-ref-copy">I’ll use the trace components we mocked up directly inside the thread page frame.</p>
      <div className="trace-ref-list">
        {mockFullTraceRows.slice(0, 5).map((row) => <TraceReferenceRow key={traceReferenceKey(row)} row={row} />)}
      </div>
    </section>
  </article>;
}

function ThreadMockFinalMessage() {
  return <ThreadMockMessage role="assistant" turnStatus="green" componentized>
    <TraceFinalSummary
      intro="Done. I replaced the plain thread mock cards with the trace components from the mock library:"
      url="http://127.0.0.1:5189/trace-components.html#trace-full"
      checks={[
        { label: 'thread shell:', code: 'real page frame' },
        { label: 'trace rows:', code: 'TraceGroupSummary + TraceReferenceRow' },
        { label: 'code/final/diff:', code: 'TraceCodeBlock + TraceFinalSummary + TraceDiffStrip' },
      ]}
    />
  </ThreadMockMessage>;
}

function ThreadMockLeadResult() {
  return <ThreadMockMessage role="assistant" componentized>
    <section className="trace-thread-lead-result" aria-label="Latest assistant result">
      <ul>
        <li>Desktop Chrome: no console errors, no horizontal overflow</li>
        <li>Mobile 390px: responsive split pane stacks cleanly</li>
        <li>Route returns <code>200</code></li>
      </ul>
      <p>The cleaned page is open at <a href="/trace-components.html#trace-full">http://127.0.0.1:5189/trace-components.html#trace-full</a>.</p>
      <TraceDiffStrip
        files={[
          { file: 'app.css', plus: 219, minus: 44, kind: 'css' },
          { file: 'trace-components-page.jsx', plus: 4, minus: 3, kind: 'react' },
          { file: '2026-07-29-thread-shaped-trace-mock.html', plus: 2, minus: 2, kind: 'doc' },
        ]}
      />
    </section>
  </ThreadMockMessage>;
}

function ThreadMockAgentRail() {
  return <aside className="agent-column" aria-label="Workflow agents">
    <Surface as="div" id="agent-rail" className="agent-rail flow-card is-open" aria-label="Workflow agent trace" role="button" tabIndex="0" aria-controls="agent-trace" aria-expanded="true">
      <div className="rail-head"><span>workflow agents</span><strong id="agent-graph-count">3 active</strong></div>
      <p className="rail-hint">click for full workflow trace</p>
      <div id="agent-graph" className="agent-graph">
        <div className="agent-node pi done"><span>main agent</span><small>done</small></div>
        <div className="agent-edge"></div>
        <div className="subagent-stack workflow-agent-stack">
          <div className="workflow-map">
            <div className="workflow-map-head workflow-title running"><span>trace-components</span></div>
            <div className="workflow-flow">
              <section className="workflow-lane">
                <div className="workflow-lane-head"><span><i>1</i>review</span><small>2/2 done</small></div>
                <div className="workflow-agent-grid">
                  <article className="workflow-view-node workflow-agent done"><div className="workflow-node-top"><span>screenshots</span><b>done</b></div><small>Matched the Conductor thread chrome.</small></article>
                  <article className="workflow-view-node workflow-agent done"><div className="workflow-node-top"><span>mobile</span><b>done</b></div><small>Checked narrow trace overflow.</small></article>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </Surface>
    <Surface as="section" id="todo-rail" className="todo-rail flow-card" aria-label="Agent todos">
      <div className="rail-head"><span>todos</span><strong id="todo-count">4/4</strong></div>
      <div id="todo-list" className="todo-list">
        {['inspect thread page DOM', 'replace dark full-run shell', 'verify desktop render', 'verify mobile render'].map((todo) => <div className="todo-item completed" key={todo}><span className="todo-dot"></span><div><strong>{todo}</strong><small>completed</small></div></div>)}
      </div>
    </Surface>
    <Surface as="div" id="diff-box" className="diff-box flow-card trace-thread-rail-diff" role="button" tabIndex="0" aria-label="Changed files">
      <span className="inline-flex items-center gap-1.5"><GitDiffIcon className="size-4" aria-hidden="true" />changes</span>
      <strong id="diff-count">3 files edited · +397 -19</strong>
      <TraceDiffStrip files={mockFullDiffFiles} />
    </Surface>
  </aside>;
}

function ThreadMockToolTrace() {
  return <aside id="agent-trace" className="agent-activity agent-trace-inline trace-thread-mock-activity" aria-label="Full workflow trace" aria-hidden="false">
    <div className="agent-activity-head"><div className="rail-head"><span>workflow trace</span><strong>events</strong></div><Button variant="ghost" type="button"><ArrowLeftIcon {...buttonIconProps} />hide</Button></div>
    <ScrollArea id="trace-timeline" className="timeline-flow trace-thread-component-stack" aria-live="polite">
      <ThinkingCard />
      <TraceGroupSummary count="5 verification calls, 2 rendered checks" expanded />
      <div className="trace-ref-list">
        {mockFullTraceRows.slice(4).map((row) => <TraceReferenceRow key={traceReferenceKey(row)} row={row} />)}
      </div>
      <div className="trace-thread-code-preview">
        <TraceCodeBlock lines={mockVerificationLines} label="Build and browser verification output" />
      </div>
      <TimelineCard kind="workflow-item" title="workflow finished" detail="trace-components · continuing main agent">
        <details open><summary>workflow result</summary><pre>confirmed: #trace-full uses the mocked trace components inside the thread page frame.</pre></details>
      </TimelineCard>
    </ScrollArea>
  </aside>;
}

const conductorReviewFiles = [
  { file: 'frontend/src/trace-components-page.jsx', change: '+149', state: 'U', marked: true },
  { file: 'frontend/src/styles/app.css', change: '+1275 -10', state: 'U', marked: true },
  { file: 'implementation-notes/2026-07-29-thread-shaped-trace-mock.html', change: '+2 -2', state: 'U', marked: false },
  { file: 'frontend/route-manifest.json', change: '+5', state: 'U', marked: false },
  { file: 'frontend/src/pages.jsx', change: '+2', state: 'U', marked: true },
  { file: 'vite.config.js', change: '+1', state: 'U', marked: false },
];

function TraceReviewPanel() {
  return <Surface className="notes-main flow-card trace-review-panel" aria-label="Review panel">
    <nav className="trace-review-tabs" aria-label="Review tabs">
      <button type="button">All files</button>
      <button className="is-active" type="button">Changes 19</button>
      <button type="button">Checks</button>
      <button type="button">Review</button>
    </nav>
    <div className="trace-review-files" aria-label="Changed files">
      {conductorReviewFiles.map((item) => <button className="trace-review-file" type="button" key={item.file}>
        <span>{item.file}</span>
        <code>{item.state}</code>
        <strong>{item.change}</strong>
        <em>{item.marked ? '+' : '□'}</em>
      </button>)}
    </div>
    <section className="trace-run-panel" aria-label="Run scripts">
      <div className="trace-run-tabs"><button type="button">Setup</button><button className="is-active" type="button">Run</button><button type="button">Terminal</button><button type="button">+</button></div>
      <div className="trace-run-empty">
        <Button variant="ghost" type="button">Add run script</Button>
        <p>Run tests or a development server to test changes in this workspace</p>
      </div>
    </section>
  </Surface>;
}

function TraceApprovalPrompt() {
  return <section className="trace-state-card trace-approval-card" aria-label="Approval request">
    <header>
      <span>permission required</span>
      <strong>Run shell command</strong>
      <StatusPill tone="warning">waiting</StatusPill>
    </header>
    <p>The agent wants to install and run a package in this workspace.</p>
    <code>npm install @assistant-ui/react && npm run build</code>
    <div className="trace-state-actions">
      <Button variant="primary" size="sm" type="button">Allow once</Button>
      <Button variant="ghost" size="sm" type="button">Deny</Button>
      <Button variant="ghost" size="sm" type="button">Edit command</Button>
    </div>
  </section>;
}

function TraceParallelToolGroup() {
  return <section className="trace-state-card trace-parallel-card" aria-label="Parallel tool group">
    <TraceGroupSummary count="3 tool calls running in parallel" expanded />
    <div className="trace-parallel-children">
      <TraceReferenceRow row={{ kind: 'read', label: 'Read 128 lines', file: 'thread.js', fileKind: 'react' }} />
      <TraceReferenceRow row={{ kind: 'read', label: 'Read 220 lines', file: 'app.css', fileKind: 'css' }} />
      <TraceReferenceRow row={{ kind: 'bash', label: 'Bash', command: 'rg -n "workflow-view-node|tool-card"' }} />
    </div>
  </section>;
}

function TraceStreamingOutput() {
  return <details className="tool-card trace-state-tool-card trace-streaming-card" data-state="running" data-phase="start" open>
    <summary>
      <span data-tool-label>Bash</span>
      <span className="tool-target" data-tool-action>running npm run build</span>
      <span className="badge">streaming</span>
    </summary>
    <pre>{`> spanner@0.0.13 build
> vite build

transforming modules...
✓ 1420 modules transformed.
rendering chunks...
`}</pre>
    <div className="trace-stream-footer"><span></span>still running</div>
  </details>;
}

function TraceCancelledRun() {
  return <section className="trace-state-card trace-cancelled-card" aria-label="Cancelled run">
    <header>
      <span>interrupted</span>
      <strong>Run stopped by user</strong>
      <StatusPill tone="error">cancelled</StatusPill>
    </header>
    <p>Stopped while editing <code>frontend/src/styles/app.css</code>. Partial changes and trace output are preserved.</p>
    <div className="trace-state-actions">
      <Button variant="ghost" size="sm" type="button">Resume from here</Button>
      <Button variant="ghost" size="sm" type="button">Rerun last command</Button>
    </div>
  </section>;
}

function TraceRedactedSecret() {
  return <section className="trace-state-card trace-secret-card" aria-label="Redacted secret">
    <header>
      <span>redacted</span>
      <strong>Hidden environment value</strong>
      <StatusPill>protected</StatusPill>
    </header>
    <div className="trace-secret-row">
      <code>OPENAI_API_KEY</code>
      <span className="trace-secret-mask" aria-label="Secret redacted">••••••••••••••••</span>
      <em>secret redacted before display and copy</em>
    </div>
  </section>;
}

function TraceRetryAffordance() {
  return <details className="tool-card trace-state-tool-card trace-retry-card" data-state="error" data-phase="end" open>
    <summary>
      <span data-tool-label>Bash</span>
      <span className="tool-target" data-tool-action>running npm test -- trace</span>
      <span className="badge">failed</span>
    </summary>
    <pre>{`Error: Cannot find module './ToolCallCard'
attempt 1/3 exited with code 1`}</pre>
    <div className="trace-state-actions">
      <Button variant="primary" size="sm" type="button">Retry same args</Button>
      <Button variant="ghost" size="sm" type="button">Edit and rerun</Button>
    </div>
  </details>;
}

function TraceArtifactFailure() {
  return <article className="excalidraw-card html-artifact-card trace-artifact-failure" title="output/playwright/trace-preview.html">
    <div className="excalidraw-card-head">
      <strong>trace-preview.html</strong>
      <span className="html-artifact-controls"><a href="/trace-components.html#trace-elements">source</a><button type="button">retry render</button></span>
    </div>
    <div className="trace-artifact-error">
      <XCircleIcon weight="fill" aria-hidden="true" />
      <div>
        <strong>Could not open artifact preview</strong>
        <p>Sandbox blocked script execution. Raw file is still available.</p>
      </div>
    </div>
  </article>;
}

function TraceSubagentHandoff() {
  return <section className="trace-state-card trace-handoff-card" aria-label="Subagent handoff summary">
    <div className="workflow-map">
      <div className="workflow-map-head workflow-title running"><span>trace-audit</span></div>
      <div className="workflow-flow">
        <section className="workflow-lane">
          <div className="workflow-lane-head"><span><i>1</i>handoff</span><small>3 agents</small></div>
          <div className="workflow-agent-grid">
            <article className="workflow-view-node workflow-agent done"><div className="workflow-node-top"><span>screenshots</span><b>done</b></div><small>Found right-pane and composer mismatch.</small></article>
            <article className="workflow-view-node workflow-agent done"><div className="workflow-node-top"><span>components</span><b>done</b></div><small>Added missing state specimens.</small></article>
            <article className="workflow-view-node workflow-agent running"><div className="workflow-node-top"><span>review</span><b>running</b></div><small>Checking visual density before merge.</small></article>
          </div>
        </section>
      </div>
    </div>
    <p>Accepted by main agent · 2 files changed · full trace available.</p>
  </section>;
}

function ThreadLikeTraceMockPage() {
  return <main id="trace-full" className="thread-flow-shell trace-thread-mock">
    <section className="thread-stage" aria-label="Main agent workspace">
      <header className="thread-main-header">
        <nav className="trace-window-tabs" aria-label="Open threads">
          <a href="/trace-components.html#trace-elements">agent-element...</a>
          <a className="is-active" href="/trace-components.html#trace-full">Recommen...</a>
          <a href="/trace-components.html">Mock up agent...</a>
          <button type="button" aria-label="new tab">+</button>
        </nav>
        <div className="thread-main-row max-sm:flex-wrap max-sm:items-start">
          <a className="brand" href="/trace-components.html#trace-library" aria-label="Back to trace library"><span className="brand-box"><ArrowLeftIcon className="size-4" aria-hidden="true" /></span><span className="project-pill">trace components</span></a>
          <h1 id="thinking-title" className="min-w-0">Build trace components from screenshots</h1>
          <div className="header-actions">
            <StatusPill id="thread-status" tone="success">completed</StatusPill>
            <Button id="stop-thread" variant="ghost" className="thread-stop-btn" type="button"><StopCircleIcon {...buttonIconProps} />stop</Button>
            <Button id="archive-thread" variant="primary" className="thread-done-btn" type="button"><CheckCircleIcon {...buttonIconProps} />archive</Button>
          </div>
        </div>
        <p id="thinking-detail" className={muted}>main agent · ran 12m 08s · edited 3 files · verified in Chrome</p>
        <div className="sr-only"><strong id="thread-title">Build trace components from screenshots</strong><span id="thread-meta">completed</span></div>
      </header>

      <ThreadMockAgentRail />

      <section className="flow-wrap thread-workspace" aria-label="Main agent conversation">
        <section className="conversation-main flow-card" aria-label="Main agent conversation">
          <ScrollArea id="timeline" className="timeline-flow" aria-live="polite">
            <ThreadMockLeadResult />
            <ThreadMockMessage role="user" componentized>
              <TraceUserBubble
                files={['h0pJ4M/image.png', 'A270Om/image.png', 'TBKD97/image.png', 'SUgReX/image.png', 'L1Grkx/image.png', 'S6jD9K/image.png', 'tridAe/image.png']}
                segments={[
                  'just keep running it till it hits a high score of > 95',
                  'use these references too and make the rest match the thread page',
                ]}
              />
            </ThreadMockMessage>
            <RunSummaryCard expanded detail="completed · rebuilt the first viewport against the stricter visual rubric" label="6m, 10s" />
            <ThreadMockMessage role="assistant">I’ll keep iterating against the screenshots instead of stopping at component parity: flatter transcript, tighter chips, cleaner first viewport, quieter composer, and stricter pane fidelity.</ThreadMockMessage>
            <ThreadTraceComponentRun />
          </ScrollArea>
          <ThreadMockToolTrace />
          <ScrollArea className="timeline-flow trace-thread-final-flow" aria-live="polite">
            <ThreadMockFinalMessage />
          </ScrollArea>
        </section>

        <TraceReviewPanel />

        <form id="prompt-form" className="flow-composer" onSubmit={(event) => event.preventDefault()}>
          <div className="composer-field">
            <label className="sr-only" htmlFor="prompt">Prompt</label>
            <textarea id="prompt" rows="2" placeholder="Next task…" defaultValue="make it cleaner and closer to the real thread page" readOnly></textarea>
            <small id="composer-hint" className="composer-hint muted">Enter sends · Shift+Enter adds a line</small>
            <ThreadMockRunControls />
          </div>
          <Button id="send" variant="primary" type="submit"><PaperPlaneTiltIcon {...buttonIconProps} />send</Button>
        </form>
      </section>
    </section>
  </main>;
}

function TraceComponentsGalleryPage() {
  const [traceOpen, setTraceOpen] = useState(true);
  const [toolFilter, setToolFilter] = useState('all');
  const [toolOpen, setToolOpen] = useState(initialToolOpenState);
  const [copiedTarget, setCopiedTarget] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const [activeFile, setActiveFile] = useState('trace-components-page.jsx');
  const [artifactTrusted, setArtifactTrusted] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState('mobile');

  function flashCopied(target) {
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget(''), 900);
  }

  function setAllTools(open) {
    setToolOpen(Object.fromEntries(flatToolItems.map((tool) => [tool.key, open])));
  }

  function toolVisible(tool) {
    if (toolFilter === 'running') return tool.state === 'running';
    if (toolFilter === 'errors') return tool.state === 'error';
    if (toolFilter === 'open') return toolOpen[tool.key];
    return true;
  }

  return <main className="thread-flow-shell trace-components-gallery py-6">
    <header className="thread-main-header static mb-4">
      <div className="thread-main-row">
        <a className="brand" href="/workspace.html" aria-label="Back to workspace"><span className="brand-box">←</span></a>
        <h1>Literal trace components</h1>
        <div className="header-actions"><Button as="a" href="/trace-components.html#trace-elements" variant="ghost">elements</Button><Button as="a" href="/trace-components.html#trace-library" variant="ghost">trace library</Button><Button as="a" href="/thread.html" variant="ghost">open thread</Button></div>
      </div>
      <p className={muted}>Uses the same <code>.timeline-item</code>, <code>.tool-card</code>, <code>.thinking-card</code>, <code>.timeline-card</code>, and workflow-node DOM that the live thread renderer emits.</p>
      <div className="trace-click-toolbar" aria-label="Trace board controls">
        {['all', 'running', 'errors', 'open'].map((filter) => <button className={cn(toolFilter === filter && 'is-active')} type="button" key={filter} onClick={() => setToolFilter(filter)}>{filter}</button>)}
        <button type="button" onClick={() => setAllTools(true)}>expand all</button>
        <button type="button" onClick={() => setAllTools(false)}>collapse all</button>
        <button type="button" onClick={() => setTraceOpen((value) => !value)}>{traceOpen ? 'hide trace' : 'show trace'}</button>
      </div>
    </header>

    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <section className="grid min-w-0 gap-4">
        <Surface className={cn(surface, 'grid gap-3 p-4')}>
          <p className={eyebrow}>message cards</p>
          <ScrollArea className="timeline-flow" style={{ paddingBottom: 24 }}>
            {messageSamples.map((message, index) => <MessageCard key={`${message.role}-${index}`} {...message} copied={copiedTarget === `message-${index}`} onCopy={() => flashCopied(`message-${index}`)} />)}
          </ScrollArea>
        </Surface>

        <Surface className={cn(surface, 'grid gap-3 p-4')}>
          <p className={eyebrow}>timeline primitives</p>
          <ScrollArea className="timeline-flow" style={{ paddingBottom: 24 }}>
            <RunSummaryCard expanded={traceOpen} onToggle={() => setTraceOpen((value) => !value)} />
            <RunSummaryCard expanded={false} detail="" label="worked for 48s" onToggle={() => setTraceOpen((value) => !value)} />
            <ThinkingCard />
            {timelineCards.map((card) => <TimelineCard key={`${card.kind}-${card.title}`} {...card} />)}
            <TimelineCard kind="workflow-item" title="workflow finished" detail="trace-audit · run-trace-audit-123 · continuing main agent">
              <details><summary>workflow result</summary><pre>confirmed: edit the literal .tool-card component first</pre></details>
            </TimelineCard>
            <ImplementationNoteCard />
            <LegacyLogCard />
          </ScrollArea>
        </Surface>

        {traceOpen && toolGroups.map((group) => {
          const tools = group.tools
            .map((tool, index) => ({ ...tool, key: `${group.title}-${tool.label}-${index}` }))
            .filter(toolVisible);
          return <Surface key={group.title} className={cn(surface, 'grid gap-3 p-4')}>
            <p className={eyebrow}>{group.title}</p>
            <ScrollArea className="timeline-flow" style={{ paddingBottom: 24 }}>
              {tools.length ? tools.map((tool) => {
                const { key, ...toolProps } = tool;
                return <ToolCard key={key} {...toolProps} open={toolOpen[key]} onToggle={(open) => setToolOpen((current) => ({ ...current, [key]: open }))} />;
              }) : <TimelineCard kind="system-line" title="no matching calls" detail={`Filter: ${toolFilter}`} />}
            </ScrollArea>
          </Surface>;
        })}
      </section>

      <aside className="grid content-start gap-4">
        <AgentGraph selected={selectedWorkflow} onSelect={setSelectedWorkflow} />
        <ArtifactBoard trusted={artifactTrusted} copied={copiedTarget === 'artifact'} onTrust={() => setArtifactTrusted((value) => !value)} onCopy={() => flashCopied('artifact')} />
        <DiffAndNotesBoard activeFile={activeFile} onOpenDiff={() => setDiffOpen(true)} />
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
    <DiffPreviewDialog open={diffOpen} activeFile={activeFile} onClose={() => setDiffOpen(false)} />
  </main>;
}

export function TraceComponentsPage() {
  if (getTraceComponentsView() === 'elements') {
    return <TraceElementsPage />;
  }

  if (getTraceComponentsView() === 'thread-mock') {
    return <ThreadLikeTraceMockPage />;
  }

  if (getTraceComponentsView() === 'library') {
    return <TraceReferenceLibraryPage />;
  }

  return <TraceComponentsGalleryPage />;
}
