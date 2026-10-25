import type { AdminOverviewDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { GROUPS, findView } from './admin-sections';
import { Note } from './ui';

/** Small counts on the groups that need you: pages to make, people waiting, problems. */
function useBadges(enabled: boolean, o?: AdminOverviewDto) {
  const support = useQuery({
    queryKey: ['admin', 'support', 'open'],
    queryFn: () => api.adminSupport('open'),
    refetchInterval: 60_000,
    enabled,
  });
  const uploads = useQuery({
    queryKey: ['admin', 'contributions', 'pending'],
    queryFn: () => api.adminContributions('pending'),
    refetchInterval: 60_000,
    enabled,
  });
  const waiting = (support.data?.counts.open ?? 0) + (uploads.data?.items.length ?? 0);
  return {
    notes: o && o.files.waiting + o.files.working ? o.files.waiting + o.files.working : 0,
    inbox: waiting,
    storage: o?.files.failed ?? 0,
    queries: support.data?.counts.open ?? 0,
    contributions: uploads.data?.items.length ?? 0,
  } as Record<string, number>;
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
  const badges = useBadges(!!me?.isAdmin, o);
  if (me && !me.isAdmin) return <Navigate to="/" replace />;
  const go = (key: string) => setParams({ section: key });

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
            className="flex gap-1 overflow-x-auto [scrollbar-width:none] border-b border-line"
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
                  className={`-mb-px flex min-h-12 shrink-0 items-center gap-2 border-b-[3px] px-4 text-[15px] transition-colors ${
                    selected
                      ? 'border-teal font-semibold text-ink'
                      : 'border-transparent font-medium text-ink2 hover:text-ink'
                  }`}
                >
                  {g.label}
                  {n > 0 && (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-marigold text-on-marigold text-[11px] font-bold inline-flex items-center justify-center tabular-nums">
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {group.views.length > 1 && (
            <div role="tablist" aria-label={`${group.label} views`} className="flex flex-wrap gap-2">
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
                    className={`h-9 rounded-full px-3.5 text-[14px] font-semibold border inline-flex items-center gap-1.5 ${
                      selected
                        ? 'bg-brand text-white border-brand'
                        : 'border-line text-ink2 hover:text-ink hover:border-ink2'
                    }`}
                  >
                    {v.label}
                    {n > 0 && (
                      <span className={`tabular-nums ${selected ? 'text-mist' : 'text-marigold-text'}`}>
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <Note>{view.note}</Note>
        </nav>

        <div id="admin-panel" role="tabpanel" aria-label={view.label}>
          {view.render(go)}
        </div>
      </div>
    </Page>
  );
}
