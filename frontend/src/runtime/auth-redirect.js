const HOMEPAGE_PATH = '/landing';

export function homepageRedirectUrl() {
  return `${HOMEPAGE_PATH}?${new URLSearchParams({ returnTo: location.href })}`;
}

export function redirectIfAuthRequired(payload = {}, response = {}) {
  if (Number(response?.status) !== 401 || !payload?.authRequired || globalThis.spannerDesktop) return false;
  location.replace(homepageRedirectUrl());
  return true;
}
