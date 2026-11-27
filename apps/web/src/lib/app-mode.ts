/**
 * Which app this page is running in: the Scholars Stack student app, the Partner app (restaurant
 * owners), or neither (the website on a laptop).
 *
 *  - The Android apps add "ScholarsStackApp/student" or "ScholarsStackApp/partner" to their
 *    user agent.
 *  - /partner (or /partner/…) is the Partner app, in any browser.
 *  - On a phone the website *is* the student app: same bar, tabs and screens. "?app=off" switches
 *    a phone back to the classic site (remembered on that phone), "?app=on" undoes it.
 *  - In a laptop browser, opening /app tries the student app for that tab.
 */
export type AppMode = 'student' | 'partner' | null;

const TAB_KEY = 'ss_app_mode';
const SITE_KEY = 'ss_site_mode';
const PHONE = '(max-width: 767px)';

function fromAgent(): AppMode {
  if (typeof navigator === 'undefined') return null;
  const m = /ScholarsStackApp\/(student|partner)/.exec(navigator.userAgent);
  return (m?.[1] as AppMode) ?? null;
}

function read(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function write(storage: Storage, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // storage blocked: the mode just isn't remembered
  }
}

export function appMode(): AppMode {
  const native = fromAgent();
  if (native) return native;
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  const flag = new URLSearchParams(window.location.search).get('app');
  if (flag === 'off') {
    // The classic site on this phone, from now on: forget any app mode this tab had.
    write(localStorage, SITE_KEY, 'web');
    write(sessionStorage, TAB_KEY, null);
  }
  if (flag === 'on') write(localStorage, SITE_KEY, null);
  // The Partner app is its own address: leaving it never leaves the rest of the site behind it.
  if (path === '/partner' || path.startsWith('/partner/')) return 'partner';
  if (path === '/app' || path.startsWith('/app/')) write(sessionStorage, TAB_KEY, 'student');
  if (read(sessionStorage, TAB_KEY) === 'student') return 'student';
  const phone = window.matchMedia?.(PHONE).matches ?? false;
  if (phone && read(localStorage, SITE_KEY) !== 'web') return 'student';
  return null;
}

/** Inside one of the Android apps (not a browser). */
export const isNativeApp = () => fromAgent() !== null;

/**
 * Where a website address goes in the student app: the home page is Today, its catalogue is
 * Notes (keeping batch, branch and search), its toolbox is Tools. Null: the address is fine as is.
 */
export function appPathFor(pathname: string, search: string, hash: string): string | null {
  if (pathname !== '/') return null;
  const q = new URLSearchParams(search);
  q.delete('app');
  const keep = q.toString();
  if (hash === '#toolbox') return '/app/tools';
  if (hash === '#catalogue' || q.has('batch') || q.has('branch') || q.has('q'))
    return `/app/notes${keep ? `?${keep}` : ''}`;
  return '/app';
}
