import { useEffect, useRef, useState } from 'react';

import { Badge as ShadBadge } from './ui/badge.jsx';
import { Button as ShadButton } from './ui/button.jsx';
import { Slider as ShadSlider } from './ui/slider.jsx';
import { Select as ShadSelect, SelectContent as ShadSelectContent, SelectItem as ShadSelectItem, SelectTrigger as ShadSelectTrigger, SelectValue as ShadSelectValue } from './ui/select.jsx';
import { Switch as ShadSwitch } from './ui/switch.jsx';
import { Tabs as ShadTabs, TabsList as ShadTabsList, TabsTrigger as ShadTabsTrigger } from './ui/tabs.jsx';
import { cn } from '#lib/utils';

const buttonVariant = {
  primary: 'default',
  secondary: 'secondary',
  tertiary: 'outline',
  ghost: 'ghost',
  link: 'link',
};

const buttonSize = {
  md: 'default',
  sm: 'sm',
  lg: 'lg',
  icon: 'icon',
};

export function Surface({ as, className, children, ...props }) {
  const Comp = as || 'section';
  return <Comp className={className} {...props}>{children}</Comp>;
}

const buttonClass = {
  primary: 'border-[var(--blue)] bg-[var(--blue)] text-[var(--bg)] shadow-[var(--shadow)] hover:bg-[color-mix(in_srgb,var(--blue)_92%,var(--bg))]',
  secondary: 'border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--blue)] hover:bg-[var(--blue-soft)] hover:text-[var(--blue)]',
  tertiary: 'border-[var(--rule)] bg-transparent text-[var(--ink-2)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
  ghost: 'border-[var(--rule)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--blue)] hover:bg-[var(--blue-soft)] hover:text-[var(--blue)]',
  link: 'border-transparent bg-transparent px-0 text-[var(--blue)] underline-offset-4 hover:underline',
};

const buttonSizeClass = {
  md: 'h-9 px-3 py-2 text-[11px]',
  sm: 'h-8 px-2.5 py-1.5 text-[10px]',
  lg: 'h-10 px-4 py-2 text-xs',
  icon: 'size-9 p-0',
};

