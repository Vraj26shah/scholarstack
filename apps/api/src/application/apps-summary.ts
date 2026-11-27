import { type AppsSummaryDto, campusClock } from '@ss/contracts';
import type {
  MessOrderRepository,
  MessRepository,
  OwnerLoginRepository,
  PushRepository,
} from '../domain/campus-ports';
import type { Clock } from '../domain/ports';

const DAY = 86_400_000;
const SOLD = new Set(['accepted', 'ready', 'done']);

/** Admin's one look at the apps and restaurants: owner sign-ins, devices, orders and takings. */
export async function appsSummary(p: {
  messes: MessRepository;
  orders: MessOrderRepository;
  owners: OwnerLoginRepository;
  push: PushRepository;
  clock: Clock;
}): Promise<AppsSummaryDto> {
  const now = p.clock.now();
  const today = campusClock(now).date;
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const yearStart = new Date(`${year}-01-01T00:00:00+05:30`);
  const [messes, orders, owners, devices] = await Promise.all([
    p.messes.list(),
    p.orders.listSince(yearStart, 50_000),
    p.owners.list(),
    p.push.listAll(),
  ]);
  const restaurants = messes.filter((m) => m.kind === 'restaurant');
  const ownerEmails = new Set(restaurants.flatMap((m) => m.ownerEmails));
  const sold = orders.filter((o) => SOLD.has(o.status));
  const dayOf = (d: Date) => campusClock(d).date;
  const sum = (list: typeof orders) => list.reduce((n, o) => n + o.total, 0);
  const todays = sold.filter((o) => dayOf(o.createdAt) === today);
  const months = sold.filter((o) => dayOf(o.createdAt).startsWith(month));
  return {
    owners: {
      total: owners.length,
      withPin: owners.filter((o) => !!o.pinHash).length,
      locked: owners.filter((o) => o.lockedUntil && o.lockedUntil > now).length,
      signedInThisWeek: owners.filter(
        (o) => o.lastLoginAt && now.getTime() - o.lastLoginAt.getTime() < 7 * DAY,
      ).length,
    },
    devices: {
      website: devices.filter((d) => !d.endpoint.startsWith('fcm:')).length,
      apps: devices.filter((d) => d.endpoint.startsWith('fcm:')).length,
      ownersReachable: devices.filter((d) => d.email && ownerEmails.has(d.email)).length,
    },
    restaurants: { total: restaurants.length, openNow: restaurants.filter((m) => m.ordersOpen).length },
    orders: {
      today: todays.length,
      todayRevenue: sum(todays),
      month: months.length,
      monthRevenue: sum(months),
      year: sold.length,
      yearRevenue: sum(sold),
      customersThisYear: new Set(sold.map((o) => o.userId)).size,
    },
    byRestaurant: restaurants
      .map((m) => {
        const mine = sold.filter((o) => o.messSlug === m.slug);
        return { slug: m.slug, name: m.name, open: m.ordersOpen, orders: mine.length, revenue: sum(mine) };
      })
      .sort((a, b) => b.revenue - a.revenue),
  };
}
