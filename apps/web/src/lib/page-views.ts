import { ACTIVITY_ACTIONS, type ActivityAction } from '@ss/contracts';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { resetPageSignals, setActionSink, signal } from './analytics';
import { api } from './api';
import { noteArrival, noteSignIn } from './campaign';
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
/** An element that does something when tapped (so repeated taps on it are not "stuck"). */
const LIVE =
  'a[href],button:not(:disabled),input:not(:disabled),select,textarea,label,summary,[role="button"],[role="tab"],[role="option"],[role="radio"],[role="checkbox"],[contenteditable="true"]';

/**
 * Taps 4+ times on the same spot within 1.2 s, on something that does nothing (or a disabled
 * button): the visitor expected it to work. Text selection (triple-click) doesn't count.
 */
function watchRageTaps() {
  let taps: { x: number; y: number; t: number }[] = [];
  const onClick = (e: MouseEvent) => {
    const el = e.target as Element | null;
    if (!el || el.closest(LIVE)) {
      taps = [];
      return;
    }
    const now = e.timeStamp;
    taps = [
      ...taps.filter((p) => now - p.t < 1200 && Math.hypot(p.x - e.clientX, p.y - e.clientY) < 30),
      { x: e.clientX, y: e.clientY, t: now },
    ];
    if (taps.length >= 4 && !window.getSelection()?.toString()) {
      taps = [];
      signal('stuck_rage');
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

/** On a tool page: the first tap or typing inside the page's content counts the tool as "used". */
function watchToolUse(pathname: string) {
  if (!pathname.startsWith('/tools/')) return () => {};
  const used = (e: Event) => {
    const el = e.target as Element | null;
    const main = document.getElementById('main') ?? document.querySelector('main');
    // The tool's own header (title, "Something not working?") isn't using the tool.
    if (!el || !main?.contains(el) || el.closest('[data-tool-header]')) return;
    // "Back to toolbox" and other links away are leaving, not using.
    if (el.closest('a[href]') && !el.closest('a[href^="#"]')) return;
    if (e.type === 'pointerdown' && !el.closest(LIVE)) return;
    signal('tool_used');
    stop();
  };
  const stop = () => {
    document.removeEventListener('pointerdown', used, true);
    document.removeEventListener('keydown', used, true);
  };
  document.addEventListener('pointerdown', used, true);
  document.addEventListener('keydown', used, true);
  return stop;
}
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

  useEffect(watchRageTaps, []);
  useEffect(() => {
    resetPageSignals();
    return watchToolUse(pathname);
  }, [pathname]);

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
    const first = last.current === null;
    last.current = pathname;
    void api.beacon('/insights/hit', { kind: 'page', path: pathname });
    // Landed from a tagged link (a WhatsApp group, an Instagram post, a poster): which one.
    const from = first ? noteArrival(location.search) : null;
    if (from) void api.beacon('/insights/hit', { kind: 'source', step: 'arrived', ...from, path: pathname });
  }, [pathname, status, me?.isAdmin]);

  useEffect(() => {
    // Signed in (now, or already when the page opened) after arriving from a tagged link: credit
    // that link with a sign-in, once.
    if (status !== 'ready' || !me || me.isAdmin) return;
    const from = noteSignIn();
    if (from)
      void api.beacon('/insights/hit', {
        kind: 'source',
        step: 'signed_in',
        ...from,
        path: location.pathname,
      });
  }, [status, me?.isAdmin, me]);
}
