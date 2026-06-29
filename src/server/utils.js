function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeSubmittedAtMs(value) {
  const submittedAtMs = Number(value);
  return Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now();
}

function normalizeBridgeClientId(value) {
  return normalizeClientId(value) || randomUUID();
}

export { sleep, trimTrailingSlash, normalizeSubmittedAtMs, normalizeBridgeClientId };
