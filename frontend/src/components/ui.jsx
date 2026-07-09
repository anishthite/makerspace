import { useEffect, useRef, useState } from 'react';

import { Badge as ShadBadge } from './ui/badge.jsx';
import { Button as ShadButton } from './ui/button.jsx';
import { Slider as ShadSlider } from './ui/slider.jsx';
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

export function Button({ as, href, variant = 'secondary', size = 'md', loading = false, className, children, ...props }) {
  const Comp = as || (href ? 'a' : 'button');
  const legacyClass = variant === 'primary' ? 'primary-btn' : 'textbtn';
  const content = <span className="inline-flex items-center justify-center gap-1.5">{children}</span>;
  const shared = {
    variant: buttonVariant[variant] || variant,
    size: buttonSize[size] || size,
    className: cn(legacyClass, loading && 'opacity-70 pointer-events-none', className),
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
  return <ShadBadge className={cn('badge', dot && 'has-dot', tone, className)} variant={variant} data-tone={tone} {...props}>
    {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
    {children}
  </ShadBadge>;
}

export function StatusPill({ active = false, tone, className, children, ...props }) {
  return <span className={cn('status-pill', active && 'is-active', className)} data-active={active ? 'true' : undefined} data-tone={tone} {...props}>
    {children}
  </span>;
}

export function InputGroup({ as, label, className, children, ...props }) {
  const Comp = as || 'label';
  return <Comp className={cn('target-input', className)} {...props}>
    {label && <span>{label}</span>}
    {children}
  </Comp>;
}

export function Select({ className, children, ...props }) {
  return <select className={className} {...props}>{children}</select>;
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

  return <label className={cn('toggle-card', className)}>
    <span>{label}{help && <small>{help}</small>}</span>
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
  return <section className={cn('now-card', className)}>
    <div>
      <h1 id={titleId}>{title}</h1>
      <p id={detailId} className="muted">{detail}</p>
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
    <p className="eyebrow">question</p>
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
