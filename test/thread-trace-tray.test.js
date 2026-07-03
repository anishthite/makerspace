import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const threadHtml = readFileSync(new URL('../frontend/thread.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/styles.css', import.meta.url), 'utf8');

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

test('workflow trace shows thinking steps and answer summaries', () => {
  assert.match(pages, /<span>workflow trace<\/span><strong>events<\/strong>/);
  assert.match(js, /const thinkingCards = new Map\(\)/);
  assert.match(js, /function renderTimelineThinkingEvent/);
  assert.match(js, /thinking steps/);
  assert.match(js, /function renderTimelineSummaryEvent/);
  assert.match(js, /event\.type === 'answer_summary' && isNewEvent/);
  assert.match(js, /renderTimelineThinkingEvent\(event\)/);
  assert.match(css, /\.thinking-card/);
  assert.doesNotMatch(js, /formatTime/);
  assert.doesNotMatch(js, /data-thinking-time/);
});

test('workflow rail renders workflow agents, not generic tool calls', () => {
  assert.match(pages, /aria-label="Workflow agent trace"/);
  assert.match(pages, /<span>workflow agents<\/span><strong id="agent-graph-count">idle<\/strong>/);
  assert.match(pages, /click for full workflow trace/);
  assert.match(js, /const workflowRuns = new Map\(\)/);
  assert.match(js, /function renderWorkflowRun/);
  assert.match(js, /function workflowAgentDetail/);
  assert.match(js, /workflow-agent-detail/);
  assert.match(js, /workflow-agent-stack/);
  assert.match(js, /workflow agents appear here when a workflow starts/);
  assert.match(js, /\/workflows\/\$\{encodeURIComponent\(runId\)\}/);
  assert.doesNotMatch(js, /const processHtml = graphItems\.map/);
  assert.doesNotMatch(js, /item\.kind \|\| 'tool'/);
  assert.doesNotMatch(js, /workflow trace · click to expand/);
});

test('tool rows show one-line action copy with the target path or search scope', () => {
  assert.match(js, /function toolTarget/);
  assert.match(js, /function toolAction/);
  assert.match(js, /\['path', 'file_path', 'file', 'filename'\]/);
  assert.match(js, /toolName\?\.includes\('grep'\)/);
  assert.match(js, /data-tool-action/);
  assert.match(js, /display\.action \|\| node\.dataset\.toolAction/);
  assert.match(js, /node\.querySelector\('\[data-tool-action\]'\)\.textContent = action/);
  assert.match(js, /return \['Working', action\]/);
  assert.match(css, /\.tool-target/);
});

test('assistant card waits for output instead of showing a working placeholder', () => {
  assert.match(js, /function appendMessage\(role, label, text = '', images = \[\], options = \{\}\)/);
  assert.match(js, /function ensureAssistantBody\(\) \{\s*if \(!activeAssistantBody\) activeAssistantBody = appendMessage\('assistant', 'main agent'\);/);
  assert.match(js, /appendStreamingMessageText\(ensureAssistantBody\(\), text\)/);
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
  assert.match(js, /Enter steers the running agent · Alt\+Enter queues a follow-up/);
  assert.match(js, /nextSubmitDelivery = 'followUp'/);
  assert.match(js, /const delivery = nextSubmitDelivery === 'followUp' \? 'followUp' : isRunningThread\(\) \? 'steer' : 'auto'/);
  assert.match(js, /delivery,\s*submittedAtMs/);
  assert.match(js, /if \(!activeDelivery\) activeRunSummaryMarker = appendRunSummaryMarker/);
  assert.match(js, /event\.type === 'queue'\) updateQueueState\(event\)/);
});

test('thread messages render stored image attachments', () => {
  assert.match(js, /imageAttachmentSrc/);
  assert.match(js, /function renderMessageAttachments/);
  assert.match(js, /appendMessage\('user', 'you', message\.text, message\.images, \{ runId \}\)/);
  assert.match(js, /appendMessage\('user', 'you', imageAttachmentText\(prompt, images\.length\), images\)/);
  assert.match(css, /\.message-attachments/);
  assert.match(css, /\.message-attachment-image/);
});

test('opening a populated thread scrolls back to the latest user turn', () => {
  assert.match(js, /let initialResumeScrollDone = false/);
  assert.match(js, /function restoreInitialThreadPosition\(\)/);
  assert.match(js, /timeline\.querySelectorAll\('\.message-item\.user'\)/);
  assert.match(js, /timeline\.querySelector\('\.message-item\.assistant'\)/);
  assert.match(js, /target\.getBoundingClientRect\(\)\.top \+ window\.scrollY - offset/);
  assert.match(js, /const output = await loadOutput\(\);\n\s*restoreInitialThreadPosition\(\);/);
});

test('final turn status colors the matching assistant message', () => {
  assert.match(js, /function finalTurnStatus\(thread = currentThread\)/);
  assert.match(js, /function applyThreadTurnStatus\(thread = currentThread\)/);
  assert.match(js, /item\.dataset\.runId === turn\.runId/);
  assert.match(js, /event\.type === 'title' \|\| event\.type === 'answer_summary' \|\| event\.type === 'turn_status'/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="green"\] \.timeline-dot/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="amber"\] \.timeline-dot/);
  assert.match(css, /\.message-item\.assistant\[data-turn-color="gray"\] \.timeline-dot/);
});

test('inline trace uses a subtle marker without overlay behavior', () => {
  assert.match(css, /\.run-summary::before/);
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
  assert.match(css, /\.thread-page \.flow-topbar \{ backdrop-filter: none; \}/);
  assert.match(css, /content-visibility: auto/);
  assert.match(js, /function queueAssistantChunk/);
  assert.match(js, /requestAnimationFrame\(flushAssistantChunks\)/);
  assert.match(js, /function finalizeAssistantBody/);
  assert.doesNotMatch(js, /behavior = .*smooth/);
});
