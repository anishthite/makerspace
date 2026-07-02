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

test('agent trace shows thinking steps and answer summaries', () => {
  assert.match(pages, /<span>agent trace<\/span><strong>events<\/strong>/);
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
  assert.match(js, /function appendMessage\(role, label, text = '', images = \[\]\)/);
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
  assert.match(js, /if \(payload\.session\) \{\s*renderThread\(payload\.session\);\s*renderThreadHistory\(payload\.session\);\s*\}\s*streamRun\(\);/);
  assert.doesNotMatch(js, /isLatestRun && !assistant && isActiveStatus\(effectiveStatus\(thread\)\) && !activeAssistantBody/);
  assert.doesNotMatch(js, /appendMessage\('assistant', 'main agent', '', \{ pending: true \}\)/);
});

test('thread messages render stored image attachments', () => {
  assert.match(js, /imageAttachmentSrc/);
  assert.match(js, /function renderMessageAttachments/);
  assert.match(js, /appendMessage\('user', 'you', message\.text, message\.images\)/);
  assert.match(js, /appendMessage\('user', 'you', imageAttachmentText\(prompt, images\.length\), images\)/);
  assert.match(css, /\.message-attachments/);
  assert.match(css, /\.message-attachment-image/);
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
