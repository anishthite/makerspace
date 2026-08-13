import {
  FolderOpenIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowUpIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';

import { Button, InputGroup, ScrollArea, Select, Surface } from './ui.jsx';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar.jsx';
import { cn } from '#lib/utils';

const buttonIconProps = { 'aria-hidden': true, 'data-icon': 'inline-start', className: 'size-4' };

export function AgentInboxSidebar() {
  return <Surface id="agents-section" className="workspace-agents-sidebar flex h-full min-h-0 flex-col bg-[color-mix(in_srgb,var(--paper)_44%,transparent)]" aria-label="Agent inbox">
    <SidebarHeader className="workspace-agents-head grid gap-1 border-b border-[var(--rule)] p-2">
      <div className="sidebar-title-row">
        <a className="sidebar-spanner-title" href="/workspace.html" aria-label="Open Spanner workspace">Spanner</a>
      </div>
      <div className="sidebar-command-row">
        <InputGroup label={<MagnifyingGlassIcon className="size-4" aria-hidden="true" />} className="agent-search border-0 bg-transparent px-0 shadow-none [&_input]:min-w-0 [&_input]:py-1.5" as="div">
          <input id="agent-search" type="search" placeholder="Search agents" autoComplete="off" aria-label="Search agent inbox" aria-controls="threads-list" aria-keyshortcuts="Meta+K Control+K" />
          <button id="sidebar-project-scope" className="sidebar-project-scope sidebar-search-filter" type="button" data-sidebar-scope-toggle aria-label="Filter agents" aria-haspopup="menu" aria-expanded="false" aria-controls="sidebar-project-scope-menu">
            <FunnelIcon className="size-4 shrink-0" aria-hidden="true" />
            <span id="sidebar-project-scope-label" className="sr-only">All projects</span>
          </button>
        </InputGroup>
        <div id="sidebar-project-scope-menu" className="sidebar-scope-menu" role="menu" hidden></div>
      </div>
      <Button variant="ghost" className="sidebar-new-prompt-button sidebar-new-prompt-wide" type="button" data-sidebar-new-thread aria-label="New worktree" aria-keyshortcuts="N Meta+T Control+T" aria-haspopup="dialog" aria-expanded="false" aria-controls="sidebar-prompt-lightbox" title="New worktree (N; desktop: ⌘/Ctrl+T)"><PlusIcon className="size-4" aria-hidden="true" />new worktree</Button>
    </SidebarHeader>
    <SidebarContent className="min-h-0">
      <ScrollArea id="threads-list" className="action-lanes px-2 pb-5"></ScrollArea>
    </SidebarContent>
  </Surface>;
}

export function SidebarPromptLightbox() {
  return <dialog id="sidebar-prompt-lightbox" className="sidebar-prompt-lightbox" aria-label="Start a main agent" aria-describedby="sidebar-prompt-status">
    <form id="sidebar-prompt-form" className="sidebar-prompt-lightbox-shell" noValidate>
      <header className="sidebar-prompt-topbar">
        <div className="sidebar-prompt-project-picker">
          <FolderOpenIcon className="sidebar-prompt-project-icon size-4" weight="duotone" aria-hidden="true" />
          <Select id="sidebar-prompt-project-select" variant="prompt" aria-label="Project for new agent" placeholder="loading projects..."><option value="">loading projects...</option></Select>
        </div>
        <Button id="sidebar-prompt-lightbox-close" variant="ghost" size="icon" className="sidebar-prompt-close" type="button" aria-label="close prompt"><XIcon className="size-4" aria-hidden="true" /></Button>
      </header>
      <label className="sr-only" htmlFor="sidebar-prompt">Prompt</label>
      <textarea id="sidebar-prompt" name="prompt" rows="4" placeholder="Tell the main agent what to do..." aria-keyshortcuts="Enter" required></textarea>
      <div className="sidebar-prompt-control-strip" aria-label="main agent run controls">
        <div className="attachment-row composer-attachment-row">
          <Button id="sidebar-prompt-images-trigger" variant="ghost" size="sm" className="attach-btn" type="button" aria-label="add images" aria-controls="sidebar-prompt-images" title="add images"><PlusIcon {...buttonIconProps} /></Button>
          <input id="sidebar-prompt-images" className="image-input" name="images" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple tabIndex="-1" aria-hidden="true" />
          <span id="sidebar-prompt-image-status" className="attachment-status muted" role="status" aria-live="polite"></span>
        </div>
        <InputGroup className="model-picker sidebar-prompt-model max-sm:flex-[1_1_100%]">
          <Select id="sidebar-model-ref" name="modelRef" variant="prompt" aria-label="Model for new agent" placeholder="loading model…"><option value="">loading model…</option></Select>
        </InputGroup>
        <InputGroup className="model-picker sidebar-prompt-thinking max-sm:flex-[1_1_100%]">
          <Select id="sidebar-thinking-level" name="thinkingLevel" defaultValue="xhigh" variant="prompt" aria-label="Thinking level" placeholder="xhigh"><option value="off">off</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></Select>
        </InputGroup>
        <Button id="sidebar-prompt-submit" variant="primary" className="sidebar-prompt-start" type="submit" aria-label="send prompt"><ArrowUpIcon className="size-4" weight="bold" aria-hidden="true" /></Button>
      </div>
      <p id="sidebar-prompt-project" className="sr-only" aria-live="polite">Choose a project first.</p>
      <p id="sidebar-prompt-status" className="sidebar-prompt-status" role="status" aria-live="polite"></p>
    </form>
  </dialog>;
}

export function GlobalAppShell({ children, sidebarDefaultOpen = true, insetClassName = '' }) {
  return <SidebarProvider defaultOpen={sidebarDefaultOpen} className="global-sidebar-shell min-h-svh bg-[var(--bg)]" style={{ '--sidebar-width': 'var(--workspace-sidebar-width, 22rem)' }}>
    <SidebarTrigger className="workspace-sidebar-edge-trigger" aria-label="toggle agents sidebar" title="toggle agents sidebar" />
    <Sidebar className="workspace-global-sidebar border-r border-[var(--rule)]" collapsible="offcanvas">
      <AgentInboxSidebar />
    </Sidebar>
    <SidebarInset className={cn('global-app-inset min-w-0 bg-[var(--bg)]', insetClassName)}>
      {children}
    </SidebarInset>
    <SidebarPromptLightbox />
  </SidebarProvider>;
}