export function Button({ as, href, variant = 'secondary', size = 'md', loading = false, className, children, ...props }) {
  const Comp = as || (href ? 'a' : 'button');
  const legacyClass = variant === 'primary' ? 'primary-btn' : 'textbtn';
  const content = <span className="inline-flex items-center justify-center gap-1.5">{children}</span>;
  const shared = {
    variant: buttonVariant[variant] || variant,
    size: buttonSize[size] || size,
    className: cn(legacyClass, 'rounded-md border font-[var(--mono)] font-bold tracking-[.04em] lowercase transition-[background-color,border-color,color,opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:cursor-wait disabled:opacity-55', buttonClass[variant], buttonSizeClass[size], loading && 'pointer-events-none opacity-70', className),
    'data-app-variant': variant,
    'data-app-size': size,
    'aria-busy': loading || undefined,
  };

  if (Comp === 'button') {
    return <ShadButton {...props} {...shared} type={props.type || 'button'} disabled={loading || props.disabled}>{content}</ShadButton>;
  }

  return <ShadButton asChild {...shared} disabled={loading || props.disabled}>
    <Comp {...props} href={href}>{content}</Comp>
  </ShadButton>;
}

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }) {
  const variant = tone === 'error' ? 'destructive' : tone === 'neutral' ? 'secondary' : 'outline';
  return <ShadBadge className={cn('inline-flex max-w-full items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-[var(--rule)] bg-[var(--paper-2)] px-2 py-1 font-[var(--mono)] text-[11px] lowercase text-[var(--ink-3)] data-[tone=error]:text-[var(--red)] data-[tone=success]:text-[var(--teal)] data-[tone=warning]:text-[var(--yellow)]', dot && 'has-dot', tone, className)} variant={variant} data-tone={tone} {...props}>
    {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
    {children}
  </ShadBadge>;
}

export function StatusPill({ active = false, tone, className, children, ...props }) {
  return <span className={cn('inline-flex max-w-full items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-[var(--rule)] bg-[var(--paper-2)] px-2 py-1 font-[var(--mono)] text-[11px] lowercase text-[var(--ink-3)] data-[active=true]:border-[color-mix(in_srgb,var(--yellow)_45%,var(--rule))] data-[active=true]:text-[var(--yellow)] data-[tone=error]:text-[var(--red)] data-[tone=success]:text-[var(--teal)] data-[tone=warning]:text-[var(--yellow)]', className)} data-active={active ? 'true' : undefined} data-tone={tone} {...props}>
    {children}
  </span>;
}

export function InputGroup({ as, label, className, children, ...props }) {
  const Comp = as || 'label';
  return <Comp className={cn('target-input grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-[var(--rule)] bg-[var(--paper)] px-3 text-[var(--ink)] [&>span:first-child]:whitespace-nowrap [&>span:first-child]:font-[var(--mono)] [&>span:first-child]:text-[11px] [&>span:first-child]:font-bold [&>span:first-child]:lowercase [&>span:first-child]:text-[var(--blue)] [&_input]:border-0 [&_input]:bg-transparent [&_input]:py-2 [&_input]:shadow-none [&_select]:border-0 [&_select]:bg-transparent [&_select]:py-2 [&_select]:shadow-none', className)} {...props}>
    {label && <span>{label}</span>}
    {children}
  </Comp>;
}

const SELECT_EMPTY = '__spanner_select_empty__';

function readSelectPicker(select, initialLabel) {
  const options = [...select.options].map((option, index) => ({
    value: option.value || `${SELECT_EMPTY}:${index}`,
    nativeValue: option.value,
    index,
    label: option.textContent || option.label || initialLabel,
    disabled: option.disabled,
  }));
  const current = options[select.selectedIndex] || options.find((option) => option.nativeValue === select.value) || options[0];
  return {
    disabled: select.disabled || !options.length,
    options: options.length ? options : [{ value: `${SELECT_EMPTY}:0`, nativeValue: '', index: 0, label: initialLabel, disabled: true }],
    title: select.title || current?.label || initialLabel,
    value: current?.value || `${SELECT_EMPTY}:0`,
  };
}

const selectTriggerClass = {
  field: 'h-9 border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-[var(--ink-2)] focus-visible:border-[var(--blue)]',
  inline: 'h-auto min-h-0 border-0 bg-transparent px-0 py-2 text-[14px] font-semibold text-[var(--ink-2)] shadow-none hover:bg-transparent focus-visible:border-0 focus-visible:ring-0',
  prompt: 'h-auto min-h-0 border-0 bg-transparent px-0 py-2 text-[12px] font-semibold text-[#f0f0f0] shadow-none hover:bg-transparent focus-visible:border-0 focus-visible:ring-0 [&_svg]:size-3 [&_svg]:text-[rgba(255,255,255,.48)]',
};

export function Select({ className, triggerClassName, contentClassName, variant = 'field', children, placeholder = 'select…', ...props }) {
  const selectRef = useRef(null);
  const [picker, setPicker] = useState({ disabled: true, options: [{ value: `${SELECT_EMPTY}:0`, nativeValue: '', index: 0, label: placeholder, disabled: true }], title: placeholder, value: `${SELECT_EMPTY}:0` });
  const [portalContainer, setPortalContainer] = useState(null);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return undefined;
    setPortalContainer(select.closest('dialog'));
    const sync = () => setPicker(readSelectPicker(select, placeholder));
    sync();
    const frame = requestAnimationFrame(sync);
    const observer = new MutationObserver(sync);
    observer.observe(select, { attributes: true, attributeFilter: ['disabled', 'title'], childList: true, subtree: true });
    select.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      select.removeEventListener('change', sync);
    };
  }, [children, placeholder]);

  const chooseValue = (nextValue) => {
    const select = selectRef.current;
    const option = picker.options.find((item) => item.value === nextValue);
    if (!select || !option) return;
    select.selectedIndex = option.index;
    select.value = option.nativeValue;
    setPicker(readSelectPicker(select, placeholder));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  return <span className={cn('app-select block min-w-0', className)} data-select-variant={variant}>
    <select ref={selectRef} className="app-select-native sr-only" tabIndex="-1" aria-hidden="true" {...props}>{children}</select>
    <ShadSelect value={picker.value} onValueChange={chooseValue} disabled={picker.disabled}>
      <ShadSelectTrigger className={cn('w-full justify-between gap-2 rounded-md text-sm whitespace-nowrap outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-[var(--ink-4)] [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0', selectTriggerClass[variant] || selectTriggerClass.field, triggerClassName)} aria-label={props['aria-label']} title={picker.title}>
        <ShadSelectValue placeholder={placeholder} />
      </ShadSelectTrigger>
      <ShadSelectContent container={portalContainer} className={cn('z-[100] border-[var(--rule)] bg-[var(--paper)] text-[var(--ink)]', contentClassName)}>
        {picker.options.map((option) => <ShadSelectItem key={`${option.value}:${option.label}`} value={option.value} disabled={option.disabled}>{option.label}</ShadSelectItem>)}
      </ShadSelectContent>
    </ShadSelect>
  </span>;
}

