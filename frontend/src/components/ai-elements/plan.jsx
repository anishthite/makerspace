import { createContext, useContext, useMemo } from "react";
import { CaretUpDownIcon } from "@phosphor-icons/react";

import { Button } from "#components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#components/ui/collapsible";
import { cn } from "#lib/utils";

const PlanContext = createContext(null);

function usePlan() {
  const context = useContext(PlanContext);
  if (!context) throw new Error("Plan components must be used within Plan");
  return context;
}

function Shimmer({ children }) {
  return (
    <span className="inline-block animate-pulse bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
      {children}
    </span>
  );
}

export function Plan({ className, isStreaming = false, children, ...props }) {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <PlanContext.Provider value={contextValue}>
      <Collapsible asChild data-slot="plan" {...props}>
        <Card className={cn("shadow-none", className)}>{children}</Card>
      </Collapsible>
    </PlanContext.Provider>
  );
}

export function PlanHeader({ className, ...props }) {
  return (
    <CardHeader
      className={cn("flex items-start justify-between", className)}
      data-slot="plan-header"
      {...props}
    />
  );
}

export function PlanTitle({ children, ...props }) {
  const { isStreaming } = usePlan();
  return (
    <CardTitle data-slot="plan-title" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardTitle>
  );
}

export function PlanDescription({ className, children, ...props }) {
  const { isStreaming } = usePlan();
  return (
    <CardDescription
      className={cn("text-balance", className)}
      data-slot="plan-description"
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardDescription>
  );
}

export function PlanAction(props) {
  return <CardAction data-slot="plan-action" {...props} />;
}

export function PlanContent(props) {
  return (
    <CollapsibleContent asChild>
      <CardContent data-slot="plan-content" {...props} />
    </CollapsibleContent>
  );
}

export function PlanFooter(props) {
  return <CardFooter data-slot="plan-footer" {...props} />;
}

export function PlanTrigger({ className, ...props }) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        className={cn("size-8", className)}
        data-slot="plan-trigger"
        data-button
        size="icon"
        variant="ghost"
        {...props}
      >
        <CaretUpDownIcon className="size-4" />
        <span className="sr-only">Toggle plan</span>
      </Button>
    </CollapsibleTrigger>
  );
}
