import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { Select as SelectPrimitive } from 'radix-ui';

import { cn } from '#lib/utils';

function Select(props) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectTrigger({ className, children, ...props }) {
  return <SelectPrimitive.Trigger
    data-slot="select-trigger"
    className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-sm whitespace-nowrap text-[var(--ink-2)] outline-none transition-[color,box-shadow] focus-visible:border-[var(--blue)] focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-[var(--ink-4)] [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0', className)}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild><CaretDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

function SelectValue(props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectContent({ className, children, container, position = 'popper', ...props }) {
  return <SelectPrimitive.Portal container={container}>
    <SelectPrimitive.Content
      data-slot="select-content"
      position={position}
      className={cn('z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow)] data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)}
      {...props}>
      <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>;
}

function SelectItem({ className, children, ...props }) {
  return <SelectPrimitive.Item
    data-slot="select-item"
    className={cn('relative flex w-full cursor-default items-center rounded-md py-2 pr-8 pl-2 text-sm outline-none select-none focus:bg-[var(--blue-soft)] focus:text-[var(--ink)] data-[state=checked]:bg-[var(--blue-soft)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)}
    {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center justify-center"><CheckIcon className="size-4" aria-hidden="true" /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>;
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
