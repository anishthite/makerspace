import { cn } from '@/lib/utils';

export function Surface({ as, level = 1, className, children, ...props }) {
  const Comp = as || 'section';
  return <Comp className={cn('ff-surface ff-proximity', `ff-surface-${level}`, className)} {...props}>{children}</Comp>;
}

export function Button({ as, href, variant = 'secondary', size = 'md', loading = false, className, children, ...props }) {
  const Comp = as || (href ? 'a' : 'button');
  const baseClass = variant === 'primary' ? 'primary-btn' : 'textbtn';
  const buttonProps = Comp === 'button'
    ? { type: props.type || 'button', disabled: loading || props.disabled }
    : { href };

  return <Comp
    {...props}
    {...buttonProps}
    className={cn(baseClass, 'ff-button ff-proximity', `ff-button-${variant}`, `ff-button-${size}`, loading && 'is-loading', className)}
    data-variant={variant}
    data-size={size}
    aria-busy={loading || undefined}
  >
    {loading && <span className="ff-spinner" aria-hidden="true" />}
    <span className="ff-button-label">{children}</span>
  </Comp>;
}

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }) {
  return <span className={cn('badge ff-badge', dot && 'has-dot', tone, className)} {...props}>
    {dot && <span className="status-dot" aria-hidden="true" />}
    {children}
  </span>;
}

export function StatusPill({ active = false, tone, className, children, ...props }) {
  return <span className={cn('status-pill ff-status-pill', active && 'is-active', className)} data-active={active ? 'true' : undefined} data-tone={tone} {...props}>
    {children}
  </span>;
}

export function InputGroup({ as, label, className, children, ...props }) {
  const Comp = as || 'label';
  return <Comp className={cn('target-input ff-input-group ff-proximity', className)} {...props}>
    {label && <span>{label}</span>}
    {children}
  </Comp>;
}

export function Select({ className, children, ...props }) {
  return <select className={cn('ff-select', className)} {...props}>{children}</select>;
}

export function Slider({ className, ...props }) {
  return <input className={cn('ff-slider', className)} type="range" {...props} />;
}

export function Switch({ id, label, help, className, ...props }) {
  return <label className={cn('toggle-card ff-switch-card ff-proximity', className)}>
    <span>{label}{help && <small>{help}</small>}</span>
    <input id={id} className="ff-switch" type="checkbox" {...props} />
  </label>;
}

export function ScrollArea({ as, className, children, ...props }) {
  const Comp = as || 'div';
  return <Comp className={cn('ff-scroll-area', className)} {...props}>{children}</Comp>;
}

export function Tabs({ items = [], className, ...props }) {
  return <nav className={cn('ff-tabs ff-proximity', className)} aria-label={props['aria-label'] || 'Sections'} {...props}>
    {items.map((item) => <a key={item.href || item.label} className={cn('ff-tab', item.active && 'is-active')} href={item.href}>{item.label}</a>)}
  </nav>;
}

export function Dialog({ id, title, children, className, ...props }) {
  return <dialog id={id} className={cn('ff-dialog ff-surface', className)} {...props}>
    {title && <h2>{title}</h2>}
    {children}
  </dialog>;
}

export function ThinkingStatus({ titleId, detailId, title = 'Loading', detail = '', className }) {
  return <section className={cn('now-card flow-card ff-thinking-card ff-proximity', className)}>
    <span className="ff-thinking-orb" aria-hidden="true" />
    <div>
      <h1 id={titleId}>{title}</h1>
      <p id={detailId} className="muted">{detail}</p>
    </div>
  </section>;
}

export function ThinkingSteps({ steps = [], title = 'Thinking', className }) {
  return <div className={cn('ff-thinking-steps', className)}>
    <div className="rail-head"><span>{title}</span><strong>{steps.filter((step) => step.status !== 'pending').length}</strong></div>
    <ol>
      {steps.map((step, index) => step.status === 'pending' ? null : <li key={step.label || index} className={cn('ff-thinking-step', step.status || 'complete')}>
        <span className="ff-step-dot" aria-hidden="true" />
        <span><strong>{step.label}</strong>{step.description && <small>{step.description}</small>}</span>
      </li>)}
    </ol>
  </div>;
}

export function AskUserQuestions({ question, options = [], className }) {
  return <div className={cn('ff-ask-user-questions ff-surface', className)}>
    <p className="eyebrow">question</p>
    <h3>{question}</h3>
    <div className="ff-question-options">
      {options.map((option, index) => <button key={option.id || option.title || index} type="button" className="ff-question-option ff-proximity">
        <span><strong>{option.title || option}</strong>{option.description && <small>{option.description}</small>}</span>
        <kbd>{index + 1}</kbd>
      </button>)}
    </div>
  </div>;
}

export function InputMessage({ as, className, children, ...props }) {
  const Comp = as || 'div';
  return <Comp className={cn('ff-input-message ff-proximity', className)} {...props}>{children}</Comp>;
}
