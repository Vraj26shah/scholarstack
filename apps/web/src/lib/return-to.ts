// Where to go back to after signing in. Kept in localStorage (not sessionStorage) because the
// emailed sign-in link usually opens in a NEW tab, which can't see the old tab's sessionStorage:
// before, those students landed on the home page instead of the page they started from.

const KEY = 'ss_auth_next';
const OLD_KEY = 'auth_next';
/** A sign-in started longer ago than this has been abandoned: don't jump there out of nowhere. */
const MAX_AGE_MS = 2 * 3600_000;

/** A path on this site ("/c/x?y#z"), never another site ("//evil.com", "https://…"). */
export const localPath = (p: string | null | undefined): string | null =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : null;

/** Where the visitor is now, as a path with its query and #section. */
export const herePath = () =>
  typeof window === 'undefined'
    ? '/'
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Pages that are never a place to come back to. */
const isAuthPage = (p: string) => p.startsWith('/sign-in') || p.startsWith('/auth/') || p === '/admin/login';

export function rememberReturn(path: string) {
  const p = localPath(path);
  if (!p || isAuthPage(p)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ p, at: Date.now() }));
  } catch {
    sessionStorage.setItem(OLD_KEY, p);
  }
}

/** The remembered page (once: it is forgotten as it is read), or null. */
export function takeReturn(): string | null {
  let out: string | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    const v = raw ? (JSON.parse(raw) as { p?: unknown; at?: unknown }) : null;
    if (v && typeof v.at === 'number' && Date.now() - v.at < MAX_AGE_MS)
      out = localPath(typeof v.p === 'string' ? v.p : null);
  } catch {
    // Unreadable (old shape, private mode): fall through to the tab's own copy.
  }
  const old = localPath(sessionStorage.getItem(OLD_KEY));
  sessionStorage.removeItem(OLD_KEY);
  return out ?? old;
}

/** Without taking it: where "back" on the sign-in screen should go. */
export function peekReturn(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { p?: unknown } | null;
    return localPath(typeof v?.p === 'string' ? v.p : null) ?? localPath(sessionStorage.getItem(OLD_KEY));
  } catch {
    return localPath(sessionStorage.getItem(OLD_KEY));
  }
}

/** "/sign-in?next=<here>": the sign-in page, coming back to `path` (default: this page). */
export const signInPath = (path: string = herePath()) => {
  const p = localPath(path);
  return p && p !== '/' && !isAuthPage(p) ? `/sign-in?next=${encodeURIComponent(p)}` : '/sign-in';
};
