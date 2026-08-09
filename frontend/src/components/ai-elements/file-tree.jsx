import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#components/ui/collapsible";
import { cn } from "#lib/utils";

const noop = () => {};

const FileTreeContext = createContext({
  expandedPaths: new Set(),
  togglePath: noop,
});

export function FileTree({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
  ...props
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) newExpanded.delete(path);
      else newExpanded.add(path);
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath }),
    [expandedPaths, onSelect, selectedPath, togglePath]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "rounded-lg border bg-background font-[var(--mono)] text-sm",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
}

export function FileTreeIcon({ className, children, ...props }) {
  return <span className={cn("shrink-0", className)} {...props}>{children}</span>;
}

export function FileTreeName({ className, children, ...props }) {
  return <span className={cn("truncate", className)} {...props}>{children}</span>;
}

export function FileTreeFolder({
  path,
  name,
  className,
  children,
  ...props
}) {
  const { expandedPaths, togglePath, selectedPath, onSelect } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;

  const handleOpenChange = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);

  const handleSelect = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  return (
    <Collapsible onOpenChange={handleOpenChange} open={isExpanded}>
      <div className={cn("", className)} role="treeitem" tabIndex={0} {...props}>
        <div
          className={cn(
            "flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
            isSelected && "bg-muted"
          )}
        >
          <CollapsibleTrigger asChild>
            <button
              className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
              data-button
              type="button"
            >
              <CaretRightIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
            </button>
          </CollapsibleTrigger>
          <button
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
            data-button
            onClick={handleSelect}
            type="button"
          >
            <FileTreeIcon>
              {isExpanded ? (
                <FolderOpenIcon className="size-4 text-muted-foreground" />
              ) : (
                <FolderIcon className="size-4 text-muted-foreground" />
              )}
            </FileTreeIcon>
            <FileTreeName>{name}</FileTreeName>
          </button>
        </div>
        <CollapsibleContent>
          <div className="ml-4 border-l pl-2">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function FileTreeFile({
  path,
  name,
  icon,
  className,
  children,
  ...props
}) {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleSelect = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
        isSelected && "bg-muted text-foreground",
        className
      )}
      onClick={handleSelect}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      <FileTreeIcon>{icon ?? <FileIcon className="size-4" />}</FileTreeIcon>
      <FileTreeName>{name}</FileTreeName>
      {children}
    </div>
  );
}
