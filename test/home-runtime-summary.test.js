import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const agentSidebar = readFileSync(new URL('../frontend/src/components/agent-sidebar.jsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../frontend/src/entry.jsx', import.meta.url), 'utf8');
const authRedirect = readFileSync(new URL('../frontend/src/runtime/auth-redirect.js', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/app.js', import.meta.url), 'utf8');
const projectRuntime = readFileSync(new URL('../frontend/src/runtime/project.js', import.meta.url), 'utf8');
const threadRuntime = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');
const globalSidebarRuntime = readFileSync(new URL('../frontend/src/runtime/global-sidebar.js', import.meta.url), 'utf8');
const projectIconsRuntime = readFileSync(new URL('../frontend/src/runtime/project-icons.js', import.meta.url), 'utf8');
const sidebarPromptRuntime = readFileSync(new URL('../frontend/src/runtime/sidebar-prompt-lightbox.js', import.meta.url), 'utf8');
const agentToasts = readFileSync(new URL('../frontend/src/runtime/agent-toasts.js', import.meta.url), 'utf8');
const completionChimes = readFileSync(new URL('../frontend/src/runtime/completion-chimes.js', import.meta.url), 'utf8');
const chimePreview = readFileSync(new URL('../frontend/src/runtime/chime-preview.js', import.meta.url), 'utf8');
const chimeHtml = readFileSync(new URL('../frontend/chimes.html', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../frontend/src/components/ui/sidebar.jsx', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../frontend/src/components/ui.jsx', import.meta.url), 'utf8');
const appCss = [
  readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../frontend/src/styles/workspace.css', import.meta.url), 'utf8'),
].join('\n');
const fluidCss = readFileSync(new URL('../frontend/src/styles/fluid-ui.css', import.meta.url), 'utf8');
const runState = readFileSync(new URL('../src/server/run-state.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/server/routes.js', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/server/threads.js', import.meta.url), 'utf8');

test('unsigned hosted users go to the landing route from API auth failures', () => {
  assert.doesNotMatch(entry, /\/api\/me/);
  assert.match(authRedirect, /const HOMEPAGE_PATH = '\/landing';/);
  assert.match(authRedirect, /payload\?\.authRequired/);
  assert.match(authRedirect, /Number\(response\?\.status\) !== 401/);
  assert.match(authRedirect, /location\.replace\(homepageRedirectUrl\(\)\)/);
});

test('workspace and thread suggestions use separate LLM generators', () => {
  const nextStepsStart = runState.indexOf('function scheduleSuggestedNextStepsGeneration');
  const nextStepsEnd = runState.indexOf('  function cleanWorkspaceSuggestionValue', nextStepsStart);
  const nextStepsBlock = runState.slice(nextStepsStart, nextStepsEnd);
  const workspaceStart = runState.indexOf('async function generateWorkspaceLaunchSuggestionsForThreads');
  const workspaceEnd = runState.indexOf('  async function persistThreadAssistantMessage', workspaceStart);
  const workspaceBlock = runState.slice(workspaceStart, workspaceEnd);

  assert.ok(nextStepsStart >= 0 && nextStepsEnd > nextStepsStart);
  assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart);
  assert.match(nextStepsBlock, /generateSuggestedNextSteps\(current, latestAssistantTurn/);
  assert.doesNotMatch(nextStepsBlock, /generateWorkspaceLaunchSuggestions/);
  assert.match(workspaceBlock, /generateWorkspaceLaunchSuggestions\(source/);
  assert.doesNotMatch(workspaceBlock, /generateSuggestedNextSteps/);
});

test('home agents header omits aggregate status line', () => {
  assert.match(pages, /export function WorkspacePage\(\)/);
  assert.doesNotMatch(pages, /id="action-summary"/);
  assert.doesNotMatch(js, /function formatRunningTotal/);
  assert.doesNotMatch(js, /recently finished`/);
  assert.doesNotMatch(js, /updateActionSummary\(\);/);
});

test('home running lane only uses active thread statuses', () => {
  assert.match(js, /function effectiveThreadStatus\(thread\)/);
  assert.match(js, /runStatus && runStatus !== 'unknown' \? runStatus : String\(thread\?\.status \|\| ''\)\.toLowerCase\(\)/);
  assert.match(js, /const activeThreads = inboxThreads\.filter\(\(thread\) => !isSettledThread\(thread\)\);/);
});

test('home rows avoid workspace folder details', () => {
  const renderStart = js.indexOf('function renderThreadCard');
  const activeBodyStart = js.indexOf('const activeBody =', renderStart);
  const settledBodyStart = js.indexOf('const settledBody =', activeBodyStart);
  const activeBody = js.slice(activeBodyStart, settledBodyStart);
  assert.ok(renderStart >= 0 && activeBodyStart > renderStart && settledBodyStart > activeBodyStart);
  assert.match(js, /function runningActivity\(thread, rawStatus = effectiveThreadStatus\(thread\)\)/);
  assert.doesNotMatch(activeBody, /thread-activity|sidebar-thread-meta-row|runningActivity/);
  assert.doesNotMatch(js, /repoLabel\(thread\)/);
  assert.match(runState, /function latestRunActivity\(run\)/);
  assert.match(runState, /latestActivity: latestActivity \|\| undefined/);
});

test('sidebar prompt project picker links to the project picker', () => {
  assert.match(sidebarPromptRuntime, /const PICK_NEW_PROJECT_VALUE = '__pick_new_project__';/);
  assert.match(sidebarPromptRuntime, /pick new project\.\.\./);
  assert.match(sidebarPromptRuntime, /location\.href = '\/';/);
  assert.match(sidebarPromptRuntime, /projectSelect\.disabled = false;/);
  assert.match(pages, /<strong>Pick new project<\/strong><small>Open or add a workspace<\/small>/);
});

test('workspace agents use shadcn sidebar beside launch composer', () => {
  const workspaceStart = pages.indexOf('export function WorkspacePage()');
  const workspaceEnd = pages.indexOf('export function ThreadPage()', workspaceStart);
  const workspaceBlock = pages.slice(workspaceStart, workspaceEnd);
  const shellIndex = workspaceBlock.indexOf('<GlobalAppShell');
  const formIndex = workspaceBlock.indexOf('id="thread-form"');
  const suggestionsIndex = workspaceBlock.indexOf('id="launch-suggestions"');
  assert.ok(shellIndex > -1 && shellIndex < formIndex && formIndex < suggestionsIndex);
  assert.match(pages, /import \{ GlobalAppShell \} from '\.\/components\/agent-sidebar\.jsx';/);
  assert.match(agentSidebar, /SidebarProvider[\s\S]+from '\.\/ui\/sidebar\.jsx';/);
  assert.match(agentSidebar, /export function GlobalAppShell\(\{ children, sidebarDefaultOpen = true, insetClassName = '' \}\)/);
  assert.match(agentSidebar, /<Sidebar className="workspace-global-sidebar border-r border-\[var\(--rule\)\]" collapsible="offcanvas">/);
  assert.doesNotMatch(agentSidebar, /SidebarRail/);
  assert.match(agentSidebar, /<SidebarInset className=\{cn\('global-app-inset min-w-0 bg-\[var\(--bg\)\]', insetClassName\)\}>/);
  assert.doesNotMatch(pages, /sidebar-collapse-button/);
  assert.match(pages, /workspace-mobile-sidebar-launcher/);
  assert.match(pages, /<SidebarTrigger className="workspace-sidebar-trigger" aria-label="open agents"/);
  assert.match(sidebar, /const SIDEBAR_WIDTH_MOBILE = "min\(28rem, calc\(100vw - 0\.75rem\)\)"/);
  assert.match(sidebar, /className="spanner-sidebar-mobile-sheet w-\(--sidebar-width\) max-w-none/);
  assert.match(fluidCss, /\.spanner-sidebar-mobile-sheet\[data-mobile="true"\] \{[\s\S]+z-index: 60;[\s\S]+width: var\(--sidebar-width\);[\s\S]+background: var\(--t3-sidebar, #181818\);/);
  assert.match(fluidCss, /\.spanner-sidebar-mobile-sheet\[data-mobile="true"\] \.agent-search,[\s\S]+width: 100%;/);
  assert.match(fluidCss, /\.spanner-sidebar-desktop-shell,\n\.spanner-sidebar-desktop-container \{\n  display: none;/);
  assert.match(fluidCss, /@media \(min-width: 768px\) \{[\s\S]+\.spanner-sidebar-desktop-shell \{\n    display: block;/);
  assert.match(fluidCss, /\.workspace-mobile-sidebar-launcher \{\n    display: none;/);
  assert.doesNotMatch(appCss, /\.spanner-sidebar-desktop-shell\[data-collapsible="icon"\] \.workspace-agents-sidebar/);
  assert.match(pages, /data-suggested-prompt="Read the README, package files/);
  assert.match(pages, /<strong[^>]*>Make repo diagram<\/strong>/);
  assert.match(pages, /<strong[^>]*>Run health check<\/strong>/);
  assert.match(pages, /<strong[^>]*>Find first task<\/strong>/);
  assert.doesNotMatch(pages, /Find paper cuts/);
  assert.match(js, /const launchSuggestions = document\.querySelector\('#launch-suggestions'\);/);
  assert.match(agentSidebar, /aria-label="Agent inbox"/);
  assert.match(agentSidebar, /MagnifyingGlassIcon/);
  assert.match(agentSidebar, /className="sidebar-title-row"/);
  assert.match(agentSidebar, /className="sidebar-spanner-title"/);
  assert.match(agentSidebar, />Spanner<\/a>/);
  assert.match(agentSidebar, /className="sidebar-command-row"/);
  assert.doesNotMatch(agentSidebar, /className="sidebar-scope-row"/);
  assert.match(agentSidebar, /id="sidebar-project-scope"/);
  assert.match(agentSidebar, /<FunnelIcon className="size-4 shrink-0" aria-hidden="true" \/>/);
  assert.doesNotMatch(agentSidebar, /<WrenchIcon className="size-4 shrink-0" aria-hidden="true" \/>/);
  assert.match(agentSidebar, /className="sidebar-project-scope sidebar-search-filter"/);
  assert.match(agentSidebar, /id="sidebar-project-scope-menu"/);
  assert.match(agentSidebar, /aria-label="New worktree"/);
  assert.doesNotMatch(agentSidebar, /aria-label="New project"/);
  assert.match(agentSidebar, /className="agent-search border-0 bg-transparent px-0 shadow-none \[&_input\]:min-w-0 \[&_input\]:py-1\.5"/);
  assert.match(agentSidebar, /<input id="agent-search" type="search" placeholder="Search agents"/);
  assert.match(agentSidebar, /id="sidebar-prompt-lightbox" className="sidebar-prompt-lightbox"/);
  assert.match(agentSidebar, /id="sidebar-prompt-form" className="sidebar-prompt-lightbox-shell" noValidate/);
  assert.match(agentSidebar, /className="sidebar-prompt-topbar"/);
  const sidebarPromptMarkup = agentSidebar.slice(agentSidebar.indexOf('export function SidebarPromptLightbox()'), agentSidebar.indexOf('\nexport function GlobalAppShell'));
  assert.match(sidebarPromptMarkup, /<FolderOpenIcon className="sidebar-prompt-project-icon size-4" weight="duotone" aria-hidden="true" \/>/);
  assert.doesNotMatch(sidebarPromptMarkup, /<span>project<\/span>/);
  assert.match(agentSidebar, /<Select id="sidebar-prompt-project-select" variant="prompt" aria-label="Project for new agent" placeholder="loading projects\.\.\.">/);
  assert.match(ui, /export function Select\(/);
  assert.match(ui, /MutationObserver/);
  assert.match(agentSidebar, /placeholder="Tell the main agent what to do\.\.\."/);
  assert.match(agentSidebar, /aria-keyshortcuts="Enter"/);
  assert.match(agentSidebar, /id="sidebar-prompt-images-trigger" variant="ghost" size="sm" className="attach-btn" type="button"/);
  assert.match(agentSidebar, /id="sidebar-prompt-images" className="image-input"/);
  assert.match(agentSidebar, /<Select id="sidebar-model-ref" name="modelRef" variant="prompt" aria-label="Model for new agent" placeholder="loading model…">/);
  assert.doesNotMatch(ui, /export function ModelPicker\(/);
  assert.match(ui, /<ShadSelect value=\{picker\.value\}/);
  assert.match(ui, /setPortalContainer\(select\.closest\('dialog'\)\);/);
  assert.match(ui, /<ShadSelectContent container=\{portalContainer\}/);
  assert.doesNotMatch(sidebarPromptRuntime, /spanner:model-picker/);
  assert.doesNotMatch(sidebarPromptMarkup, /InputGroup label="model" className="model-picker sidebar-prompt-model/);
  assert.match(agentSidebar, /<Select id="sidebar-thinking-level" name="thinkingLevel" defaultValue="xhigh" variant="prompt" aria-label="Thinking level" placeholder="xhigh"><option value="off">off<\/option>/);
  assert.match(agentSidebar, /id="sidebar-prompt-submit" variant="primary" className="sidebar-prompt-start" type="submit" aria-label="send prompt"><ArrowUpIcon className="size-4" weight="bold" aria-hidden="true" \/><\/Button>/);
  assert.match(pages, /id="thread-submit" variant="primary" className="sidebar-prompt-start" type="submit" aria-label="send prompt"><ArrowUpIcon className="size-4" weight="bold" aria-hidden="true" \/><\/Button>/);
  assert.doesNotMatch(sidebarPromptMarkup, /sidebar-prompt-suggestions|data-sidebar-suggested-prompt|Full workspace audit/);
  assert.doesNotMatch(sidebarPromptRuntime, /sidebar-prompt-suggestions|data-sidebar-suggested-prompt/);
  assert.doesNotMatch(appCss, /#sidebar-prompt-suggestions/);
  assert.match(appCss, /\.sidebar-prompt-project-picker > \.sidebar-prompt-project-icon \{ color: rgba\(255, 255, 255, \.78\); \}/);
  assert.match(appCss, /\.sidebar-prompt-project-picker \{[\s\S]*grid-template-columns: auto minmax\(0, max-content\) auto;/);
  assert.match(appCss, /@media \(max-width: 640px\) \{[\s\S]*\.sidebar-prompt-model \{ grid-column: 2; min-width: 0; \}/);
  assert.match(js, /const agentSearchInput = document\.querySelector\('#agent-search'\);/);
  assert.match(js, /bindSidebarPromptLightbox\(\{ fetchJson, makeThreadUrl: threadUrl \}\);/);
  assert.match(js, /function focusWorkspacePrompt\(\) \{[\s\S]*promptInput\?\.focus\(\);[\s\S]*\}/);
  assert.match(js, /if \(location\.hash === '#prompt'\) setTimeout\(focusWorkspacePrompt, 0\);/);
  assert.match(sidebarPromptRuntime, /export function openSidebarPromptLightbox\(projectOverride = null\)/);
  assert.match(sidebarPromptRuntime, /runtimeFetchJson\('\/api\/threads'/);
  assert.match(sidebarPromptRuntime, /runtimeFetchJson\('\/api\/bootstrap\?page=workspace&fast=1'\)/);
  assert.match(sidebarPromptRuntime, /runtimeFetchJson\('\/api\/recent-projects'\)/);
  assert.match(sidebarPromptRuntime, /let selectedPromptProject = null;/);
  assert.match(sidebarPromptRuntime, /function promptProjectCandidate\(projects = sidebarProjects\)/);
  assert.match(sidebarPromptRuntime, /selectedPromptProject \|\| readSelectedProject\(\) \|\| projects\.find\(\(project\) => project\?\.value\) \|\| null/);
  assert.match(sidebarPromptRuntime, /function renderSidebarProjectOptions\(projects = sidebarProjects\)/);
  assert.match(sidebarPromptRuntime, /selectedPromptProject = Number\.isInteger\(index\) && index >= 0 \? sidebarProjects\[index\] \|\| null : null;/);
  assert.match(sidebarPromptRuntime, /filesToImageAttachments\(imageInputFiles\(imageInput\)\)/);
  assert.match(sidebarPromptRuntime, /bindImageDropZone\(form, images, imageStatus\)/);
  assert.match(sidebarPromptRuntime, /imageTrigger\?\.addEventListener\('click', \(\) => images\?\.click\(\)\)/);
  assert.doesNotMatch(sidebarPromptRuntime, /data-sidebar-suggested-prompt/);
  assert.match(sidebarPromptRuntime, /import \{ submitOnEnter \} from '\.\/submit-on-enter\.js';/);
  assert.match(sidebarPromptRuntime, /submitOnEnter\(prompt, form, submit\)/);
  assert.match(sidebarPromptRuntime, /status\.dataset\.reason = 'empty-prompt'/);
  assert.match(sidebarPromptRuntime, /prompt\?\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(sidebarPromptRuntime, /localStorage\.getItem\(PROJECT_KEY\)/);
  assert.match(sidebarPromptRuntime, /localStorage\.setItem\(PROJECT_KEY, JSON\.stringify\(project\)\)/);
  assert.match(sidebarPromptRuntime, /localStorage\.getItem\(MODEL_REF_KEY\)/);
  assert.match(appCss, /\.sidebar-prompt-control-strip \{/);
  assert.doesNotMatch(appCss, /#sidebar-prompt-suggestions/);
  assert.match(js, /function filterAgentThreads\(threads\)/);
  assert.match(js, /if \(event\.target\?\.matches\?\.\('#agent-search'\)\) \{\s*setSettledVisibleCount\(INITIAL_SETTLED_VISIBLE_COUNT\);\s*renderThreads\(currentWorkspaceThreads, \{ suggestions: false \}\);/);
  assert.match(js, /async function loadWorkspaceLaunchSuggestions\(threads\)/);
  assert.match(js, /function workspaceSuggestionThreadContext\(thread\)/);
  assert.match(js, /fetchJson\('\/api\/workspace-suggestions'/);
  assert.match(js, /loadWorkspaceLaunchSuggestions\(currentWorkspaceThreads\)\.catch\(\(\) => \{\}\);/);
  assert.match(routes, /pathname === '\/api\/workspace-suggestions'/);
  assert.match(runState, /generateWorkspaceLaunchSuggestionsForThreads/);
  assert.doesNotMatch(js, /thread\?\.suggestedNextSteps/);
  assert.match(js, /promptInput\.value = button\.dataset\.suggestedPrompt \|\| '';/);
  assert.match(pages, /id="workspace-project-lightbox-trigger"/);
  assert.match(pages, /function WorkspaceProjectLightbox\(\)/);
  assert.match(pages, /id="workspace-project-lightbox" className="workspace-project-lightbox"/);
  assert.match(pages, /id="workspace-project-lightbox-list" className="workspace-project-lightbox-list"/);
  assert.match(pages, /id="workspace-project-lightbox-images" variant="ghost" type="button"><PlusIcon/);
  assert.match(js, /const workspaceProjectLightboxTrigger = document\.querySelector\('#workspace-project-lightbox-trigger'\);/);
  assert.match(js, /const workspaceProjectLightboxImages = document\.querySelector\('#workspace-project-lightbox-images'\);/);
  assert.match(js, /function renderWorkspaceProjectLightbox\(message = ''\)/);
  assert.match(js, /function selectWorkspaceProject\(project\)/);
  assert.match(js, /data-workspace-lightbox-project-index/);
  assert.match(js, /workspaceProjectLightboxTrigger\?\.addEventListener\('click', \(\) => setWorkspaceProjectLightboxOpen\(true\)\);/);
  assert.match(js, /workspaceProjectLightboxImages\?\.addEventListener\('click', \(\) => imageInput\?\.click\(\)\);/);
  assert.match(appCss, /\.workspace-project-lightbox \{/);
  assert.match(appCss, /\.workspace-project-lightbox-project\[aria-current="page"\]/);
});

test('project home uses the shared global agent inbox sidebar', () => {
  assert.match(agentSidebar, /export function AgentInboxSidebar\(\)/);
  assert.match(agentSidebar, /<AgentInboxSidebar \/>/);
  assert.match(pages, /import \{ GlobalAppShell \} from '\.\/components\/agent-sidebar\.jsx';/);
  assert.match(pages, /return <GlobalAppShell insetClassName=/);
  assert.match(pages, /export function HistoryPage\(\) \{[\s\S]+return <GlobalAppShell insetClassName=/);
  assert.match(pages, /export function SettingsPage\(\) \{\s*return <GlobalAppShell insetClassName=/);
  assert.match(entry, /const sidebarRuntimePages = new Set\(\['settings', 'history', 'performance'\]\);/);
  assert.match(entry, /import\('\.\/runtime\/global-sidebar\.js'\)/);
  assert.match(pages, /<SidebarTrigger className="workspace-sidebar-trigger" aria-label="open agents"/);
  assert.match(projectRuntime, /const agentSearchInput = document\.querySelector\('#agent-search'\);/);
  assert.match(projectRuntime, /bindSidebarPromptLightbox\(\{ fetchJson, makeThreadUrl: threadUrl \}\);/);
  for (const runtime of [projectRuntime, globalSidebarRuntime]) {
    assert.match(runtime, /function openWorkspaceComposer\(\) \{\s*location\.href = '\/workspace\.html#prompt';\s*\}/);
  }
  assert.match(projectRuntime, /let threadsList = document\.querySelector\('#threads-list'\);/);
  assert.ok(projectRuntime.includes("const SIDEBAR_SETTLED_EXPANDED_KEY = 'spannerSidebarSettledExpanded';"));
  assert.ok(projectRuntime.includes("const SIDEBAR_SETTLED_THREADS_KEY = 'spannerSidebarSettledThreads';"));
  assert.ok(projectRuntime.includes("const SIDEBAR_PROJECT_SCOPE_KEY = 'spannerSidebarProjectScope';"));
  assert.match(projectRuntime, /function renderGlobalSidebar\(threads = globalSidebarThreads\)/);
  assert.match(projectRuntime, /function updateProjectScopeMenu\(threads\)/);
  assert.match(projectRuntime, /const scopedThreads = scopedAgentThreads\(globalSidebarThreads\);/);
  assert.match(projectRuntime, /const activeThreads = inboxThreads\.filter\(\(thread\) => !isSettledThread\(thread\)\);/);
  assert.match(projectRuntime, /const settledThreads = inboxThreads\.filter\(isSettledThread\);/);
  assert.match(projectRuntime, /data-settled-show-more/);
  assert.match(projectRuntime, /data-settled-shelf-toggle aria-expanded="\$\{settledShelfExpanded \? 'true' : 'false'\}"/);
  assert.match(projectRuntime, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(stopButton\.dataset\.stopThread\)\}\/stop`, \{ method: 'POST' \}\)/);
  assert.match(projectRuntime, /data-settle-thread="\$\{escapeHtml\(thread\.name\)\}"/);
  assert.match(projectRuntime, /data-unsettle-thread="\$\{escapeHtml\(thread\.name\)\}"/);
  assert.doesNotMatch(projectRuntime, /dataset\.archiveThread/);
  assert.match(projectRuntime, /const SIDEBAR_POLL_INTERVAL_MS = 30000;/);
  assert.match(projectRuntime, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*refreshProjectThreads\(\)\.catch\(\(\) => \{\}\);\s*\}, SIDEBAR_POLL_INTERVAL_MS\);/);
  assert.match(projectRuntime, /let syncedThreadsList = threadsList;/);
  assert.match(projectRuntime, /function syncThreadsListMount\(\)/);
  assert.match(projectRuntime, /renderGlobalSidebar\(globalSidebarThreads\.length \? globalSidebarThreads : cachedGlobalSidebarThreads\(\)\);/);
  assert.match(projectRuntime, /new MutationObserver\(scheduleSyncThreadsListMount\)\.observe\(document\.body, \{ childList: true, subtree: true \}\);/);
});

test('workspace agents header uses Spanner search filter, not a layout review surface', () => {
  const filterButtonStart = agentSidebar.indexOf('<button id="sidebar-project-scope"');
  const filterButtonEnd = agentSidebar.indexOf('</button>', filterButtonStart);
  const filterButton = agentSidebar.slice(filterButtonStart, filterButtonEnd);

  assert.match(pages, /CaretUpIcon/);
  assert.match(pages, /CaretDownIcon/);
  assert.ok(filterButtonStart > -1 && filterButtonEnd > filterButtonStart);
  assert.doesNotMatch(filterButton, /CaretDownIcon/);
  assert.doesNotMatch(agentSidebar, />return home<\/a>/);
  assert.match(agentSidebar, /<span id="sidebar-project-scope-label" className="sr-only">All projects<\/span>/);
  assert.match(agentSidebar, /data-sidebar-scope-toggle/);
  assert.match(agentSidebar, /aria-label="Filter agents"/);
  assert.match(js, /data-sidebar-scope-option/);
  assert.match(js, /const RECENT_PROJECTS_KEY = 'spannerRecentProjects';/);
  assert.match(js, /const workspaceSwitcherSearch = document\.querySelector\('#workspace-switcher-search'\);/);
  assert.match(js, /function switcherProjectMatches\(project, query\)/);
  assert.match(js, /workspaceSwitcherSearch\?\.addEventListener\('input'/);
  assert.match(js, /fetchJson\('\/api\/recent-projects'\)/);
  assert.match(js, /data-workspace-project-index/);
  assert.ok(js.includes("const SIDEBAR_PROJECT_SCOPE_KEY = 'spannerSidebarProjectScope';"));
  assert.match(js, /function updateProjectScopeMenu\(threads\)/);
  assert.match(js, /const scopedThreads = scopedAgentThreads\(currentWorkspaceThreads\);/);
  assert.match(js, /aria-current="page"/);
  assert.doesNotMatch(js, /<em>current<\/em>/);
  assert.match(js, /localStorage\.setItem\(PROJECT_KEY, JSON\.stringify\(project\)\)/);
  assert.match(appCss, /\.workspace-switch-caret-icon/);
  assert.match(appCss, /\.workspace-switcher-menu/);
  assert.match(appCss, /\.workspace-switcher-search/);
  assert.match(appCss, /\.workspace-switcher-project\[aria-current="page"\]/);
  assert.doesNotMatch(pages, /WorkspaceSidebarLayoutPicker|workspaceSidebarLayouts|data-workspace-sidebar-layout-option|>Agents<\/h2>|id="refresh-threads"/);
  assert.doesNotMatch(js, /WORKSPACE_SIDEBAR_LAYOUT|workspaceSidebarLayout|refreshThreads/);
  assert.doesNotMatch(appCss, /workspace-layout-picker|data-workspace-sidebar-layout/);
});

test('home settled section only moves threads after explicit settle', () => {
  assert.doesNotMatch(pages, /main-screen-variations|>concepts<\/a>|id="refresh-threads"/);
  assert.ok(js.includes("const SIDEBAR_SETTLED_EXPANDED_KEY = 'spannerSidebarSettledExpanded';"));
  assert.ok(js.includes("const SIDEBAR_SETTLED_VISIBLE_KEY = 'spannerSidebarSettledVisible';"));
  assert.ok(js.includes("const SIDEBAR_SETTLED_THREADS_KEY = 'spannerSidebarSettledThreads';"));
  assert.match(js, /function readSettledShelfExpanded\(\)/);
  assert.match(js, /function setSettledShelfExpanded\(expanded\)/);
  assert.match(js, /function setSettledVisibleCount\(value\)/);
  assert.match(js, /function markThreadSettled\(name\)/);
  assert.match(js, /function markThreadUnsettled\(name\)/);
  assert.match(js, /function isSettledThread\(thread\)/);
  assert.match(js, /const activeThreads = inboxThreads\.filter\(\(thread\) => !isSettledThread\(thread\)\);/);
  assert.match(js, /const settledThreads = inboxThreads\.filter\(isSettledThread\);/);
  assert.match(js, /settledThreads\.slice\(0, settledVisibleCount\)/);
  assert.match(js, /const hiddenSettledCount = Math\.max\(0, settledThreads\.length - renderedSettledThreads\.length\);/);
  assert.match(js, /<section class="action-lane sidebar-inbox-section sidebar-inbox-active" aria-label="Active work">/);
  assert.match(js, /<section class="action-lane sidebar-inbox-section sidebar-inbox-settled" aria-label="Archived agents">/);
  assert.match(js, /aria-label="Archive thread">archive<\/button>/);
  assert.match(js, /aria-label="Unarchive thread">unarchive<\/button>/);
  assert.match(js, /data-settled-shelf-toggle aria-expanded="\$\{settledShelfExpanded \? 'true' : 'false'\}"/);
  assert.match(js, /data-settled-show-more/);
  assert.match(js, /data-sidebar-thread-row/);
  assert.match(js, /data-thread-menu-action="new-thread-project"/);
  assert.match(js, /data-thread-menu-action="settle"/);
  assert.match(js, /data-thread-menu-action="unsettle"/);
  assert.match(js, /data-thread-menu-action="delete"/);
  assert.match(js, /data-jump-index/);
  assert.match(js, /sidebar-jump-hints/);
  assert.match(js, /isCommand && event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(js, /isCommand && event\.key\.toLowerCase\(\) === 'n'/);
  assert.match(js, /isCommand && \/\^\[1-9\]\$\/\.test\(event\.key\)/);
  assert.match(js, /event\.key === '\]'/);
  assert.match(js, /event\.key === '\['/);
  assert.match(js, /function runThreadMenuAction\(action, thread\)/);
  assert.match(js, /\/api\/threads\/\$\{encodeURIComponent\(thread\.name\)\}\/delete/);
  assert.match(js, /const historyLink = '<a class="textbtn lane-history" href="\/history\.html">history<\/a>';/);
  assert.doesNotMatch(js, /id="clear-finished-threads"/);
  assert.match(js, /data-stop-thread="\$\{escapeHtml\(thread\.name\)\}"/);
  assert.match(js, /data-settle-thread="\$\{escapeHtml\(thread\.name\)\}"/);
  assert.match(js, /data-unsettle-thread="\$\{escapeHtml\(thread\.name\)\}"/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(stopButton\.dataset\.stopThread\)\}\/stop`, \{ method: 'POST' \}\)/);
  assert.doesNotMatch(js, /clear all/);
  assert.doesNotMatch(js, /dataset\.archiveThread/);
  assert.match(appCss, /\.workspace-agents-sidebar \.active-work/);
  assert.match(appCss, /\.workspace-agents-sidebar \.settled-work/);
  assert.match(appCss, /\.workspace-agents-sidebar \.settled-shelf-toggle/);
  assert.doesNotMatch(appCss, /\.workspace-agents-sidebar \.active-work:hover \.sidebar-thread-status/);
  assert.match(js, /cache: 'no-store'/);
});

test('sidebar batch selection can settle selected agents', () => {
  for (const runtime of [js, projectRuntime, globalSidebarRuntime]) {
    assert.match(runtime, /let selectedSidebarThreadNames = new Set\(\);/);
    assert.match(runtime, /function toggleSidebarThreadSelection\(name, options = \{\}\)/);
    assert.match(runtime, /function selectVisibleSettleableThreads\(threads\)/);
    assert.match(runtime, /function settleSelectedSidebarThreads\(\)/);
    assert.match(runtime, /function renderSidebarBatchBar\(\)/);
    assert.match(runtime, /data-sidebar-thread-select="\$\{escapeHtml\(thread\.name\)\}"/);
    assert.match(runtime, /\$\{selectButton\}\s+\$\{cardMode \? activeBody : settledBody\}\s+\$\{statusDot\}/);
    assert.doesNotMatch(runtime, /\$\{selectButton\}\$\{stopButton\}|\$\{selectButton\}\$\{unsettleButton\}/);
    assert.match(runtime, /aria-selected="\$\{selected \? 'true' : 'false'\}"/);
    assert.match(runtime, /data-sidebar-select-visible/);
    assert.match(runtime, /data-sidebar-batch-settle/);
    assert.match(runtime, /data-sidebar-selection-clear/);
    assert.match(runtime, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey/);
    assert.match(runtime, /setSettledShelfExpanded\(true\);/);
  }
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-batch-bar \{/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-thread-select \{/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-thread\.is-selected \{/);
  assert.match(appCss, /\.workspace-agents-sidebar \.action-lanes\.has-sidebar-selection \.active-work \.inbox-side/);
});

test('thread page boots the same global sidebar shell', () => {
  const threadStart = pages.indexOf('export function ThreadPage()');
  const threadEnd = pages.indexOf('export function SettingsPage()', threadStart);
  const threadBlock = pages.slice(threadStart, threadEnd);
  assert.match(threadBlock, /<GlobalAppShell insetClassName="global-app-center">/);
  assert.doesNotMatch(threadBlock, /sidebarDefaultOpen=\{false\}/);
  assert.doesNotMatch(appCss, /body\.thread-page \[data-slot="sidebar-wrapper"\] > \[data-slot="sidebar"\] \{\s*display: none;/);
  assert.match(threadRuntime, /import \{ startGlobalSidebar \} from '\.\/global-sidebar\.js';/);
  assert.match(threadRuntime, /startGlobalSidebar\(\{ statusNode \}\);/);
  assert.match(globalSidebarRuntime, /export function startGlobalSidebar\(options = \{\}\)/);
  assert.match(globalSidebarRuntime, /fetchJson\('\/api\/threads'\)/);
  assert.match(globalSidebarRuntime, /function updateProjectScopeMenu\(threads\)/);
  assert.match(globalSidebarRuntime, /aria-current="page"/);
  assert.match(appCss, /\.workspace-sidebar-edge-trigger \{[^}]*top: 20px;[^}]*left: calc\(var\(--sidebar-width\) - 42px\);/);
  assert.match(appCss, /\.workspace-agents-sidebar \.workspace-agents-head \{[^}]*padding: 20px 12px 4px;/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-title-row \{[^}]*padding-right: 0;/);
});

test('sidebar refresh avoids unnecessary redraws', () => {
  for (const runtime of [js, projectRuntime, globalSidebarRuntime]) {
    assert.match(runtime, /let lastSidebarRenderSignature = '';/);
    assert.match(runtime, /let lastSidebarRenderList = null;/);
    assert.match(runtime, /function sidebarRenderSignature\(threads\)/);
    assert.match(runtime, /threads: threads\.map\(sidebarThreadRenderSignature\)/);
    assert.match(runtime, /const renderSignature = sidebarRenderSignature\(/);
    assert.match(runtime, /list === lastSidebarRenderList && renderSignature === lastSidebarRenderSignature/);
    assert.doesNotMatch(runtime, /data-runtime-start|runtime-label|SIDEBAR_RUNTIME_TICK_MS/);
    assert.doesNotMatch(runtime, /formatElapsed\(label\.dataset\.runtimeStart, Date\.now\(\), true\)/);
  }
  assert.match(globalSidebarRuntime, /const SIDEBAR_POLL_INTERVAL_MS = 30000;/);
  assert.match(globalSidebarRuntime, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*refreshGlobalSidebar\(\)\.catch\(\(\) => \{\}\);\s*\}, SIDEBAR_POLL_INTERVAL_MS\);/);
});

test('global sidebar hydrates from the cached thread snapshot before refetching', () => {
  for (const runtime of [projectRuntime, globalSidebarRuntime]) {
    assert.ok(runtime.includes("const GLOBAL_SIDEBAR_THREADS_CACHE_KEY = 'spannerGlobalSidebarThreadsCache';"));
    assert.match(runtime, /function cachedGlobalSidebarThreads\(\)/);
    assert.match(runtime, /function cacheableGlobalSidebarThread\(thread = \{\}\)/);
    assert.match(runtime, /function cacheGlobalSidebarThreads\(threads\)/);
    assert.match(runtime, /function renderCachedGlobalSidebar\(\)/);
    assert.match(runtime, /localStorage\.setItem\(GLOBAL_SIDEBAR_THREADS_CACHE_KEY, JSON\.stringify\(\{ savedAt: Date\.now\(\), threads: safeThreads \}\)\)/);
    assert.match(runtime, /if \(!renderCachedGlobalSidebar\(\)\) renderGlobalSidebar\(\);/);
    assert.match(runtime, /cacheGlobalSidebarThreads\(threads\);\s*render/);
  }
  assert.ok(js.includes("const GLOBAL_SIDEBAR_THREADS_CACHE_KEY = 'spannerGlobalSidebarThreadsCache';"));
  assert.match(js, /function cacheGlobalSidebarThreads\(threads\)/);
  assert.match(js, /branch: thread\.branch/);
  assert.match(js, /startedAt: thread\.startedAt/);
  assert.equal((js.match(/cacheGlobalSidebarThreads\(workspaceSwitcherThreads\);/g) || []).length, 2);
});

test('sidebar groups threads by project and worktree metadata', () => {
  assert.match(threads, /repoPath, sourceRepoPath, worktreePath, worktreeBranch, localWorktree,/);
  for (const runtime of [js, projectRuntime, globalSidebarRuntime]) {
    assert.match(runtime, /sourceRepoPath: thread\.sourceRepoPath/);
    assert.match(runtime, /worktreePath: thread\.worktreePath/);
    assert.match(runtime, /function sidebarThreadProjectValue\(thread\)/);
    assert.match(runtime, /thread\?\.sourceRepoPath \|\| thread\?\.repoUrl \|\| thread\?\.repoPath/);
    assert.match(runtime, /function sidebarThreadWorktreeValue\(thread\)/);
    assert.match(runtime, /thread\?\.worktreePath \|\| thread\?\.repoPath \|\| thread\?\.repoUrl/);
    assert.match(runtime, /function groupedSidebarThreads\(threads\)/);
    assert.match(runtime, /function renderSidebarThreadGroups\(threads, renderCard\)/);
    assert.match(runtime, /renderSidebarThreadGroups\(activeThreads, renderJumpThreadCard\)/);
    assert.match(runtime, /renderSidebarThreadGroups\(renderedSettledThreads, renderJumpThreadCard\)/);
    assert.match(runtime, /data-thread-worktree-key="\$\{escapeHtml\(worktreeKeyText\)\}"/);
    assert.match(runtime, /sidebarThreadWorktreeLabel\(thread\)/);
    assert.match(runtime, /data-sidebar-worktree-new-thread/);
    assert.match(runtime, /function projectFromWorktreeButton\(button\)/);
    assert.match(runtime, /const reuseRepoPath = button\.dataset\.sidebarReuseRepoPath === 'true';/);
    assert.doesNotMatch(runtime, /<small>\$\{worktree\.count\}<\/small>/);
    assert.doesNotMatch(runtime, /<small>\$\{project\.count\}<\/small>/);
    assert.doesNotMatch(runtime, /class="action-count"/);
    assert.doesNotMatch(runtime, /Archived \(\$\{settledThreads\.length\}\)/);
  }
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-project-group/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-worktree-group-head \{[\s\S]*height: 30px;/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-worktree-new \{/);
  assert.doesNotMatch(appCss, /\.workspace-agents-sidebar \.sidebar-worktree-group-head::before/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-worktree-thread-list \{[\s\S]*margin-left: 31px;[\s\S]*border-left: 0;[\s\S]*padding-left: 0;/);
});

test('project icons use stable Phosphor-style line svgs', () => {
  assert.match(projectIconsRuntime, /const PROJECT_ICON_PATHS = \{/);
  assert.match(projectIconsRuntime, /export function projectIconName\(project\)/);
  assert.match(projectIconsRuntime, /export function projectIconSvg\(project, className = 'project-line-icon'\)/);
  for (const runtime of [js, projectRuntime, globalSidebarRuntime]) {
    assert.match(runtime, /import \{ projectIconSvg \} from '\.\/project-icons\.js';/);
    assert.ok(runtime.includes("return projectIconSvg(label, 'sidebar-thread-favicon project-line-icon');"));
    assert.match(runtime, /\$\{sidebarProjectIcon\(project\.label\)\}/);
    assert.match(runtime, /\$\{sidebarProjectIcon\(projectLabelText\)\}/);
  }
  assert.match(js, /project-switcher-icon/);
  assert.match(projectRuntime, /project-choice-icon/);
  assert.match(appCss, /\.project-line-icon \{ width: 16px; height: 16px;/);
  assert.match(appCss, /\.workspace-agents-sidebar \.sidebar-thread-favicon \{\s+display: block;/);
  assert.doesNotMatch(appCss, /\.sidebar-thread-favicon::after/);
});

test('recently finished rows use compact T3-style settled rows', () => {
  assert.match(js, /function finalAnswerSummary\(thread, maxLength = 160\)/);
  assert.match(js, /function finishedOutcome\(thread, rawStatus\)/);
  assert.match(js, /thread\?\.finalAnswerSummary/);
  assert.match(js, /const outcome = running \? '' : finishedOutcome\(thread, rawStatus\);/);
  assert.match(js, /function finishedAt\(thread\) \{/);
  assert.match(js, /function finishedAtMs\(thread\) \{/);
  assert.match(js, /return compact\.replace\(\/\\b\(\\d\+m\)\\s\+\\d\+s\\b\/g, '\$1'\);/);
  assert.match(js, /const finishedValue = finishedAt\(thread\);/);
  assert.match(js, /const finished = running \? '' : sidebarDurationLabel\(formatFinishedAgo\(finishedValue\)\);/);
  assert.match(js, /const inactiveTimes = !running \? \[finished\]\.filter\(Boolean\) : \[\];/);
  assert.match(js, /<span class="finished-meta">\$\{inactiveTimes\.map\(\(text\) => `<time>\$\{escapeHtml\(text\)\}<\/time>`\)\.join\(''\)\}<\/span>/);
  assert.match(js, /<span class="sidebar-thread-title-row"><strong>\$\{escapeHtml\(displayTitle\)\}<\/strong><\/span>/);
  assert.doesNotMatch(js.slice(js.indexOf('const activeBody ='), js.indexOf('const settledBody =', js.indexOf('const activeBody ='))), /sidebar-thread-meta-row/);
  assert.match(js, /\$\{sidebarProjectIcon\(project\.label\)\}/);
  assert.doesNotMatch(js, /data-runtime-status|data-runtime-start|activeRuntime/);
  assert.match(js, /class="answer-preview">\$\{escapeHtml\(outcome\)\}/);
  assert.match(appCss, /\.workspace-agents-sidebar \.active-work \{\s+display: grid;\s+grid-template-columns: 24px minmax\(0, 1fr\) 16px;[\s\S]*height: 38px;/);
  assert.match(appCss, /--sidebar-agent-font: 500 14px\/21px var\(--sans\);/);
  assert.match(appCss, /\.workspace-agents-sidebar \.settled-work \{\s+display: grid;\s+grid-template-columns: 24px minmax\(0, 1fr\) 16px;\s+gap: 0 4px;\s+align-items: center;\s+height: 36px;/);
  assert.doesNotMatch(appCss, /runtime-label|sidebar-thread-status|background: var\(--runtime-dot, currentColor\);/);
  assert.match(appCss, /\.workspace-agents-sidebar \.active-work > \.sidebar-thread-select,[\s\S]*\.workspace-agents-sidebar \.settled-work > \.sidebar-thread-select/);
  assert.match(appCss, /\.workspace-agents-sidebar \.active-work > \.status-dot,[\s\S]*\.workspace-agents-sidebar \.settled-work > \.status-dot/);
  assert.doesNotMatch(appCss, /\.workspace-agents-sidebar \.settled-work > \.status-dot \{\s+display: none;\s+\}/);
  assert.doesNotMatch(appCss, /\.workspace-agents-sidebar \.settled-work\.failed > \.status-dot/);
  assert.match(appCss, /\.workspace-agents-sidebar :where\(a, button, input, select, textarea, h1, h2, h3, strong, small, span, time, output, kbd\) \{\s+font: var\(--sidebar-agent-font\) !important;/);
  assert.match(appCss, /\.workspace-agents-sidebar \.settled-work \.answer-preview \{\s+display: none;/);
  assert.doesNotMatch(js, /function sortThreadInbox|\.sort\(sortThreadInbox\)/);
  assert.match(js, /const inboxThreads = filteredThreads;/);
  assert.match(runState, /scheduleFinalAnswerSummaryGeneration\(updated, text, runId\);/);
  assert.match(runState, /scheduleFinalTurnStatusClassification\(updated, \{ text \}, runId\);/);
  assert.match(runState, /scheduleSuggestedNextStepsGeneration\(updated, text, runId\);/);
});

test('recently finished success indicators can be dismissed locally', () => {
  assert.ok(js.includes("const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';"));
  assert.ok(js.includes("return !active && ['completed', 'ready'].includes(rawStatus);"));
  assert.match(js, /function hasFreshFinishedIndicator\(thread\) \{/);
  assert.match(js, /return isSettledThread\(thread\) && canDismissFinishedIndicator/);
  assert.match(js, /const hasFreshFinished = settledThreads\.some\(hasFreshFinishedIndicator\);/);
  assert.match(js, /const indicatorUnread = Boolean\(indicatorKey && !seenFinishedThreads\.has\(indicatorKey\)\);/);
  assert.match(js, /const showStatusDot = running \|\| rawStatus === 'failed' \|\| indicatorUnread;/);
  assert.match(js, /const statusDot = showStatusDot \? `<span class="status-dot" \$\{indicatorAttrs\}><\/span>` : '';/);
  assert.match(js, /data-finished-indicator-count>new/);
  assert.match(js, /list\.querySelectorAll\('\[data-finished-indicator\]'\)\.length/);
  assert.ok(js.includes('data-finished-indicator="${escapeHtml(indicatorKey)}"'));
  assert.ok(js.includes('data-finished-thread="${escapeHtml(indicatorKey)}"'));
  assert.ok(js.includes("document.addEventListener('keydown', (event) => {\n  if (!event.target?.closest?.('#threads-list')) return;"));
});

test('workspace toasts when running agents finish', () => {
  assert.match(entry, /import \{ Toaster \} from '\.\/components\/ui\/sonner\.jsx';/);
  assert.match(entry, /<Toaster[\s\S]+position="top-right"[\s\S]+richColors[\s\S]+closeButton/);
  assert.match(entry, /offset=\{\{ top: 18, right: 18 \}\}/);
  assert.match(entry, /mobileOffset=\{\{ top: 16, left: 16, right: 16 \}\}/);
  assert.match(entry, /closest\?\.\('\[data-sonner-toast\]\.agent-main-link-toast'\)/);
  assert.match(entry, /location\.assign\(MAIN_PAGE_PATH\)/);
  assert.match(js, /import \{ toast \} from 'sonner';/);
  assert.match(js, /import \{ playCompletionChime \} from '\.\/completion-chimes\.js';/);
  assert.match(js, /function showAgentToast\(title, detail = '', tone = 'success'\)/);
  assert.match(js, /const notify = tone === 'error' \? toast\.error : toast\.success;/);
  assert.match(js, /playCompletionChime\(\{ outcome: tone \}\)\.catch\(\(\) => \{\}\);/);
  assert.match(js, /description: detail \|\| undefined,\s*duration: 8000,\s*className: 'agent-main-link-toast',\s*\}\);/);
  assert.doesNotMatch(js, /action: \{ label: 'Open main'/);
  assert.match(appCss, /\[data-sonner-toaster\] \[data-sonner-toast\]\.agent-main-link-toast\[data-styled="true"\]/);
  assert.match(appCss, /--agent-toast-success: #B1DFA4;/);
  assert.match(appCss, /background: var\(--agent-toast-success\);/);
  assert.doesNotMatch(appCss, /\[data-button\]\[data-action\]/);
  assert.match(js, /function notifyFinishedThreads\(threads\)/);
  assert.equal((js.match(/notifyFinishedThreads\(workspaceSwitcherThreads\);/g) || []).length, 2);
  assert.match(js, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(js, /showAgentToast\(title, detail, rawStatus === 'failed' \? 'error' : 'success'\);/);
  assert.doesNotMatch(`${js}\n${agentToasts}\n${appCss}`, /#agent-toast-stack|\.agent-toast/);
  assert.match(js, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*loadThreads\(\)\.catch\(\(\) => \{\}\);\s*\}, 10000\);/);
});

test('global toasts load outside the workspace screen', () => {
  assert.match(entry, /import \{ startAgentToastWatcher \} from '\.\/runtime\/agent-toasts\.js';/);
  assert.match(entry, /const threadPollingRuntimePages = new Set\(\['project', 'workspace', 'thread', \.\.\.sidebarRuntimePages\]\);/);
  assert.match(entry, /if \(!threadPollingRuntimePages\.has\(page\)\) startAgentToastWatcher\(\);/);
  assert.match(agentToasts, /import \{ toast \} from 'sonner';/);
  assert.match(agentToasts, /import \{ playCompletionChime \} from '\.\/completion-chimes\.js';/);
  assert.match(agentToasts, /export function notifyAgentThreads\(threads\)/);
  assert.match(agentToasts, /export function startAgentToastWatcher\(\) \{/);
  assert.match(agentToasts, /function notifyFinishedThreads\(threads\)/);
  assert.match(projectRuntime, /import \{ notifyAgentThreads \} from '\.\/agent-toasts\.js';/);
  assert.match(globalSidebarRuntime, /import \{ notifyAgentThreads \} from '\.\/agent-toasts\.js';/);
  assert.match(projectRuntime, /notifyAgentThreads\(threads\);/);
  assert.match(globalSidebarRuntime, /notifyAgentThreads\(threads\);/);
  assert.match(agentToasts, /for \(const thread of threads\) \{/);
  assert.doesNotMatch(agentToasts, /sameSelectedProject|spannerSelectedProject|PROJECT_KEY/);
  assert.match(agentToasts, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(agentToasts, /const notify = tone === 'error' \? toast\.error : toast\.success;/);
  assert.match(agentToasts, /playCompletionChime\(\{ outcome: tone \}\)\.catch\(\(\) => \{\}\);/);
  assert.doesNotMatch(agentToasts, /action: \{ label: 'Open main'/);
  assert.match(agentToasts, /showAgentToast\(title, detail, rawStatus === 'failed' \? 'error' : 'success'\);/);
  assert.match(agentToasts, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*loadThreadsForToasts\(\)\.catch\(\(\) => \{\}\);\s*\}, 10000\);/);
});

test('completion chimes use spark as the installed finish sound', () => {
  assert.match(completionChimes, /export const COMPLETION_CHIME_KEY = 'spannerCompletionChime';/);
  assert.match(completionChimes, /export const DEFAULT_COMPLETION_CHIME = 'spark';/);
  assert.match(completionChimes, /id: 'spark'/);
  assert.doesNotMatch(completionChimes, /id: 'glass'|id: 'bloom'|id: 'calm'|id: 'off'/);
  assert.match(completionChimes, /globalThis\.AudioContext \|\| globalThis\.webkitAudioContext/);
  assert.match(completionChimes, /oscillator\.frequency\.setValueAtTime\(step\.frequency, start\)/);
  assert.match(completionChimes, /gain\.gain\.exponentialRampToValueAtTime/);
  assert.match(completionChimes, /outcome === 'error' \? errorSteps\(\) : chime\.steps/);
  assert.match(chimeHtml, /<title>Spanner Chimes<\/title>/);
  assert.match(chimeHtml, /id="play-spark"/);
  assert.match(chimeHtml, /id="play-failed"/);
  assert.match(chimePreview, /import \{[\s\S]+playCompletionChime[\s\S]+readCompletionChime[\s\S]+writeCompletionChime/);
  assert.match(chimePreview, /writeCompletionChime\('spark'\);/);
  assert.match(chimePreview, /playCompletionChime\(\{ id: 'spark', outcome: 'success' \}\)/);
});

test('new runs clear stale terminal runtime fields', () => {
  assert.match(runState, /function activeRunResetPatch\(\) \{/);
  assert.match(runState, /completedAt: undefined/);
  assert.match(runState, /endedAt: undefined/);
  assert.match(runState, /runEndedAtMs: undefined/);
  assert.match(runState, /finalAnswerSummary: undefined/);
  assert.match(runState, /finalTurnStatus: undefined/);
  assert.match(runState, /suggestedNextSteps: undefined/);
  assert.match(threads, /\.\.\.activeRunResetPatch\(\),\n\s+taskPrompt: prompt/);
});

test('local rows only stay live while a local runner promise is live', () => {
  assert.match(runState, /const liveLocalRuns = new Set\(\);/);
  assert.match(runState, /decorated\.localMode && isActiveRunStatus\(run\.runStatus \|\| decorated\.runStatus \|\| decorated\.status\) && !liveLocalRuns\.has\(session\.name\)/);
  assert.match(threads, /liveLocalRuns\.add\(stored\.name\);/);
  assert.match(threads, /\.finally\(\(\) => \{\n\s+liveLocalRuns\.delete\(stored\.name\);/);
  assert.match(threads, /localRunControllers\.delete\(stored\.name\)/);
});
