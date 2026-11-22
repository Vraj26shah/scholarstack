import { ACTIVITY_ACTIONS, type ActivityAction } from '@ss/contracts';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { setActionSink } from './analytics';
import { api } from './api';
import { env } from './env';
import { useSession } from './session';

/** Each course or bundle is counted once per browser tab, so refreshing doesn't add views. */
const seen = new Set<string>();
const SEEN_KEY = 'ss_views_seen';

function alreadySeen(key: string): boolean {
  if (seen.has(key)) return true;
  seen.add(key);
  try {
    const list = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    if (list.includes(key)) return true;
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...list, key].slice(-200)));
  } catch {
    // Private windows and blocked storage: the in-memory set still stops repeats on this page.
  }
  return false;
}

/**
 * Counts one view of this course or bundle page for Admin › Insights. Only the item and whether
 * someone is signed in are sent, never who. Admins are not counted. Never blocks or breaks the page.
 */
export function useCountView(item: { courseId: string } | { bundleId: string } | null) {
  const { status, me } = useSession();
  const id = item ? ('courseId' in item ? `c:${item.courseId}` : `b:${item.bundleId}`) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `id` stands for `item` (a new object each render).
  useEffect(() => {
    if (!item || !id || status === 'loading' || me?.isAdmin || alreadySeen(id)) return;
    const body = JSON.stringify({ ...item, signedIn: status === 'ready' });
    fetch(`${env.apiBase.replace(/\/+$/, '')}/insights/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {});
  }, [id, status, me?.isAdmin]);
}

const ACTIONS = new Set<string>(ACTIVITY_ACTIONS);
/** False for admins (never counted) and until the session is known. */
let recording = false;

/**
 * Admin › Insights and each student's Activity: every page opened (by route) and the actions in
 * ACTIVITY_ACTIONS. A signed-in student is identified by their sign-in token on the server; a
 * visitor is counted with all visitors. Admins aren't counted. Mounted once, in the app shell.
 */
export function usePageActivity() {
  const { pathname } = useLocation();
  const { status, me } = useSession();
  const last = useRef<string | null>(null);
  recording = status !== 'loading' && !me?.isAdmin;

  useEffect(() => {
    setActionSink((name) => {
      if (recording && ACTIONS.has(name))
        void api.beacon('/insights/hit', {
          kind: 'action',
          name: name as ActivityAction,
          path: location.pathname,
        });
    });
  }, []);

  useEffect(() => {
    // Wait until we know who is looking; then one hit per page visit (signing in on a page
    // doesn't count it again).
    if (status === 'loading' || me?.isAdmin || pathname.startsWith('/admin')) return;
    if (last.current === pathname) return;
    last.current = pathname;
    void api.beacon('/insights/hit', { kind: 'page', path: pathname });
  }, [pathname, status, me?.isAdmin]);
}
