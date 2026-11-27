import { useQuery } from '@tanstack/react-query';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { rupees } from '../restaurant/shared';
import { Figure, Note, Panel } from './ui';

const grid =
  'grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)]';

/** Admin › Campus › Apps & restaurants: the student app, the Partner app and every restaurant at a glance. */
export function AppsOverviewPanel() {
  const q = useQuery({
    queryKey: ['admin-apps-summary'],
    queryFn: api.adminAppsSummary,
    refetchInterval: 60_000,
  });
  return (
    <Panel title="Apps & restaurants">
      <Note>
        Phones open the website as the student app; restaurant owners use the Partner app at{' '}
        <code>/partner</code>. Takings count accepted, ready and delivered orders (Indian time).
      </Note>
      {q.isError ? (
        <ErrorState
          title="The overview didn't load."
          message={friendly(q.error)}
          onRetry={() => q.refetch()}
        />
      ) : !q.data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <section className={grid}>
            <Figure
              label="TODAY"
              value={rupees(q.data.orders.todayRevenue)}
              hint={`${q.data.orders.today} orders`}
              tone="teal"
            />
            <Figure
              label="THIS MONTH"
              value={rupees(q.data.orders.monthRevenue)}
              hint={`${q.data.orders.month} orders`}
            />
            <Figure
              label="THIS YEAR"
              value={rupees(q.data.orders.yearRevenue)}
              hint={`${q.data.orders.year} orders`}
            />
            <Figure
              label="CUSTOMERS THIS YEAR"
              value={String(q.data.orders.customersThisYear)}
              hint="different students who ordered"
            />
          </section>
          <section className={grid}>
            <Figure
              label="RESTAURANTS"
              value={String(q.data.restaurants.total)}
              hint={`${q.data.restaurants.openNow} taking orders now`}
            />
            <Figure
              label="OWNER LOGINS"
              value={String(q.data.owners.total)}
              hint={`${q.data.owners.withPin} with a PIN · ${q.data.owners.signedInThisWeek} signed in this week${q.data.owners.locked ? ` · ${q.data.owners.locked} locked` : ''}`}
              tone={q.data.owners.locked ? 'marigold' : 'ink'}
            />
            <Figure
              label="APP DEVICES"
              value={String(q.data.devices.apps)}
              hint="Android apps getting notifications"
            />
            <Figure
              label="WEBSITE DEVICES"
              value={String(q.data.devices.website)}
              hint={`browsers getting notifications · ${q.data.devices.ownersReachable} owner devices`}
            />
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[15px] font-bold">Restaurants this year</h3>
            {q.data.byRestaurant.length === 0 ? (
              <Note>No restaurants yet.</Note>
            ) : (
              <ul className="m-0 p-0 list-none">
                {q.data.byRestaurant.map((r) => (
                  <li
                    key={r.slug}
                    className="flex items-center justify-between gap-3 border-b border-line py-3"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{r.name}</span>
                      <span className="block text-[13px] text-ink2">
                        {r.open ? 'Taking orders' : 'Closed'} · {r.orders} orders
                      </span>
                    </span>
                    <span className="flex-none font-display text-[20px] font-bold tabular-nums">
                      {rupees(r.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Panel>
  );
}
