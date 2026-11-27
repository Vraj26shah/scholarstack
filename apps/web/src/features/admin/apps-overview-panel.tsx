import { formatMobile, isOwnerAddress } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { rupees } from '../restaurant/shared';
import { AppSwitches } from './app-switches';
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
  // Who runs each restaurant, and how their Partner app sign-in stands: nothing hidden from the admin.
  const messes = useQuery({ queryKey: ['admin-messes'], queryFn: api.adminMesses });
  const logins = useQuery({ queryKey: ['admin-owner-logins'], queryFn: api.adminOwnerLogins });
  return (
    <Panel title="Apps & restaurants">
      <Note>
        Every browser, phones included, gets the website; the student app is the Android download, and
        restaurant owners use the Partner app at <code>/partner</code>. Takings count accepted, ready and
        delivered orders (Indian time).
      </Note>
      <AppSwitches />
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
                  <RestaurantRow
                    key={r.slug}
                    row={r}
                    owners={messes.data?.find((m) => m.slug === r.slug)?.ownerEmails ?? null}
                    logins={logins.data?.owners ?? []}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Panel>
  );
}

type Row = { slug: string; name: string; open: boolean; orders: number; revenue: number };
type Login = {
  phone: string;
  name: string;
  email: string;
  hasPin: boolean;
  setupUntil: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
};

/** One restaurant for the admin: takings, who can open it and how their sign-in stands, and links in. */
function RestaurantRow({ row: r, owners, logins }: { row: Row; owners: string[] | null; logins: Login[] }) {
  const now = Date.now();
  const state = (l: Login | undefined) =>
    !l
      ? 'email sign-in'
      : l.lockedUntil && Date.parse(l.lockedUntil) > now
        ? 'locked (wrong PINs)'
        : l.hasPin
          ? `PIN set · last sign-in ${l.lastLoginAt ? new Date(l.lastLoginAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'never'}`
          : l.setupUntil && Date.parse(l.setupUntil) > now
            ? 'setup code waiting'
            : 'no PIN yet: give a setup code';
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-semibold truncate">{r.name}</span>
          <span className="block text-[13px] text-ink2">
            {r.open ? 'Taking orders' : 'Closed'} · {r.orders} orders
          </span>
        </span>
        <span className="flex-none font-display text-[20px] font-bold tabular-nums">{rupees(r.revenue)}</span>
      </div>
      {owners && owners.length === 0 && (
        <p className="m-0 rounded-lg bg-marigold-soft px-3 py-2 text-[13px] font-semibold text-marigold-text">
          Nobody can open this restaurant yet. Add the owner in Owner logins.
        </p>
      )}
      {owners && owners.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[13px]">
          {owners.map((e) => {
            const login = logins.find((l) => l.email === e);
            return (
              <li key={e} className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-ink">
                  {login
                    ? `${login.name ? `${login.name} · ` : ''}${formatMobile(login.phone)}`
                    : isOwnerAddress(e)
                      ? formatMobile(e.slice(1, 11))
                      : e}
                </span>
                <span className="text-ink2">{state(login)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/orders?mess=${r.slug}`}
          className="inline-flex items-center h-8 px-3 rounded-full border border-line text-[13px] font-semibold text-ink no-underline hover:border-ink2"
        >
          Orders
        </Link>
        <Link
          to={`/orders?mess=${r.slug}&tab=insights`}
          className="inline-flex items-center h-8 px-3 rounded-full border border-line text-[13px] font-semibold text-ink no-underline hover:border-ink2"
        >
          Sales
        </Link>
        <Link
          to="/admin?section=owner-logins"
          className="inline-flex items-center h-8 px-3 rounded-full border border-line text-[13px] font-semibold text-ink no-underline hover:border-ink2"
        >
          Owners
        </Link>
      </div>
    </li>
  );
}
