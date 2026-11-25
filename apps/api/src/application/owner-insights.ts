import { type InsightPeriod, type InsightTotalsDto, type OwnerInsightsDto, campusClock } from '@ss/contracts';
import type { MessOrderRecord, MessViewRecord } from '../domain/campus-ports';

// A restaurant's own numbers for a day, week, month or year, in campus time (IST). Everything is
// worked out from its orders and page views, so the owner sees exactly what happened.

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SOLD: MessOrderRecord['status'][] = ['accepted', 'ready', 'done'];

/** "2026-11-25" + n days. */
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
/** The moment a campus day starts. */
const startOf = (date: string) => new Date(`${date}T00:00:00+05:30`);
const fmtDay = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The first and last campus day of the period holding `anchor`, and the period's name. */
export function periodRange(period: InsightPeriod, anchor: string) {
  if (period === 'day')
    return {
      from: anchor,
      to: anchor,
      label: `${WEEKDAYS[weekday(anchor)]} ${fmtDay(anchor)} ${anchor.slice(0, 4)}`,
      prev: addDays(anchor, -1),
      next: addDays(anchor, 1),
    };
  if (period === 'week') {
    const from = addDays(anchor, -weekday(anchor));
    const to = addDays(from, 6);
    return {
      from,
      to,
      label: `${fmtDay(from)} – ${fmtDay(to)} ${to.slice(0, 4)}`,
      prev: addDays(from, -7),
      next: addDays(from, 7),
    };
  }
  if (period === 'month') {
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(5, 7));
    const from = `${anchor.slice(0, 7)}-01`;
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const prevMonth = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
    return {
      from,
      to: addDays(nextMonth, -1),
      label: `${MONTHS_LONG[m - 1]} ${y}`,
      prev: prevMonth,
      next: nextMonth,
    };
  }
  const y = Number(anchor.slice(0, 4));
  return {
    from: `${y}-01-01`,
    to: `${y}-12-31`,
    label: String(y),
    prev: `${y - 1}-01-01`,
    next: `${y + 1}-01-01`,
  };
}

const median = (xs: number[]) => {
  if (xs.length < 3) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
};

/** Codes and deals by name (orders, rupees given away, takings), then combos (orders, takings). */
function offerUse(sold: MessOrderRecord[]): OwnerInsightsDto['offers'] {
  const by = new Map<string, OwnerInsightsDto['offers'][number]>();
  const add = (label: string, discount: number, revenue: number) => {
    const r = by.get(label) ?? { label, orders: 0, discount: 0, revenue: 0 };
    r.orders += 1;
    r.discount += discount;
    r.revenue += revenue;
    by.set(label, r);
  };
  for (const o of sold) {
    if (o.offer && o.discount) add(o.offer, o.discount, o.total);
    for (const l of o.lines) if (l.name.endsWith(' (combo)')) add(l.name, 0, l.qty * l.price);
  }
  return [...by.values()].sort((a, b) => b.orders - a.orders);
}

function totals(
  orders: MessOrderRecord[],
  views: MessViewRecord[],
  /** Accounts that had ordered here before this period (for "new" customers and "past customers visiting"). */
  earlierCustomers: Set<string>,
  everCustomers: Set<string>,
): InsightTotalsDto {
  const sold = orders.filter((o) => SOLD.includes(o.status));
  const revenue = sold.reduce((n, o) => n + o.total, 0);
  const customers = new Set(orders.map((o) => o.userId));
  const visitors = new Set(views.map((v) => v.visitor));
  const signedIn = new Set(views.filter((v) => v.userId).map((v) => v.userId!));
  const replies = orders
    .filter((o) => o.chat.respondedAt)
    .map((o) => (o.chat.respondedAt!.getTime() - o.createdAt.getTime()) / 60_000);
  const m = median(replies);
  return {
    orders: orders.length,
    confirmed: sold.length,
    revenue,
    avgOrder: sold.length ? Math.round(revenue / sold.length) : 0,
    cancelledByStudent: orders.filter((o) => o.status === 'cancelled' && o.chat.endedBy === 'student').length,
    cancelledByYou: orders.filter((o) => o.status === 'rejected').length,
    autoCancelled: orders.filter((o) => o.status === 'cancelled' && o.chat.endedBy !== 'student').length,
    waiting: orders.filter((o) => o.status === 'placed').length,
    customers: customers.size,
    newCustomers: [...customers].filter((u) => !earlierCustomers.has(u)).length,
    views: views.reduce((n, v) => n + v.views, 0),
    visitors: visitors.size,
    signedInVisitors: signedIn.size,
    pastCustomersVisiting: [...signedIn].filter((u) => everCustomers.has(u)).length,
    conversion: visitors.size ? Math.min(100, Math.round((customers.size / visitors.size) * 100)) : null,
    replyMinutes: m === null ? null : Math.max(1, Math.round(m)),
  };
}

/**
 * The insights for `period` around `anchor`. `orders` must reach back a year before the previous
 * period (to tell new customers from returning ones); `views` must cover both periods.
 */
