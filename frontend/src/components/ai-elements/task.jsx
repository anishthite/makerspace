import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#components/ui/collapsible";
import { cn } from "#lib/utils";

export function TaskItemFile({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-foreground text-xs",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TaskItem({ children, className, ...props }) {
  return (
    <div className={cn("text-muted-foreground text-sm", className)} {...props}>
      {children}
    </div>
  );
}

export function Task({ defaultOpen = true, className, ...props }) {
  return (
    <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
  );
}

export function TaskTrigger({ children, className, title, ...props }) {
  return (
    <CollapsibleTrigger asChild className={cn("group", className)} {...props}>
      {children ?? (
        <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
          <MagnifyingGlassIcon className="size-4" />
          <p className="text-sm">{title}</p>
          <CaretDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      )}
    </CollapsibleTrigger>
  );
}

export function TaskContent({ children, className, ...props }) {
  return (
    <CollapsibleContent
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">
        {children}
      </div>
    </CollapsibleContent>
  );
}
