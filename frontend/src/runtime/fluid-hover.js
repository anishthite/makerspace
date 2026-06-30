let active = null;

function setPointerVars(event) {
  const target = event.target?.closest?.('.ff-proximity');
  if (active && active !== target) active.classList.remove('is-proximity-active');
  active = target;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  target.style.setProperty('--ff-x', `${event.clientX - rect.left}px`);
  target.style.setProperty('--ff-y', `${event.clientY - rect.top}px`);
  target.classList.add('is-proximity-active');
}

function clearPointerVars(event) {
  if (!active || event.relatedTarget?.closest?.('.ff-proximity') === active) return;
  active.classList.remove('is-proximity-active');
  active = null;
}

document.addEventListener('pointermove', setPointerVars, { passive: true });
document.addEventListener('pointerout', clearPointerVars, { passive: true });
