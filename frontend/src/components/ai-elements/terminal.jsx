import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckIcon,
  CopySimpleIcon,
  TerminalWindowIcon,
  TrashSimpleIcon,
} from "@phosphor-icons/react";

import { Button } from "#components/ui/button";
import { cn } from "#lib/utils";

const TERMINAL_ACTION_BUTTON_CLASS =
  "size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100";

const TerminalContext = createContext({
  autoScroll: true,
  isStreaming: false,
  output: "",
});

export function TerminalHeader({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-zinc-800 border-b px-4 py-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TerminalTitle({ className, children, ...props }) {
  return (
    <div
      className={cn("flex items-center gap-2 text-sm text-zinc-400", className)}
      {...props}
    >
      <TerminalWindowIcon className="size-4" />
      {children ?? "Terminal"}
    </div>
  );
}

export function TerminalStatus({ className, children, ...props }) {
  const { isStreaming } = useContext(TerminalContext);
  if (!isStreaming) return null;
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-zinc-400", className)}
      {...props}
    >
      {children ?? <span className="size-2 rounded-full bg-emerald-400" />}
      <span>streaming</span>
    </div>
  );
}

export function TerminalActions({ className, children, ...props }) {
  return <div className={cn("flex items-center gap-1", className)} {...props}>{children}</div>;
}

export function TerminalCopyButton({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef(0);
  const { output } = useContext(TerminalContext);

  const copyToClipboard = useCallback(async () => {
    if (!navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
      setIsCopied(true);
      onCopy?.();
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error);
    }
  }, [output, onCopy, onError, timeout]);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const Icon = isCopied ? CheckIcon : CopySimpleIcon;
  return (
    <Button
      className={cn(TERMINAL_ACTION_BUTTON_CLASS, className)}
      onClick={copyToClipboard}
      size="icon"
      data-button
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}

export function TerminalClearButton({ children, className, ...props }) {
  const { onClear } = useContext(TerminalContext);
  if (!onClear) return null;
  return (
    <Button
      className={cn(TERMINAL_ACTION_BUTTON_CLASS, className)}
      onClick={onClear}
      size="icon"
      data-button
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <TrashSimpleIcon className="size-3.5" />}
    </Button>
  );
}

export function TerminalContent({ className, children, ...props }) {
  const { output, isStreaming, autoScroll } = useContext(TerminalContext);
  const containerRef = useRef(null);
  const plainOutput = output.replace(/\u001b\[[0-9;]*m/g, "");

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  return (
    <div
      className={cn(
        "max-h-96 overflow-auto p-4 font-[var(--mono)] text-sm leading-relaxed",
        className
      )}
      ref={containerRef}
      {...props}
    >
      {children ?? (
        <pre className="whitespace-pre-wrap break-words">
          {plainOutput}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-zinc-100" />
          )}
        </pre>
      )}
    </div>
  );
}

export function Terminal({
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  className,
  children,
  ...props
}) {
  const contextValue = useMemo(
    () => ({ autoScroll, isStreaming, onClear, output }),
    [autoScroll, isStreaming, onClear, output]
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <TerminalHeader>
              <TerminalTitle />
              <div className="flex items-center gap-1">
                <TerminalStatus />
                <TerminalActions>
                  <TerminalCopyButton />
                  {onClear && <TerminalClearButton />}
                </TerminalActions>
              </div>
            </TerminalHeader>
            <TerminalContent />
          </>
        )}
      </div>
    </TerminalContext.Provider>
  );
}
