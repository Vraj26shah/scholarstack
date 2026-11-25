import { type OrderEndedBy, bestDiscount, campusClock } from '@ss/contracts';
import { EMPTY_CHAT_STATE, type MessRecord } from '../domain/campus-ports';
import type { MemoryMessOrders, MemoryMessViews } from '../infrastructure/campus-memory';

// DEMO SITE ONLY. Three months of made-up past orders and page visits for the demo restaurant, so
// the owner's Insights, Customers and Offers can be shown with real-looking numbers. Every order
// is finished (nothing appears on the live order board) and everything is invented: names,
// numbers, addresses. Never used by the live site or the tests.

const NAMES = [
  'Aarav',
  'Ananya',
  'Ishaan',
  'Diya',
  'Kabir',
  'Meera',
  'Rohan',
  'Saanvi',
  'Vihaan',
  'Aditi',
  'Arjun',
  'Priya',
  'Karan',
  'Sneha',
  'Nikhil',
  'Pooja',
  'Rahul',
  'Tanvi',
  'Yash',
  'Riya',
  'Aryan',
  'Kavya',
  'Dev',
  'Nisha',
  'Siddharth',
  'Anjali',
  'Harsh',
  'Shreya',
  'Manav',
  'Neha',
  'Aditya',
  'Ira',
  'Varun',
  'Simran',
  'Om',
  'Khushi',
  'Parth',
  'Avni',
  'Laksh',
  'Mahi',
];
const PLACES = ['Block A', 'Block B', 'Block C', 'Block D', 'Girls hostel 1', 'Girls hostel 2'];

/** A small seeded random generator: the same history every time the demo starts. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function seedDemoHistory(
  mess: MessRecord,
  orders: MemoryMessOrders,
  views: MemoryMessViews,
  now: Date,
  days = 92,
) {
  const rand = rng(2026);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const items = mess.order
    .flatMap((s) => s.items)
    .filter((i) => i.available !== false && !/tiffin/i.test(i.name));
  if (!items.length) return;
  // Some dishes sell far more than others, like a real menu.
  const weighted = items.flatMap((i, n) =>
    Array.from({ length: /thali/i.test(i.name) ? 8 : Math.max(1, 5 - (n % 5)) }, () => i),
  );
  const people = NAMES.map((name, n) => ({
    userId: `demo-student-${n}`,
    email: `${name.toLowerCase()}.${23 + (n % 3)}bce${10000 + n * 37}@vitbhopal.ac.in`,
    name,
    phone: `9${String(800000000 + n * 1234567).slice(0, 9)}`,
    place: `${pick(PLACES)}, room ${100 + Math.floor(rand() * 300)}`,
    // Regulars order often; most come now and then.
    loyalty: n < 8 ? 0.35 : n < 20 ? 0.12 : 0.04,
  }));
  const today = campusClock(now).date;
  const rows: typeof orders.rows = [];
  const seenBefore = new Set<string>();
  for (let back = days; back >= 1; back--) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    // Busier at weekends and as more students find the page.
    const growth = 0.6 + 0.4 * ((days - back) / days);
    const visitors = Math.round((weekday >= 5 ? 34 : 24) * growth + rand() * 10);
    for (let v = 0; v < visitors; v++) {
      const signedIn = rand() < 0.45;
      // Signed-in visitors: some are customers, many only look.
      const who = signedIn
        ? rand() < 0.5
          ? pick(people)
          : { userId: `demo-viewer-${Math.floor(rand() * 120)}` }
        : null;
      void views.hit(mess.slug, date, who ? `u:${who.userId}` : `a:demo-${date}-${v}`, who?.userId ?? null);
      if (rand() < 0.3)
        void views.hit(mess.slug, date, who ? `u:${who.userId}` : `a:demo-${date}-${v}`, who?.userId ?? null);
    }
    for (const person of people) {
      if (rand() > person.loyalty * growth * (weekday >= 5 ? 1.3 : 1)) continue;
      const dinner = rand() < 0.6;
      const minutes = dinner ? 19 * 60 + Math.floor(rand() * 170) : 12 * 60 + Math.floor(rand() * 150);
      const at = new Date(Date.parse(`${date}T00:00:00+05:30`) + minutes * 60_000);
      const lines = new Map<string, { name: string; qty: number; price: number; detail: string }>();
      const count = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const it = pick(weighted);
        const l = lines.get(it.name) ?? { name: it.name, qty: 0, price: it.price, detail: '' };
        l.qty += 1 + (rand() < 0.2 ? 1 : 0);
        lines.set(it.name, l);
      }
      // Now and then a combo, and the offers the restaurant runs (as students would use them).
      const combos = (mess.offers ?? []).filter((o) => o.kind === 'combo');
      if (combos.length && rand() < 0.22) {
        const c = pick(combos);
        lines.set(c.title, {
          name: `${c.title} (combo)`,
          qty: 1,
          price: c.price,
          detail: c.items.map((i) => `${i.qty}× ${i.name}`).join(', '),
        });
      }
      const list = [...lines.values()];
      // The discount a student would have got: the welcome code on a first order, else the best deal.
      const comboTotal = list
        .filter((l) => l.name.endsWith(' (combo)'))
        .reduce((n, l) => n + l.qty * l.price, 0);
      const subtotal = list.reduce((n, l) => n + l.qty * l.price, 0) - comboTotal;
      const first = !seenBefore.has(person.userId);
      seenBefore.add(person.userId);
      const deal = bestDiscount(mess.offers ?? [], subtotal, {
        date,
        code: first && rand() < 0.7 ? 'WELCOME20' : '',
        firstOrder: first,
      });
      const discount = deal.codeProblem ? 0 : deal.saving;
      const offerLabel =
        !deal.offer || !discount ? '' : deal.offer.kind === 'code' ? deal.offer.code : deal.offer.title;
      const r = rand();
      const status: 'done' | 'cancelled' | 'rejected' =
        r < 0.86 ? 'done' : r < 0.92 ? 'cancelled' : r < 0.97 ? 'rejected' : 'cancelled';
      const endedBy =
        status === 'rejected' ? 'owner' : status === 'cancelled' ? (r < 0.92 ? 'student' : 'auto') : '';
      const delivery = rand() < 0.7;
      rows.push({
        id: `demo-order-${date}-${person.userId}`,
        code: Math.floor(rand() * 36 ** 4)
          .toString(36)
          .toUpperCase()
          .padStart(4, 'X'),
        messSlug: mess.slug,
        userId: person.userId,
        email: person.email,
        lines: list,
        total: list.reduce((n, l) => n + l.qty * l.price, 0) - discount,
        mode: delivery ? 'delivery' : 'pickup',
        address: delivery ? person.place : '',
        name: person.name,
        phone: person.phone,
        note: '',
        ipHash: 'demo',
        status,
        ownerNote: status === 'rejected' ? 'Sold out' : '',
        createdAt: at,
        updatedAt: new Date(at.getTime() + 40 * 60_000),
        tiffin: null,
        discount,
        offer: offerLabel,
        chat: {
          ...EMPTY_CHAT_STATE,
          respondedAt:
            endedBy === 'auto' || endedBy === 'student'
              ? null
              : new Date(at.getTime() + (1 + Math.floor(rand() * 5)) * 60_000),
          endedBy: endedBy as OrderEndedBy,
        },
      });
    }
  }
  // The repository keeps the newest first.
  orders.rows.push(...rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
