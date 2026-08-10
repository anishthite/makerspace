import { useEffect, useRef } from 'react';
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from '@phosphor-icons/react';

import { cn } from '#lib/utils';

const toolCalls = [
  {
    icon: 'terminal',
    label: 'Bash',
    command: "curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:5188/agent-elements-demo.html",
  },
  {
    icon: 'terminal',
    label: 'Bash',
    command: 'ps -p 29040 -o pid=,stat=,command=',
  },
  {
    icon: 'tool',
    label: 'mcp__node_repl__js',
  },
  {
    note: 'Chrome is connected. I’m opening the demo route and verifying the page content, not just the network response.',
  },
  {
    icon: 'tool',
    label: 'mcp__node_repl__js',
  },
  {
    note: 'The page is mounted and ready. I’ll leave the Chrome tab open and do one final server check.',
  },
  {
    icon: 'tool',
    label: 'mcp__node_repl__js',
  },
  {
    icon: 'terminal',
    label: 'Bash',
    command: "screen -ls | sed -n '1,80p'",
  },
  {
    icon: 'terminal',
    label: 'Bash',
    command: 'lsof -nP -iTCP:5188 -sTCP:LISTEN || true',
  },
];

function ToolIcon({ type }) {
  if (type === 'tool') return <WrenchIcon weight="regular" />;
  return <TerminalWindowIcon weight="regular" />;
}

function ToolCall({ call }) {
  if (call.note) {
    return <p className="agent-status-line">{call.note}</p>;
  }

  return (
    <div className="tool-call-row">
      <CaretRightIcon className="tool-caret" weight="bold" />
      <ToolIcon type={call.icon} />
      <span className="tool-label">{call.label}</span>
      {call.command && <code>{call.command}</code>}
    </div>
  );
}

function TranscriptTurn({ role, children }) {
  return (
    <article className={cn('transcript-turn', role === 'user' && 'is-user')}>
      <div className="turn-body">{children}</div>
    </article>
  );
}

export function AgentElementsDemoPage() {
  const threadRef = useRef(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, []);

  return (
    <main className="chat-demo">
      <header className="demo-tabbar">
        <button className="active-tab" data-button type="button">Recommend A...</button>
        <button aria-label="New tab" data-button type="button">
          <PlusIcon />
        </button>
      </header>

      <section className="demo-thread" aria-label="Agent thread preview" ref={threadRef}>
        <div className="transcript-stack">
          <TranscriptTurn>
            <p>and then opening Chrome.</p>
          </TranscriptTurn>

          <div className="tool-stack" aria-label="Tool activity">
            {toolCalls.map((call, index) => (
              <ToolCall call={call} key={`${call.label || call.note}-${index}`} />
            ))}
          </div>

          <TranscriptTurn>
            <p>Done. It’s running and open in Chrome:</p>

            <a className="url-pill" href="http://127.0.0.1:5188/agent-elements-demo.html">
              <span>http://127.0.0.1:5188/agent-elements-demo.html</span>
              <ArrowSquareOutIcon weight="bold" />
            </a>

            <p>Verified:</p>
            <ul className="verified-list">
              <li>server returns <code>200</code></li>
              <li>React page mounted: <code>Agent components preview</code></li>
              <li>server is running in detached <code>screen</code> session <code>agent-elements-demo</code> on port <code>5188</code></li>
            </ul>
          </TranscriptTurn>
        </div>
      </section>

      <form className="demo-composer" onSubmit={(event) => event.preventDefault()}>
        <textarea defaultValue="none of this looks as good tho" aria-label="Message" />
        <div className="composer-actions">
          <button aria-label="Copy message" data-button type="button">
            <CopyIcon />
          </button>
          <button aria-label="More actions" data-button type="button">
            <DotsThreeIcon />
          </button>
          <button aria-label="Send" className="send-button" data-button type="submit">
            <PaperPlaneTiltIcon weight="fill" />
          </button>
        </div>
      </form>
    </main>
  );
}