export function computeInsights(input: {
  period: InsightPeriod;
  anchor: string;
  now: Date;
  orders: MessOrderRecord[];
  views: MessViewRecord[];
}): OwnerInsightsDto {
  const { period, anchor, now, orders, views } = input;
  const r = periodRange(period, anchor);
  const p = periodRange(period, r.prev);
  const today = campusClock(now).date;
  const inRange = (from: string, to: string) => (o: MessOrderRecord) =>
    o.createdAt >= startOf(from) && o.createdAt < startOf(addDays(to, 1));
  const cur = orders.filter(inRange(r.from, r.to));
  const before = orders.filter(inRange(p.from, p.to));
  const customersBefore = (from: string) =>
    new Set(orders.filter((o) => o.createdAt < startOf(from)).map((o) => o.userId));
  const ever = new Set(orders.filter((o) => o.createdAt < startOf(addDays(r.to, 1))).map((o) => o.userId));
  const viewsIn = (from: string, to: string) => views.filter((v) => v.day >= from && v.day <= to);

  // The buckets of the chart.
  const local = (o: MessOrderRecord) => campusClock(o.createdAt);
  type Bucket = OwnerInsightsDto['series'][number];
  const series: Bucket[] = [];
  const bucket = (key: string, label: string): Bucket => ({
    key,
    label,
    orders: 0,
    revenue: 0,
    visitors: 0,
    views: 0,
  });
  let keyOf: (o: MessOrderRecord) => string;
  if (period === 'day') {
    for (let h = 0; h < 24; h++) series.push(bucket(String(h), `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`));
    keyOf = (o) => String(Math.floor(local(o).minutes / 60));
  } else if (period === 'year') {
    for (let m = 0; m < 12; m++)
      series.push(bucket(`${r.from.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`, MONTHS[m]!));
    keyOf = (o) => local(o).date.slice(0, 7);
  } else {
    for (let d = r.from; d <= r.to; d = addDays(d, 1))
      series.push(
        bucket(
          d,
          period === 'week' ? `${WEEKDAYS[weekday(d)]} ${Number(d.slice(8))}` : String(Number(d.slice(8))),
        ),
      );
    keyOf = (o) => local(o).date;
  }
  const byKey = new Map(series.map((b) => [b.key, b]));
  for (const o of cur) {
    const b = byKey.get(keyOf(o));
    if (!b) continue;
    b.orders += 1;
    if (SOLD.includes(o.status)) b.revenue += o.total;
  }
  // Views are counted per day, so a day's chart has no hourly views (the totals still have them).
  if (period !== 'day') {
    const seen = new Map<string, Set<string>>();
    for (const v of viewsIn(r.from, r.to)) {
      const k = period === 'year' ? v.day.slice(0, 7) : v.day;
      const b = byKey.get(k);
      if (!b) continue;
      b.views += v.views;
      const s = seen.get(k) ?? new Set<string>();
      s.add(v.visitor);
      seen.set(k, s);
    }
    for (const [k, s] of seen) byKey.get(k)!.visitors = s.size;
  }

  const dishes = new Map<string, { name: string; qty: number; revenue: number; orders: number }>();
  for (const o of cur.filter((x) => SOLD.includes(x.status)))
    for (const l of o.lines) {
      const d = dishes.get(l.name.toLowerCase()) ?? { name: l.name, qty: 0, revenue: 0, orders: 0 };
      d.qty += l.qty;
      d.revenue += l.qty * l.price;
      d.orders += 1;
      dishes.set(l.name.toLowerCase(), d);
    }
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const o of cur) {
    const c = local(o);
    hours[Math.floor(c.minutes / 60)]! += 1;
    weekdays[c.day]! += 1;
  }
  const people = new Map<string, { name: string; orders: number; spent: number }>();
  for (const o of [...cur].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const p0 = people.get(o.userId) ?? { name: o.name, orders: 0, spent: 0 };
    p0.name = o.name || p0.name;
    p0.orders += 1;
    if (SOLD.includes(o.status)) p0.spent += o.total;
    people.set(o.userId, p0);
  }

  return {
    period,
    from: r.from,
    to: r.to,
    label: r.label,
    prevAnchor: r.prev,
    // Nothing to see after today.
    nextAnchor: r.next <= today ? r.next : null,
    totals: totals(cur, viewsIn(r.from, r.to), customersBefore(r.from), ever),
    previous: totals(before, viewsIn(p.from, p.to), customersBefore(p.from), ever),
    series,
    topDishes: [...dishes.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10),
    hours,
    weekdays,
    modes: {
      delivery: cur.filter((o) => o.mode === 'delivery').length,
      pickup: cur.filter((o) => o.mode === 'pickup').length,
    },
    topCustomers: [...people.values()].sort((a, b) => b.spent - a.spent || b.orders - a.orders).slice(0, 5),
    offers: offerUse(cur.filter((o) => SOLD.includes(o.status))),
  };
}
