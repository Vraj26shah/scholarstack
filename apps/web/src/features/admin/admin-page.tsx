import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { RefreshFailed } from '../../shared/ui/feedback';
import { useSectionSwipe } from '../../shared/ui/swipe';
import { SwipeHint } from '../../shared/ui/swipe-hint';
import { GROUPS, findView } from './admin-sections';
import { Note } from './ui';

const SEEN = 'ss-admin-seen';
const readSeen = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

/**
 * Counts on the tabs, from the same check the Today screen uses. A tab shows what is new since
 * it was last opened: opening it clears its badge (and its section's), and the badge comes back
 * only when more arrives. Today keeps the full list of everything still waiting.
 */
function useBadges(enabled: boolean, openView: string) {
  const today = useQuery({
    queryKey: ['admin-today'],
    queryFn: api.adminToday,
    // Counts follow the work: refreshed after every change, every 20 s, and on return to the tab.
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    enabled,
  });
  const [seen, setSeen] = useState(readSeen);
  const n = (key: string) => today.data?.items.find((i) => i.key === key)?.count ?? 0;
  // Opening a view marks its items seen at today's counts; a count that went down is re-based so
  // the next new item shows again.
  const keysOpen = GROUPS.flatMap((g) => g.views)
    .filter((v) => v.key === openView)
    .flatMap((v) => v.badge ?? []);
  const sig = today.data
    ? [...new Set(Object.keys(seen)), ...keysOpen].map((k) => `${k}:${n(k)}`).join()
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: sig stands for the counts and the open view.
  useEffect(() => {
    if (!today.data) return;
    setSeen((old) => {
      const next = { ...old };
      for (const k of Object.keys(next)) if (n(k) < (next[k] ?? 0)) next[k] = n(k);
      for (const k of keysOpen) next[k] = n(k);
      try {
        localStorage.setItem(SEEN, JSON.stringify(next));
      } catch {
        // private mode: badges just reset next visit
      }
      return next;
    });
  }, [sig, openView]);
  const fresh = (k: string) => Math.max(0, n(k) - (seen[k] ?? 0));
  const out: Record<string, number> = {};
  for (const g of GROUPS) {
    for (const v of g.views) out[v.key] = (v.badge ?? []).reduce((sum, k) => sum + fresh(k), 0);
    // A section counts each kind once, even when two of its views share it.
    out[g.key] = [...new Set(g.views.flatMap((v) => v.badge ?? []))].reduce((sum, k) => sum + fresh(k), 0);
  }
  out.today = today.data?.items.filter((i) => (i.count ?? 0) > 0).length ?? 0;
  return out;
}

/** An admin list whose last refresh failed while its earlier result is still on screen. */
const staleFailed = (q: Query) =>
  String(q.queryKey[0]).startsWith('admin') && q.state.status === 'error' && q.state.data !== undefined;

/**
 * One calm line when a refresh failed but the screen still shows what it had (a busy moment on
 * the server). Nothing is wiped; it keeps trying by itself every few seconds and on "Try again".
 */
function StaleNotice() {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const [failed, setFailed] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let live = true;
    // Cache events can fire while another screen renders; count after it, never during.
    const count = () =>
      queueMicrotask(() => {
        if (live) setFailed(cache.findAll({ predicate: staleFailed, type: 'active' }).length);
      });
    count();
    const stop = cache.subscribe(count);
    return () => {
      live = false;
      stop();
    };
  }, [cache]);
  const retry = async () => {
    setRetrying(true);
    try {
      await qc.refetchQueries({ predicate: staleFailed, type: 'active' });
    } finally {
      setRetrying(false);
    }
  };
  // Try again quietly after a short pause; most hiccups are over by then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm only when the count changes.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => void retry(), 4_000);
    return () => clearTimeout(t);
  }, [failed]);
  if (!failed) return null;
  return <RefreshFailed what="part of this screen" onRetry={() => void retry()} retrying={retrying} />;
}

