const HOMEPAGE_PATH = '/homepage';

export function homepageRedirectUrl() {
  return `${HOMEPAGE_PATH}?${new URLSearchParams({ returnTo: location.href })}`;
}

export function redirectIfAuthRequired(payload = {}, response = {}) {
  if (Number(response?.status) !== 401 || !payload?.authRequired || globalThis.spannerDesktop) return false;
  location.replace(homepageRedirectUrl());
  return true;
}
