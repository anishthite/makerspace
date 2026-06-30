export function submitOnEnter(textarea, form, submitButton = null) {
  textarea?.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (submitButton?.disabled) return;
    event.preventDefault();
    form.requestSubmit();
  });
}
