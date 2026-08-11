import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const components = readFileSync(new URL('../frontend/src/components/ui.jsx', import.meta.url), 'utf8');
const threadHtml = readFileSync(new URL('../frontend/thread.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');
const openuiRenderer = readFileSync(new URL('../frontend/src/runtime/openui-renderer.jsx', import.meta.url), 'utf8');
const artifactUtils = readFileSync(new URL('../frontend/src/runtime/excalidraw-artifacts.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/server/routes.js', import.meta.url), 'utf8');
const threadService = readFileSync(new URL('../src/server/threads.js', import.meta.url), 'utf8');
const css = [
  readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../frontend/src/styles/thread.css', import.meta.url), 'utf8'),
].join('\n');

test('thread tool trace is wired to the inline trace timeline', () => {
  assert.match(pages, /id="timeline"/);
  assert.match(pages, /id="agent-trace"/);
  assert.match(pages, /id="trace-timeline"/);
  assert.match(js, /const traceTimeline = document\.querySelector\('#trace-timeline'\)/);
  assert.match(js, /traceTimeline\.append\(article\)/);
  assert.doesNotMatch(js, /timeline\.append\(article\);\n\s*node = article\.querySelector\('\.tool-card'\)/);
});

test('conversation runtime markers live in the timeline and toggle the inline trace', () => {
  assert.doesNotMatch(pages, /id="run-summary"/);
  assert.match(pages, /className="agent-activity agent-trace-inline"/);
  assert.match(js, /function appendRunSummaryMarker/);
  assert.match(js, /article\.className = 'timeline-item run-summary-item'/);
  assert.match(js, /button\.addEventListener\('click', \(\) => toggleAgentActivity\(article\)\)/);
  assert.match(js, /placeAgentActivityInline\(anchor\)/);
  assert.match(js, /appendMessage\('user'[\s\S]+activeRunSummaryMarker = appendRunSummaryMarker/);
  assert.doesNotMatch(js, /activeRunSummaryMarker = appendRunSummaryMarker[\s\S]{0,240}activeAssistantBody = appendMessage\('assistant'/);
  assert.match(js, /syncRunSummaryExpanded\(open\)/);
  assert.match(js, /formatElapsedMinutes/);
  assert.match(js, /data-run-summary-detail/);
  assert.match(js, /function syncRunSummaryToolDetail/);
  assert.match(js, /setRunSummaryDetail\(detail \|\| display\.action \|\| display\.label/);
});

test('run summary duration includes seconds', () => {
  const start = js.indexOf('function formatElapsedMinutes');
  const end = js.indexOf('function runSummaryCopy');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  runInNewContext(`${js.slice(start, end)}; globalThis.result = [formatElapsedMinutes(12_000), formatElapsedMinutes(65_000), formatElapsedMinutes(120_000)];`, context);
  assert.equal(context.result.join('|'), '12s|1 min 5s|2 min');
});

test('usage telemetry is not rendered as timeline content', () => {
  assert.match(js, /updateLastEventId\(event\);\n\s*if \(event\.type === 'usage'\) return;/);
});

test('answer summary events refresh thread state and history', () => {
  assert.match(js, /event\.type === 'title' \|\| event\.type === 'answer_summary'/);
  assert.match(js, /renderThreadHistory\(event\.session\)/);
});

test('thread page reload fetches fresh worker trace state', () => {
  assert.match(js, /async function fetchJson\(path, options = \{\}\)/);
  assert.match(js, /cache: 'no-store'/);
});

test('thread output replays stored trace events without advancing stream cursor', () => {
  assert.match(routes, /readStoredTraceEvents/);
  assert.match(routes, /mergeTraceEvents\(storedEvents, run\.events\)/);
  assert.match(js, /if \(event\.historical\) \{/);
  assert.match(js, /if \(event\?\.historical\) return;/);
  assert.match(js, /if \(appendTranscript && !event\.historical\) appendAssistantChunk\(event\.chunk\)/);
});

test('workflow trace interlaces thinking entries and answer summaries chronologically', () => {
  assert.match(pages, /<span>workflow trace<\/span><strong>events<\/strong>/);
  assert.match(js, /function renderTimelineThinkingEvent/);
  assert.match(js, /article\.innerHTML = '<div class="thinking-card"><div class="thinking-body"><\/div><\/div>'/);
  assert.match(js, /renderThinkingBody\(article\.querySelector\('\.thinking-body'\), text\);\n\s*traceTimeline\.append\(article\)/);
  assert.doesNotMatch(js, /thinkingCards|thinkingTraceKey/);
  assert.match(js, /function renderTimelineSummaryEvent/);
  assert.match(js, /event\.type === 'answer_summary' && isNewEvent/);
  assert.match(js, /renderTimelineThinkingEvent\(event\)/);
  assert.match(css, /\.thinking-card/);
  assert.doesNotMatch(js, /formatTime/);
  assert.doesNotMatch(js, /data-thinking-time/);
});

test('tool stream phases preserve structured arguments through the end event', () => {
  const start = js.indexOf('function mergeToolEvent');
  const end = js.indexOf('function normalizedToolName');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  runInNewContext(`
    const toolEventSnapshots = new Map();
    function toolKey(event) { return event.toolCallId; }
    ${js.slice(start, end)}
    mergeToolEvent({ toolCallId: 'call-1', toolName: 'read', phase: 'planned', args: { path: 'src/app.js', limit: 12 } });
    globalThis.result = mergeToolEvent({ toolCallId: 'call-1', toolName: 'read', phase: 'end', args: null, output: 'done', isError: false });
  `, context);
  assert.equal(context.result.args.path, 'src/app.js');
  assert.equal(context.result.args.limit, 12);
  assert.equal(context.result.output, 'done');
  assert.equal(context.result.phase, 'end');
});

test('workflow rail renders workflow agents, not generic tool calls', () => {
  assert.match(pages, /aria-label="Workflow agent trace"/);
  assert.match(pages, /<span>workflow agents<\/span><strong id="agent-graph-count">idle<\/strong>/);
  assert.match(pages, /click for full workflow trace/);
  assert.match(js, /const workflowRuns = new Map\(\)/);
  assert.match(js, /function renderWorkflowRun/);
  assert.match(js, /function workflowAgentSummary/);
  assert.doesNotMatch(js, /workflowAgentDetail|workflowAgentDetail\('tools', agent\.toolPreview\)/);
  assert.match(js, /function workflowStepDone/);
  assert.match(js, /waiting for workflow journal/);
  assert.match(js, /workflow-title/);
  assert.match(js, /workflow-agent-stack/);
  assert.doesNotMatch(js, /workflow-phase-strip|workflow-phase-pill|workflow-step-link|workflow-terminal|workflow run → journal/);
  assert.match(css, /workflow-view-node::before/);
  assert.match(css, /workflow-view-node\.running \.workflow-node-top b/);
  assert.match(css, /\.agent-column \{[^}]*min-width: 0/);
  assert.match(css, /\.workflow-view-node small \{[^}]*overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /workflow-agent-stack \{[^}]*overflow-y: auto|workflow-phase-pill|workflow-agent-detail|workflow-terminal|workflow-step-link/);
  assert.match(js, /workflow agents appear here when a workflow starts/);
  assert.match(js, /\/workflows\/\$\{encodeURIComponent\(runId\)\}/);
  assert.doesNotMatch(js, /const processHtml = graphItems\.map/);
  assert.doesNotMatch(js, /item\.kind \|\| 'tool'/);
  assert.doesNotMatch(js, /workflow trace · click to expand/);
});

test('thread main header spans above the right workflow rail', () => {
  const headerIndex = pages.indexOf('className="thread-main-header"');
  const sidebarIndex = pages.indexOf('<aside className="agent-column"');
  const workspaceIndex = pages.indexOf('<section className="flow-wrap thread-workspace"');
  assert.ok(headerIndex > -1 && headerIndex < sidebarIndex);
  assert.ok(sidebarIndex < workspaceIndex);
  assert.match(pages, /<div className="thread-main-row[^"]*">[\s\S]+aria-label="open agents"[\s\S]+id="thinking-title"[\s\S]+id="archive-thread"[\s\S]+<\/div>/);
  assert.match(css, /\.thread-main-header \{ position: sticky; top: 0; z-index: 20; grid-column: 1 \/ -1; [^}]*display: grid/);
  assert.match(css, /\.thread-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(190px, 250px\)/);
  assert.match(css, /\.flow-wrap \{[^}]*grid-column: 1;[^}]*grid-row: 2/);
  assert.match(css, /\.agent-column \{[^}]*grid-column: 2;[^}]*grid-row: 2/);
  assert.match(css, /body\.thread-page \.thread-stage \{[^}]*grid-template-rows: auto minmax\(0, 1fr\);[^}]*align-content: start/);
  assert.match(css, /body\.thread-page \.flow-wrap\.thread-workspace \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100%/);
  assert.match(css, /body\.thread-page \.flow-composer \{[^}]*margin-top: auto/);
  assert.match(css, /\.thread-main-row \{ display: flex; align-items: center/);
  assert.match(css, /\.thread-main-row h1 \{[^}]*font-size: clamp\(20px, 2\.2vw, 28px\)/);
  assert.doesNotMatch(components, /now-card flow-card/);
});

test('thread main header omits redundant done detail', () => {
  const start = js.indexOf('function headerDetailCopy');
  const end = js.indexOf('function setNow');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  runInNewContext(`${js.slice(start, end)}; globalThis.result = [headerDetailCopy('Done', ''), headerDetailCopy('Working', 'editing')].join('|');`, context);
  assert.equal(context.result, '|Working · editing');
  assert.match(js, /if \(graphStatus === 'done'\) thinkingDetail\.textContent = ''/);
});

test('changes rail is a summary button without inline preview', () => {
  assert.match(pages, /<button id="diff-box" className="diff-box flow-card" type="button" aria-label="Open changes" hidden>[\s\S]*<strong id="diff-count">0 files edited · 0 lines<\/strong><\/button>/);
  assert.doesNotMatch(pages, /<details id="diff-box"/);
  assert.doesNotMatch(pages, /id="diff-editor"|id="diff-files"/);
  assert.match(js, /function formatDiffSummary/);
  assert.match(js, /openDiffDialog\('__all__'\)/);
  assert.match(js, /@pierre\/diffs/);
  assert.doesNotMatch(js, /diff2html|diffEditor|selectedDiffPath|selected diff/);
  assert.doesNotMatch(css, /d2h-|\.diff-editor|\.diff-spanner|\.diff-open-button/);
});

test('changes summary counts edited files and changed lines', () => {
  const start = js.indexOf('function diffSections');
  const end = js.indexOf('function isUnifiedDiff');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  runInNewContext(`${js.slice(start, end)}; globalThis.result = formatDiffSummary({ files: [{ path: 'app.js', diff: 'diff --git a/app.js b/app.js\\n--- a/app.js\\n+++ b/app.js\\n@@ -1 +1 @@\\n-old\\n+new' }, { path: 'notes.md', diff: 'edited notes.md\\n\\n+line' }] });`, context);
  assert.equal(context.result, '2 files edited · 3 lines');
});

test('tool rows preserve generic action copy and use typed chips for known tools', () => {
  assert.match(js, /function toolTarget/);
  assert.match(js, /function toolAction/);
  assert.match(js, /\['path', 'file_path', 'file', 'filename'\]/);
  assert.match(js, /toolName\?\.includes\('grep'\)/);
  assert.match(js, /data-tool-action/);
  assert.match(js, /display\.action \|\| node\.dataset\.toolAction/);
  assert.match(js, /node\.querySelector\('\[data-tool-action\]'\)\.textContent = \['tool', 'workflow'\]\.includes\(kind\) \? action : ''/);
  assert.match(js, /function toolSummaryPillsHtml/);
  assert.match(js, /return \['Working', action\]/);
  assert.match(css, /\.tool-target/);
});

test('thread trace tools render assistant-ui style typed bodies', () => {
  assert.match(js, /function toolUiKind/);
  assert.match(js, /function renderToolDetailHtml/);
  assert.match(js, /data-tool-kind/);
  assert.match(js, /const TRACE_ICON_PATHS =/);
  assert.match(js, /function traceIconHtml/);
  assert.match(js, /node\.querySelector\('\.tool-kind-mark'\)\.innerHTML = traceIconHtml\(kind\)/);
  assert.match(js, /traceIconHtml\('complete'\)/);
  assert.match(js, /tool-summary-pills/);
  assert.match(js, /tool-diff-viewer/);
  assert.match(js, /tool-terminal/);
  assert.match(js, /tool-search-results/);
  assert.match(js, /tool-json-grid/);
  assert.match(js, /shouldOpenToolCard\(kind, state, detailHtml\)/);
  assert.match(js, /const toolEventSnapshots = new Map\(\)/);
  assert.match(js, /function mergeToolEvent/);
  assert.match(js, /traceTimeline\.append\(article\)/);
  assert.match(js, /if \(event\.phase === 'update'\)/);
  assert.match(js, /if \(event\.phase === 'end'\)/);
  assert.doesNotMatch(js, /function ensureTraceToolGroup/);
  assert.match(js, /function settleTraceRun/);
  assert.match(js, /event\.done \|\| event\.runStatus === 'completed' \|\| event\.runStatus === 'failed'\) \{\n\s*settleTraceRun\(event\)/);
  assert.match(css, /body\.thread-page \.trace-tool-card/);
  assert.match(css, /\.tool-kind-mark/);
  assert.match(css, /\.trace-tool-card\[data-tool-kind="search"\] \.tool-kind-mark/);
  assert.match(css, /\.trace-tool-card\[data-tool-kind\] \.tool-kind-mark::before \{[\s\S]*content: none/);
  assert.doesNotMatch(css, /body\.thread-page \.trace-tool-card \.tool-kind-mark \{\s*display: none/);
  assert.match(css, /The live trace is a chronological transcript/);
  assert.match(css, /\.tool-diff-viewer/);
  assert.match(css, /\.tool-terminal/);
  assert.match(css, /\.tool-search-result-card/);
  assert.match(css, /\.tool-json-grid/);
});

test('thread keeps the global inbox open', () => {
  assert.match(pages, /function GlobalAppShell\(\{ children, sidebarWorkspaceSwitcher = true, sidebarDefaultOpen = true/);
  assert.match(pages, /<GlobalAppShell sidebarWorkspaceSwitcher=\{false\} insetClassName="global-app-center">/);
  assert.doesNotMatch(pages, /<GlobalAppShell sidebarWorkspaceSwitcher=\{false\} sidebarDefaultOpen=\{false\} insetClassName="global-app-center">/);
  assert.match(css, /body\.thread-page \.thread-stage \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 382px/);
  assert.match(css, /body\.thread-page \.conversation-main > \.timeline-flow,[\s\S]*width: min\(100%, 1060px\)/);
  assert.match(css, /body\.thread-page \.agent-column \{[\s\S]*max-height: 100svh/);
  assert.match(css, /@media \(max-width: 1040px\)/);
});

test('assistant card waits for output instead of showing a working placeholder', () => {
  assert.match(js, /function appendMessage\(role, label, text = '', images = \[\], options = \{\}\)/);
  assert.match(js, /function ensureAssistantBody\(\) \{\s*if \(!activeAssistantBody\) activeAssistantBody = appendMessage\('assistant', 'main agent'\);/);
  assert.match(js, /appendStreamingMessageText\(ensureAssistantBody\(\), text\)/);
  assert.match(js, /if \(!String\(text \|\| ''\)\.trim\(\)\) return;/);
  assert.match(js, /const renderedMessageKeys = new Set\(\)/);
  assert.match(js, /renderThreadHistory\(event\.session\)/);
  assert.match(js, /renderMessageBody\(activeAssistantBody, message\.text, true\)/);
  assert.doesNotMatch(js, /is-pending/);
  assert.doesNotMatch(js, /pending: true/);
  assert.doesNotMatch(js, /main agent is working/);
  assert.doesNotMatch(css, /\.message-item\.assistant\.is-pending/);
  assert.doesNotMatch(css, /content: 'working…'/);
});

test('follow-up responses and reopened active runs hydrate message history', () => {
  assert.match(js, /async function loadThread\(\)[\s\S]+renderThreadHistory\(payload\.thread\);\s*renderInitialPrompt\(payload\.thread\);/);
  assert.match(js, /const payload = await fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/messages`, \{/);
  assert.match(js, /const returnedThread = payload\.thread \|\| payload\.session/);
  assert.match(js, /if \(returnedThread\) \{\s*renderThread\(returnedThread\);\s*renderThreadHistory\(returnedThread\);\s*\}/);
  assert.doesNotMatch(js, /isLatestRun && !assistant && isActiveStatus\(effectiveStatus\(thread\)\) && !activeAssistantBody/);
  assert.doesNotMatch(js, /appendMessage\('assistant', 'main agent', '', \{ pending: true \}\)/);
});

test('running thread composer labels steer and follow-up delivery', () => {
  assert.match(pages, /id="composer-hint"/);
  assert.match(css, /\.composer-hint/);
  assert.match(js, /Enter steers as soon as live · Alt\+Enter queues a follow-up/);
  assert.match(js, /function canSendActiveDelivery/);
  assert.match(js, /nextSubmitDelivery = 'followUp'/);
  assert.match(js, /const delivery = nextSubmitDelivery === 'followUp' \? 'followUp' : canSendActiveDelivery\(\) \? 'steer' : 'auto'/);
  assert.match(js, /delivery,\s*submittedAtMs/);
  assert.match(js, /const sendButtonIcon = sendButton\?\.querySelector\('svg'\)\?\.cloneNode\(true\) \|\| null/);
  assert.match(js, /sendButton\.setAttribute\('aria-label', label\)/);
  assert.match(js, /if \(!activeDelivery\) activeRunSummaryMarker = appendRunSummaryMarker/);
  assert.match(js, /event\.type === 'queue'\) updateQueueState\(event\)/);
});

test('thread timeline clears the sticky composer', () => {
  assert.match(js, /function syncComposerClearance\(\)/);
  assert.match(js, /--thread-composer-clearance/);
  assert.match(js, /getBoundingClientRect\(\)\.height \+ bottom \+ 18/);
  assert.match(js, /ResizeObserver/);
  assert.match(css, /\.conversation-main \.timeline-flow \{ padding-bottom: max\(126px, var\(--thread-composer-clearance, 220px\)\); \}/);
  assert.doesNotMatch(threadHtml, /styles\.css\?v=/);
  assert.match(threadHtml, /src="\/src\/entry\.jsx"/);
});

test('thread messages render stored image attachments', () => {
  assert.match(js, /imageAttachmentSrc/);
  assert.match(js, /function renderMessageAttachments/);
  assert.match(js, /appendMessage\('user', 'you', message\.text, message\.images, \{ runId \}\)/);
  assert.match(js, /appendMessage\('user', 'you', imageAttachmentText\(prompt, images\.length\), images\)/);
  assert.match(css, /\.message-attachments/);
  assert.match(css, /\.message-attachment-image/);
});

test('html assistant messages still render mentioned image artifacts', () => {
  assert.match(js, /htmlImageArtifactPaths/);
  assert.match(js, /renderExcalidrawArtifacts\(node, raw, \{ skipImagePaths: htmlImageArtifactPaths\(displayText\) \}\)/);
  assert.doesNotMatch(js, /renderExcalidrawArtifacts\(node, raw, \{ includeImages: false \}\)/);
});

test('generated html artifacts render in opt-in trusted iframes', () => {
  const block = js.slice(js.indexOf('const HTML_ARTIFACT_PASSIVE_SANDBOX'), js.indexOf('function renderHtmlArtifacts'));
  assert.notEqual(block, '');
  assert.match(artifactUtils, /HTML_ARTIFACT_TOKEN_RE/);
  assert.match(artifactUtils, /implementation-notes\\\//);
  assert.match(artifactUtils, /export function htmlArtifactPaths/);
  assert.match(artifactUtils, /export function isRenderableHtmlArtifactPath/);
  assert.match(js, /htmlArtifactPaths/);
  assert.match(js, /function htmlArtifactUrl\(artifactPath, options = \{\}\)/);
  assert.match(js, /function htmlArtifactStateUrl\(artifactPath, stateKey = 'default'\)/);
  assert.match(block, /HTML_ARTIFACT_PASSIVE_SANDBOX = ''/);
  assert.match(block, /HTML_ARTIFACT_INTERACTIVE_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals'/);
  assert.match(block, /frame\.dataset\.artifactPath = artifactPath/);
  assert.match(block, /htmlArtifactUrl\(artifactPath, \{ interactive \}\)/);
  assert.match(block, /htmlArtifactUrl\(artifactPath, \{ interactive: true \}\)/);
  assert.match(block, /interact\.addEventListener\('click'/);
  assert.match(block, /focusHtmlArtifactFrame/);
  assert.doesNotMatch(block, /allow-same-origin/);
  assert.match(js, /window\.addEventListener\('message', handleHtmlArtifactStateMessage\)/);
  assert.match(js, /spanner:artifact-state:save/);
  assert.match(js, /spanner:artifact-state:load/);
  assert.match(js, /spanner:artifact-state:saved/);
  assert.match(js, /renderHtmlArtifacts\(node, raw\)/);
  assert.match(css, /\.html-artifact-frame/);
  assert.match(css, /\.html-artifact-interact/);
  assert.match(routes, /artifacts\\\/html/);
  assert.match(routes, /artifacts\\\/state/);
  assert.match(routes, /saveThreadHtmlArtifactStatePayload/);
  assert.match(routes, /function htmlArtifactCsp/);
  assert.match(routes, /function htmlArtifactData/);
  assert.match(routes, /data-spanner-interaction-shim/);
  assert.match(routes, /script-src 'none'; sandbox/);
  assert.match(routes, /sandbox allow-scripts allow-forms allow-pointer-lock/);
  assert.doesNotMatch(routes, /allow-same-origin/);
  assert.match(threadService, /function safeHtmlArtifactPath/);
  assert.match(threadService, /function safeArtifactStateKey/);
  assert.match(threadService, /threadHtmlArtifactPayload/);
  assert.match(threadService, /threadHtmlArtifactStatePayload/);
});

test('openui assistant messages still scan raw text for media artifacts', () => {
  assert.match(js, /const displayText = allowHtml \? stripOpenUIArtifactBlocks\(stripInteractiveArtifactBlocks\(raw\)\) : raw;/);
  assert.match(js, /renderLinkedText\(node, displayText\);\n\s*renderMessageAttachments\(node, images\);\n\s*renderExcalidrawArtifacts\(node, raw\);/);
  assert.match(js, /renderExcalidrawArtifacts\(node, raw, \{ skipImagePaths: htmlImageArtifactPaths\(displayText\) \}\);/);
});

test('assistant text links render and OpenUI URL actions open externally', () => {
  assert.match(js, /import \{ openSafeLink, renderLinkedText \} from '\.\/link-rendering\.js'/);
  assert.match(js, /renderLinkedText\(node, displayText\)/);
  assert.match(js, /a\.rendered-link/);
  assert.match(js, /function localHtmlArtifactPathFromHref/);
  assert.match(js, /link\.dataset\.linkKind === 'local'/);
  assert.match(js, /location\.assign\(htmlArtifactUrl\(artifactPath, \{ interactive: true \}\)\)/);
  assert.match(js, /void openSafeLink\(link\.getAttribute\('href'\)\)/);
  assert.match(css, /\.message-body a\.rendered-link/);
  assert.match(css, /\.message-body a\.rendered-link\[data-link-kind="local"\]/);
  assert.match(openuiRenderer, /event\?\.type === 'open_url'/);
  assert.match(openuiRenderer, /void openSafeLink\(event\.params\?\.url\)/);
});

test('implementation note rail is shown when notes exist', () => {
  assert.match(js, /notesList\.closest\('\.notes-main'\)\?\.toggleAttribute\('hidden', !notes\.length\)/);
  assert.doesNotMatch(js, /temporary kill switch/);
});

test('openui fenced blocks render after assistant message text without extra chrome', () => {
  assert.match(js, /stripOpenUIArtifactBlocks\(stripInteractiveArtifactBlocks\(raw\)\)/);
  assert.match(js, /classList\.toggle\('openui-rendered'/);
  assert.match(js, /renderOpenUIArtifactsLazy\(node, raw, fillComposerFromInteractiveAction\)/);
  assert.match(js, /await import\('\.\/openui-renderer\.jsx'\)/);
  assert.match(css, /\.message-card\.openui-rendered \{ width: 100%; max-width: 100%;/);
  assert.match(css, /\.openui-artifacts/);
  assert.match(css, /\.openui-artifact-rendered \* \{ font-family: var\(--sans\) !important; \}/);
  assert.match(css, /\.openui-artifact-card/);
  assert.match(css, /\.openui-artifact-rendered > \.openui-card\.openui-card-card/);
  assert.match(css, /\.openui-artifact-rendered \.openui-table-head,\n\.openui-artifact-rendered \.openui-table-cell \{ white-space: normal;/);
  assert.doesNotMatch(css, /\.openui-artifact-head/);
});

test('opening a populated thread scrolls back to the latest user turn', () => {
  assert.match(js, /function isTerminalStatus\(status\)/);
  assert.match(js, /function restoreInitialThreadPosition\(\) \{\n\s*if \(!timeline\) return;\n\s*requestAnimationFrame\(\(\) => \{\n\s*const userMessages = timeline\.querySelectorAll\('\.message-item\.user'\)/);
  assert.doesNotMatch(js, /initialResumeScrollDone/);
  assert.match(js, /const hasAssistantTurn = Boolean\(timeline\.querySelector\('\.message-item\.assistant'\)\)/);
  assert.match(js, /const hasTerminalSinglePrompt = userMessages\.length === 1 && isTerminalStatus\(effectiveStatus\(currentThread\)\)/);
  assert.match(js, /!hasAssistantTurn && userMessages\.length < 2 && !hasTerminalSinglePrompt/);
  assert.match(js, /target\.getBoundingClientRect\(\)\.top \+ window\.scrollY - offset/);
  assert.match(js, /const \{ thread, output \} = await loadThreadBootstrap\(\);\n\s*restoreInitialThreadPosition\(\);/);
  assert.match(js, /if \(output\.deferred\) \{\n\s*void loadOutput\(\)\n\s*\.then\(\(\) => restoreInitialThreadPosition\(\)\)/);
});

test('final turn status colors the matching assistant message', () => {
  assert.match(js, /function finalTurnStatus\(thread = currentThread\)/);
  assert.match(js, /function applyThreadTurnStatus\(thread = currentThread\)/);
  assert.match(js, /item\.dataset\.runId === turn\.runId/);
  assert.match(js, /event\.type === 'title' \|\| event\.type === 'answer_summary' \|\| event\.type === 'turn_status' \|\| event\.type === 'suggested_next_steps'/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="green"\] \.timeline-dot/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="amber"\] \.timeline-dot/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="gray"\] \.timeline-dot/);
});

test('suggested next steps render as bottom composer prompts', () => {
  assert.match(pages, /id="suggested-next-steps"/);
  assert.match(pages, /id="suggested-next-steps-list"/);
  assert.match(pages, /className="next-steps-main launch-suggestions"/);
  assert.match(js, /function renderSuggestedNextSteps\(thread = currentThread\)/);
  assert.match(js, /data-next-step-prompt="\$\{escapeHtml\(step\.prompt\)\}"/);
  assert.match(js, /fillComposerFromInteractiveAction\(\{ prompt: button\.dataset\.nextStepPrompt \|\| '' \}\)/);
  assert.match(css, /\.next-steps-main/);
  assert.match(css, /\.next-step-btn/);
});

test('inline trace uses a subtle marker without overlay behavior', () => {
  assert.match(css, /\.run-summary::before/);
  assert.match(css, /body\.thread-page \.run-summary::before \{[\s\S]*content: '▸'/);
  assert.doesNotMatch(css, /body\.thread-page \.run-summary::before \{\s*content: none;\s*display: none;/);
  assert.match(css, /\.run-summary-detail/);
  assert.match(css, /\.agent-trace-inline/);
  assert.doesNotMatch(css, /agent-overlay-open/);
  assert.doesNotMatch(pages, /agent-trace-drawer/);
  assert.doesNotMatch(js, /closeAgentActivityOnOutsideClick/);
  assert.doesNotMatch(js, /document\.addEventListener\('click', closeAgentActivityOnOutsideClick/);
  assert.match(js, /agentActivityClose\?\.addEventListener\('click', \(\) => setAgentActivityOpen\(false\)\)/);
  assert.match(js, /if \(event\.key === 'Escape' && isAgentActivityOpen\(\)\) setAgentActivityOpen\(false\)/);
});

test('thread page uses the cheap desktop scroll path', () => {
  assert.match(threadHtml, /<body class="thread-page" data-react-page="thread">/);
  assert.match(css, /body\.thread-page[\s\S]+background-image: none/);
  assert.match(js, /document\.querySelector\('\.thread-main-header'\)/);
  assert.match(css, /content-visibility: auto/);
  assert.match(js, /function queueAssistantChunk/);
  assert.match(js, /requestAnimationFrame\(flushAssistantChunks\)/);
  assert.match(js, /function finalizeAssistantBody/);
  assert.doesNotMatch(js, /behavior = .*smooth/);
});
