import { useEffect } from 'react';
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
