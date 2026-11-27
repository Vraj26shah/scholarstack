/**
 * Which app this page is running in: the Scholars Stack student app, the Partner app (restaurant
 * owners), or neither (the website on a laptop).
 *
 *  - The Android apps add "ScholarsStackApp/student" or "ScholarsStackApp/partner" to their
 *    user agent.
 *  - /partner (or /partner/…) is the Partner app, in any browser.
 *  - Every browser, phones included, gets the website. The student app is an extra people
 *    download (/get-app). "?app=on" previews the app screens in this browser (remembered here,
 *    for checking them without a phone); "?app=off" ends the preview.
 */
export type AppMode = 'student' | 'partner' | null;

const PREVIEW_KEY = 'ss_app_preview';

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
  if (flag === 'off') write(localStorage, PREVIEW_KEY, null);
  if (flag === 'on') write(localStorage, PREVIEW_KEY, '1');
  // The Partner app is its own address: leaving it never leaves the rest of the site behind it.
  if (path === '/partner' || path.startsWith('/partner/')) return 'partner';
  if (read(localStorage, PREVIEW_KEY) === '1') return 'student';
  return null;
}

/** Inside one of the Android apps (not a browser). */
export const isNativeApp = () => fromAgent() !== null;

/**
 * Where an app screen's address goes on the website (a browser opening /app, an old bookmark or a
 * shared link): Today → home, Notes → the catalogue (keeping batch, branch and search), Tools →
 * the toolbox, Me → the account page.
 */
export function sitePathFor(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  q.delete('app');
  const keep = q.toString();
  if (pathname.startsWith('/app/notes')) return `/${keep ? `?${keep}` : ''}#catalogue`;
  if (pathname.startsWith('/app/tools')) return '/#toolbox';
  if (pathname.startsWith('/app/me')) return '/account';
  return '/';
}

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