export function Slider({ className, defaultValue = 0, min = 0, max = 100, step = 1, ...props }) {
  const inputRef = useRef(null);
  const [current, setCurrent] = useState(Number(defaultValue));

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const sync = () => setCurrent(Number(input.value));
    sync();
    const frame = requestAnimationFrame(sync);
    input.addEventListener('input', sync);
    return () => {
      cancelAnimationFrame(frame);
      input.removeEventListener('input', sync);
    };
  }, []);

  const update = (next) => {
    const value = Array.isArray(next) ? next[0] : next;
    setCurrent(Number(value));
    if (!inputRef.current) return;
    inputRef.current.value = String(value);
    inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return <span className={cn('block min-w-[180px]', className)}>
    <input ref={inputRef} className="sr-only" type="range" defaultValue={defaultValue} min={min} max={max} step={step} tabIndex="-1" aria-hidden="true" {...props} />
    <ShadSlider value={[current]} onValueChange={update} min={Number(min)} max={Number(max)} step={Number(step)} />
  </span>;
}

export function Switch({ id, label, help, className, defaultChecked = false, ...props }) {
  const inputRef = useRef(null);
  const [checked, setChecked] = useState(Boolean(defaultChecked));

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const sync = () => setChecked(Boolean(input.checked));
    sync();
    const frame = requestAnimationFrame(sync);
    input.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame);
      input.removeEventListener('change', sync);
    };
  }, []);

  const setInputChecked = (nextChecked) => {
    if (!inputRef.current) return;
    inputRef.current.checked = Boolean(nextChecked);
    inputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
  };

  return <label className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--rule)] bg-[var(--paper)] p-3 text-[var(--ink)] shadow-[var(--shadow)] [&_small]:mt-1 [&_small]:block [&_small]:text-[12px] [&_small]:text-[var(--ink-3)]', className)}>
    <span className="grid gap-1">{label}{help && <small>{help}</small>}</span>
    <input ref={inputRef} id={id} className="sr-only" type="checkbox" defaultChecked={defaultChecked} tabIndex="-1" aria-hidden="true" {...props} />
    <ShadSwitch checked={checked} onCheckedChange={setInputChecked} aria-label={label} />
  </label>;
}

export function ScrollArea({ as, className, children, ...props }) {
  const Comp = as || 'div';
  return <Comp className={className} {...props}>{children}</Comp>;
}

export function Tabs({ items = [], className, ...props }) {
  const initial = Math.max(0, items.findIndex((item) => item.active || (item.href && globalThis.location?.hash === item.href)));
  const [selected, setSelected] = useState(initial);
  const select = (index) => {
    setSelected(index);
    const href = items[index]?.href;
    if (href) globalThis.location.hash = href.replace(/^#/, '');
  };

  const selectedValue = String(selected);

  return <ShadTabs value={selectedValue} onValueChange={(value) => select(Number(value))} className={className} aria-label={props['aria-label'] || 'Sections'} {...props}>
    <ShadTabsList>
      {items.map((item, index) => <ShadTabsTrigger key={item.href || item.label} value={String(index)}>{item.label}</ShadTabsTrigger>)}
    </ShadTabsList>
  </ShadTabs>;
}

export function Dialog({ id, title, children, className, ...props }) {
  return <dialog id={id} className={className} {...props}>
    {title && <h2>{title}</h2>}
    {children}
  </dialog>;
}

export function ThinkingStatus({ titleId, detailId, title = 'Loading', detail = '', className }) {
  return <section className={cn('rounded-md border border-[var(--rule)] bg-[var(--paper)] p-4 shadow-[var(--shadow)]', className)}>
    <div>
      <h1 id={titleId}>{title}</h1>
      <p id={detailId} className="text-[var(--ink-3)]">{detail}</p>
    </div>
  </section>;
}

export function ThinkingSteps({ steps = [], title = 'Thinking', className }) {
  return <div className={className}>
    <div className="rail-head"><span>{title}</span><strong>{steps.filter((step) => step.status !== 'pending').length}</strong></div>
    <ol>
      {steps.map((step, index) => step.status === 'pending' ? null : <li key={step.label || index} className={step.status || 'complete'}>
        <span className="status-dot" aria-hidden="true" />
        <span><strong>{step.label}</strong>{step.description && <small>{step.description}</small>}</span>
      </li>)}
    </ol>
  </div>;
}

export function AskUserQuestions({ question, options = [], className }) {
  return <div className={className}>
    <p className="mb-2 font-[var(--mono)] text-[11px] font-bold lowercase tracking-[.12em] text-[var(--blue)]">question</p>
    <h3>{question}</h3>
    <div>
      {options.map((option, index) => <button key={option.id || option.title || index} type="button">
        <span><strong>{option.title || option}</strong>{option.description && <small>{option.description}</small>}</span>
        <kbd>{index + 1}</kbd>
      </button>)}
    </div>
  </div>;
}

export function InputMessage({ as, className, children, ...props }) {
  const Comp = as || 'div';
  return <Comp className={className} {...props}>{children}</Comp>;
}