export function AdminPage() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const { group, view } = findView(params.get('section') ?? params.get('tab') ?? params.get('step'));
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: api.adminOverview,
    refetchInterval: 10_000,
    enabled: !!me?.isAdmin,
  });
  const o = overview.data;
  const badges = useBadges(!!me?.isAdmin, view.key);
  // Phones: swipe through every view in order, like the tabs of a phone app.
  const order = GROUPS.flatMap((g) => g.views.map((v) => v.key));
  const at = order.indexOf(view.key);
  useSectionSwipe({
    enabled: !!me?.isAdmin,
    target: 'admin-panel',
    ...(at < order.length - 1 ? { onNext: () => setParams({ section: order[at + 1]! }) } : {}),
    ...(at > 0 ? { onPrev: () => setParams({ section: order[at - 1]! }) } : {}),
  });
  // Keep the chosen tabs in sight on a phone, where the rows scroll sideways.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the chosen view changes.
  useEffect(() => {
    for (const sel of ['[aria-label="Admin sections"]', `[aria-label="${group.label} views"]`])
      document
        .querySelector(`${sel} [aria-selected="true"]`)
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [group.label, view.key]);
  if (me && !me.isAdmin) return <Navigate to="/" replace />;
  // "folders?pages=1" opens a view with its own options.
  const go = (key: string) => {
    const [section, extra] = key.split('?');
    setParams({ section: section!, ...Object.fromEntries(new URLSearchParams(extra ?? '')) });
  };

  return (
    <Page wide>
      <div className="flex flex-col gap-6 pt-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="m-0 font-display text-[40px] font-extrabold leading-none tracking-[-0.045em]">
            Admin
          </h1>
          {o && (
            <p className="m-0 text-[14px] text-ink2">
              <strong className="text-ink tabular-nums">{o.courses.live}</strong> courses on sale ·{' '}
              <strong className="text-ink tabular-nums">{o.files.ready}</strong> files readable
              {o.courses.readyToPublish > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <button
                    type="button"
                    onClick={() => go('courses')}
                    className="font-semibold text-teal-text underline decoration-2 underline-offset-4"
                  >
                    {o.courses.readyToPublish} ready to publish
                  </button>
                </>
              )}
            </p>
          )}
        </header>

        <nav aria-label="Admin" className="flex flex-col gap-3">
          <div
            role="tablist"
            aria-label="Admin sections"
            data-swipe-through
            className="flex gap-1 overflow-x-auto [scrollbar-width:none] border-b border-line -mx-5 px-5 sm:mx-0 sm:px-0 max-sm:[mask-image:linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)]"
          >
            {GROUPS.map((g) => {
              const n = badges[g.key] ?? 0;
              const selected = g.key === group.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="admin-panel"
                  onClick={() => go(g.views[0]!.key)}
                  className={`-mb-px flex min-h-12 shrink-0 items-center gap-2 border-b-[3px] px-3 sm:px-4 text-[15px] transition-colors ${
                    selected
                      ? 'border-teal font-semibold text-ink'
                      : 'border-transparent font-medium text-ink2 hover:text-ink'
                  }`}
                >
                  {g.label}
                  {n > 0 && (
                    <span
                      aria-hidden="true"
                      title={`${n} need${n === 1 ? 's' : ''} you`}
                      className="min-w-5 h-5 px-1.5 rounded-full bg-marigold text-on-marigold text-[11px] font-bold inline-flex items-center justify-center tabular-nums"
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {group.views.length > 1 && (
            <div
              role="tablist"
              aria-label={`${group.label} views`}
              data-swipe-through
              className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-5 px-5 sm:mx-0 sm:px-0 sm:flex-wrap"
            >
              {group.views.map((v) => {
                const n = badges[v.key] ?? 0;
                const selected = v.key === view.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => go(v.key)}
                    className={`h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold border inline-flex items-center gap-1.5 ${
                      selected
                        ? 'bg-brand text-white border-brand'
                        : 'border-line text-ink2 hover:text-ink hover:border-ink2'
                    }`}
                  >
                    {v.label}
                    {n > 0 && (
                      <span
                        aria-hidden="true"
                        title={`${n} need${n === 1 ? 's' : ''} you`}
                        className={`tabular-nums ${selected ? 'text-mist' : 'text-marigold-text'}`}
                      >
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <Note>{view.note}</Note>
          <SwipeHint id="admin-views">Swipe sideways for the next screen</SwipeHint>
        </nav>

        <div id="admin-panel" role="tabpanel" aria-label={view.label} className="flex flex-col gap-3">
          <StaleNotice />
          {view.render(go)}
        </div>
      </div>
    </Page>
  );
}
