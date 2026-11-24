import { z } from 'zod';

// ════════════════════════════════════════════════════════════════════════════
// Campus: mess menus and reminders (meals, tomorrow's classes, a class about to start)
//
// The shapes the site and the API share, and the rules both use: which week of a rotating menu
// is on, what is served at a meal, and which reminders are due at a given minute. Every time is
// campus time (India, UTC+5:30), whatever the device or server clock says.
// ════════════════════════════════════════════════════════════════════════════

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export const MEAL_KEYS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type MealKey = (typeof MEAL_KEYS)[number];
export const MEAL_NAMES: Record<MealKey, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'High tea',
  dinner: 'Dinner',
};
const MEAL_EMOJI: Record<MealKey, string> = { breakfast: '🍳', lunch: '🍛', snacks: '☕', dinner: '🍽️' };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = z.string().regex(HHMM, 'Use a 24-hour time like 07:30');
const isoDate = z.string().regex(DATE, 'Use a date like 2026-10-12');
const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, 'Use lowercase letters, numbers and dashes');

// ── Menus ────────────────────────────────────────────────────────────────────

/** A hostel mess serves four meals; a restaurant for day scholars serves lunch and dinner. */
export const MessKind = z.enum(['hostel', 'restaurant']);
export type MessKind = z.infer<typeof MessKind>;
/** Where the menu came from: typed from the notice board, or as the owner gave it. */
export const MessSource = z.enum(['notice', 'owner']);
export type MessSource = z.infer<typeof MessSource>;

export const MessDish = z.object({
  name: z.string().trim().min(1).max(120),
  /** Hard to read on the notice: shown with a "?" so students check it. */
  unsure: z.boolean().default(false),
});
export type MessDish = z.infer<typeof MessDish>;

const Dishes = z.array(MessDish).max(30);
const DayMenu = z.object({
  breakfast: Dishes.optional(),
  lunch: Dishes.optional(),
  snacks: Dishes.optional(),
  dinner: Dishes.optional(),
});
export type MessDayMenu = z.infer<typeof DayMenu>;

export const MessWeek = z.object({
  label: z.string().trim().max(40).default(''),
  days: z.object({
    mon: DayMenu.default({}),
    tue: DayMenu.default({}),
    wed: DayMenu.default({}),
    thu: DayMenu.default({}),
    fri: DayMenu.default({}),
    sat: DayMenu.default({}),
    sun: DayMenu.default({}),
  }),
});
export type MessWeek = z.infer<typeof MessWeek>;

export const MessMeal = z.object({
  key: z.enum(MEAL_KEYS),
  start: hhmm,
  end: hhmm,
  /** Served with every one of these meals, e.g. "Roti, plain rice, pickle". */
  extras: z.string().trim().max(200).default(''),
});
export type MessMeal = z.infer<typeof MessMeal>;

/** One thing a restaurant sells, at the owner's price (whole rupees). */
export const MessOrderItem = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.number().int().min(0).max(100_000),
  /** e.g. "half / full", "a month", "today's lunch or dinner". */
  note: z.string().trim().max(80).default(''),
  /** A photo the owner uploaded: its file name under /mess-photos/<slug>/ ('' = none). */
  photo: z
    .string()
    .regex(/^([a-f0-9]{24}\.(webp|jpg|png))?$/)
    .default(''),
  /** Off = "sold out today": still listed, can't be ordered. */
  available: z.boolean().default(true),
});
export type MessOrderItem = z.infer<typeof MessOrderItem>;
export const MessOrderSection = z.object({
  title: z.string().trim().min(1).max(60),
  items: z.array(MessOrderItem).max(60),
});
export type MessOrderSection = z.infer<typeof MessOrderSection>;

const MessFields = z.object({
  slug,
  name: z.string().trim().min(2, 'Give it a name').max(80),
  kind: MessKind,
  place: z.string().trim().max(120).default(''),
  source: MessSource,
  /** One line shown above the menu (where it came from, what to check). */
  note: z.string().trim().max(400).default(''),
  /** Prices exactly as the owner gave them, e.g. "Mess thali ₹80 · Tiffin ₹3,600 a month". */
  prices: z.string().trim().max(200).default(''),
  /** The owner's number for orders (calls and WhatsApp). Empty for hostel messes. */
  phone: z
    .string()
    .trim()
    .regex(/^(\+?\d[\d ]{6,17})?$/, 'Use digits, e.g. +91 85179 03810')
    .default(''),
  /** e.g. "Free home delivery · Parcel available". */
  orderNote: z.string().trim().max(160).default(''),
  /** What students can order, by section, with the owner's prices. */
  order: z.array(MessOrderSection).max(12).default([]),
  /** Who runs the restaurant: these addresses may sign in (any domain) and see its orders. */
  ownerEmails: z.array(z.string().trim().toLowerCase().email()).max(5).default([]),
  /** The owner is taking orders on the site right now. */
  ordersOpen: z.boolean().default(false),
  meals: z.array(MessMeal).min(1).max(4),
  /** A rotating menu: week 1, week 2… counted from cycleStart. One week repeats every week. */
  weeks: z.array(MessWeek).min(1).max(6),
  cycleStart: isoDate,
  published: z.boolean().default(false),
});

const uniqueMeals = (m: { meals: { key: string }[] }) =>
  new Set(m.meals.map((x) => x.key)).size === m.meals.length;
const mealsInOrder = (m: { meals: { start: string; end: string }[] }) =>
  m.meals.every((x) => x.start < x.end);
const UNIQUE = { message: 'Each meal can be listed once', path: ['meals'] };
const IN_ORDER = { message: 'A meal has to end after it starts', path: ['meals'] };

export const SaveMessBody = MessFields.refine(uniqueMeals, UNIQUE).refine(mealsInOrder, IN_ORDER);
export type MessInput = z.infer<typeof SaveMessBody>;

/**
 * What a restaurant owner may change from their dashboard: their menu, photos, prices, contact and
 * timings. Never who owns it, its link, whether it's published, or what kind of place it is.
 */
export const OwnerMessBody = MessFields.pick({
  name: true,
  place: true,
  note: true,
  prices: true,
  phone: true,
  orderNote: true,
  order: true,
  meals: true,
  weeks: true,
  cycleStart: true,
})
  .refine(uniqueMeals, UNIQUE)
  .refine(mealsInOrder, IN_ORDER);
export type OwnerMessInput = z.infer<typeof OwnerMessBody>;

/** Largest item photo accepted (the dashboard shrinks photos to well under this first). */
export const MESS_PHOTO_MAX_BYTES = 1_500_000;

export interface MessDto extends MessInput {
  sort: number;
  updatedAt: string;
}

export interface MessSummaryDto {
  slug: string;
  name: string;
  kind: MessKind;
  place: string;
  published: boolean;
}

// ── Orders (restaurants for day scholars) ───────────────────────────────────

/** An Indian mobile number, written any common way: "+91 98765 43210", "098765-43210"… */
export const normaliseMobile = (raw: string): string | null => {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};
export const formatMobile = (d: string) => (d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : d);

export const MESS_ORDER_STATUSES = ['placed', 'accepted', 'ready', 'done', 'rejected', 'cancelled'] as const;
export type MessOrderStatus = (typeof MESS_ORDER_STATUSES)[number];
export const OPEN_MESS_ORDER: readonly MessOrderStatus[] = ['placed', 'accepted', 'ready'];
export const MESS_ORDER_STATUS_TEXT: Record<MessOrderStatus, string> = {
  placed: 'Sent, waiting for the restaurant',
  accepted: 'Accepted, being made',
  ready: 'Ready',
  done: 'Delivered',
  rejected: 'Declined by the restaurant',
  cancelled: 'Cancelled',
};
/** What the owner may move an order to from each step. */
export const MESS_ORDER_NEXT: Record<MessOrderStatus, MessOrderStatus[]> = {
  placed: ['accepted', 'rejected'],
  accepted: ['ready', 'rejected'],
  ready: ['done'],
  done: [],
  rejected: [],
  cancelled: [],
};

export const PlaceMessOrderBody = z.object({
  lines: z
    .array(
      z.object({
        /** The item's name exactly as on the restaurant's list (prices are looked up on the server). */
        name: z.string().trim().min(1).max(80),
        qty: z.number().int().min(1).max(20),
        /** e.g. which day's thali and what's in it. */
        detail: z.string().trim().max(200).default(''),
      }),
    )
    .min(1, 'Add something to your order')
    .max(25),
  mode: z.enum(['delivery', 'pickup']),
  address: z.string().trim().max(120).default(''),
  name: z.string().trim().min(2, 'Add your name').max(60),
  phone: z
    .string()
    .trim()
    .refine((v) => normaliseMobile(v) !== null, 'Use a 10-digit Indian mobile number'),
  note: z.string().trim().max(160).default(''),
  /** The student ticked "this is my number, the restaurant may call it". */
  phoneConfirmed: z.literal(true, { errorMap: () => ({ message: 'Confirm your phone number' }) }),
});
export type PlaceMessOrderInput = z.infer<typeof PlaceMessOrderBody>;

export const MessOrderStatusBody = z.object({
  status: z.enum(MESS_ORDER_STATUSES),
  /** Why it was declined, or a word to the student ("ready in 20 min"). */
  note: z.string().trim().max(120).default(''),
});

export const MessOrdersOpenBody = z.object({ open: z.boolean() });

export interface MessOrderLineDto {
  name: string;
  qty: number;
  price: number;
  detail: string;
}

export interface MessOrderDto {
  id: string;
  /** Short code both sides say on the phone, e.g. "K7Q2". */
  code: string;
  messSlug: string;
  messName: string;
  lines: MessOrderLineDto[];
  total: number;
  mode: 'delivery' | 'pickup';
  address: string;
  name: string;
  phone: string;
  note: string;
  status: MessOrderStatus;
  ownerNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnedMessDto {
  slug: string;
  name: string;
  ordersOpen: boolean;
}

// ── "Something changed? Tell us" ─────────────────────────────────────────────

export const MessReportBody = z.object({
  slug,
  day: z.enum(DAY_KEYS).optional(),
  meal: z.enum(MEAL_KEYS).optional(),
  message: z.string().trim().min(5, 'Tell us a little more').max(600),
  /** Optional: how to reach them if we need to ask. */
  contact: z.string().trim().max(120).default(''),
});
export type MessReportInput = z.infer<typeof MessReportBody>;

export const MessReportStatus = z.enum(['new', 'done']);
export type MessReportStatus = z.infer<typeof MessReportStatus>;
export const MessReportStatusBody = z.object({ status: MessReportStatus });

export interface MessReportDto {
  id: string;
  slug: string;
  messName: string;
  day: DayKey | null;
  meal: MealKey | null;
  message: string;
  contact: string;
  status: MessReportStatus;
  createdAt: string;
}

// ── Reminders ────────────────────────────────────────────────────────────────

/** One class the student asked to be reminded about: only its name, room and start times. */
export const ReminderClass = z.object({
  code: z.string().trim().max(20).default(''),
  name: z.string().trim().min(1).max(80),
  room: z.string().trim().max(40).default(''),
  /** day: 0 = Monday … 6 = Sunday; start: minutes after midnight. */
  times: z
    .array(z.object({ day: z.number().int().min(0).max(6), start: z.number().int().min(0).max(1439) }))
    .max(21),
});
export type ReminderClass = z.infer<typeof ReminderClass>;

export const ReminderPrefs = z.object({
  mess: z
    .object({
      slug: slug.nullable().default(null),
      meals: z.array(z.enum(MEAL_KEYS)).max(4).default(['lunch', 'dinner']),
      /** Minutes before the meal starts. */
      lead: z.number().int().min(5).max(90).default(30),
      /** Words to look for ("paneer", "biryani"): that meal is announced even if it isn't ticked. */
      favourites: z.array(z.string().trim().min(2).max(40)).max(15).default([]),
    })
    .default({}),
  classes: z
    .object({
      /** "Tomorrow · 3 classes" the evening before. */
      nightly: z.boolean().default(false),
      nightlyAt: hhmm.default('21:00'),
      /** "DSA in 10 min" before each chosen class. */
      before: z.boolean().default(false),
      lead: z.number().int().min(5).max(60).default(10),
      /** Days that get class reminders (0 = Monday). */
      days: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5]),
      /** Only the subjects the student ticked. */
      courses: z.array(ReminderClass).max(20).default([]),
    })
    .default({}),
  /** "Mute today": nothing until the next day. */
  mutedOn: isoDate.nullable().default(null),
});
export type ReminderPrefs = z.infer<typeof ReminderPrefs>;

const endpoint = z
  .string()
  .url()
  .max(1000)
  .refine((u) => u.startsWith('https://'), 'Not a push address');

export const PushSubscribeBody = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  prefs: ReminderPrefs,
  /** "Android · Chrome", so a student can tell their devices apart. */
  label: z.string().trim().max(60).default(''),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeBody>;
export const PushEndpointBody = z.object({ endpoint });
export const PushPrefsBody = z.object({ endpoint, prefs: ReminderPrefs });
/** The browser replaced a device's push address (sent by the service worker). */
export const PushRenewBody = z.object({
  oldEndpoint: endpoint,
  subscription: z.object({
    endpoint,
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  }),
});
export type PushRenewInput = z.infer<typeof PushRenewBody>;

export interface PushStatusDto {
  /** The server has its push keys. Without them reminders can't be sent at all. */
  configured: boolean;
  publicKey: string;
  /** Students can turn reminders on (the "reminders" tool is live). Admins always can. */
  open: boolean;
}

export interface PushDeviceDto {
  id: string;
  label: string;
  createdAt: string;
  /** What this device gets, in a few words ("Lunch, dinner · Tomorrow's classes"). */
  summary: string;
}

export interface AdminPushStatsDto {
  configured: boolean;
  devices: number;
  withMeals: number;
  withClasses: number;
  byMess: { slug: string; name: string; devices: number }[];
  sentToday: number;
}

export interface PushRunDto {
  checked: number;
  sent: number;
  gone: number;
  failed: number;
  /** Due but left for the next run (each run may only send so many). */
  deferred: number;
}

// ── Time on campus ───────────────────────────────────────────────────────────

const IST_MS = 330 * 60_000;

/** Today's date, weekday (0 = Monday) and minute of the day on campus. */
export function campusClock(now: Date) {
  const t = new Date(now.getTime() + IST_MS);
  return {
    date: t.toISOString().slice(0, 10),
    day: (t.getUTCDay() + 6) % 7,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export const toMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 450 → "7:30 am", 870 → "2:30 pm". */
export function formatClock(min: number, withSuffix = true): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const t = `${h12}:${String(m).padStart(2, '0')}`;
  return withSuffix ? `${t} ${h < 12 ? 'am' : 'pm'}` : t;
}

/** "12:15 – 2:30 pm" (the suffix once when both are am or both pm). */
export function formatSpan(start: string, end: string): string {
  const a = toMinutes(start);
  const b = toMinutes(end);
  const same = a < 720 === b < 720;
  return `${formatClock(a, !same)} – ${formatClock(b)}`;
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
/** Days since a Monday, so weeks always turn over on Monday. */
const mondayOf = (date: string) => {
  const n = dayNumber(date);
  return n - ((n + 3) % 7); // 1970-01-01 was a Thursday
};

/** Which week of a rotating menu is on that date (0-based). One week: always 0. */
export function weekIndex(cycleStart: string, date: string, weeks: number): number {
  if (weeks <= 1) return 0;
  const w = Math.floor((mondayOf(date) - mondayOf(cycleStart)) / 7);
  return ((w % weeks) + weeks) % weeks;
}

type MenuSource = Pick<MessInput, 'weeks' | 'cycleStart' | 'meals'>;

/** What a mess serves at one meal on a date (empty: not in yet, or not served). */
export function dishesOn(mess: MenuSource, date: string, meal: MealKey): MessDish[] {
  const week = mess.weeks[weekIndex(mess.cycleStart, date, mess.weeks.length)];
  const day = DAY_KEYS[(dayNumber(date) + 3) % 7]!;
  if (!mess.meals.some((m) => m.key === meal)) return [];
  return week?.days[day]?.[meal] ?? [];
}

/** Favourite words found in these dishes (case-insensitive), e.g. ["paneer"]. */
export function favouritesIn(dishes: MessDish[], favourites: string[]): string[] {
  const text = dishes.map((d) => d.name.toLowerCase()).join(' | ');
  return favourites.filter((f) => f.trim().length > 1 && text.includes(f.trim().toLowerCase()));
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── Which reminders are due ──────────────────────────────────────────────────

export interface DuePush {
  /** Sent once per key (per device): "mess:2026-11-23:lunch". */
  key: string;
  /** A new notification replaces the last one with the same tag, so they never pile up. */
  tag: 'mess' | 'class' | 'nightly';
  title: string;
  body: string;
  /** The page a tap opens. */
  url: string;
}

const shortName = (c: ReminderClass) => c.code || c.name;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The reminders due for one device at this moment, minus those already sent. Run every few
 * minutes: a reminder is due from its lead time until the event starts, so a missed run only
 * makes it a little late, never lost or doubled. Nothing is due on a muted day, for a meal with
 * no menu, or on a day with no classes.
 */
export function duePushes(
  prefs: ReminderPrefs,
  mess: (MenuSource & { name: string; slug: string }) | null,
  now: Date,
  sent: ReadonlySet<string> = new Set(),
): DuePush[] {
  const clock = campusClock(now);
  if (prefs.mutedOn === clock.date) return [];
  const out: DuePush[] = [];
  const add = (p: DuePush) => {
    if (!sent.has(p.key)) out.push(p);
  };

  if (mess) {
    for (const meal of mess.meals) {
      const dishes = dishesOn(mess, clock.date, meal.key);
      if (!dishes.length) continue;
      const favs = favouritesIn(dishes, prefs.mess.favourites);
      if (!prefs.mess.meals.includes(meal.key) && !favs.length) continue;
      const start = toMinutes(meal.start);
      if (clock.minutes < start - prefs.mess.lead || clock.minutes >= start) continue;
      const left = start - clock.minutes;
      const name = MEAL_NAMES[meal.key];
      add({
        key: `mess:${clock.date}:${meal.key}`,
        tag: 'mess',
        title: favs.length
          ? `${name} in ${left} min · ${favs[0]} ⭐`
          : `${name} in ${left} min ${MEAL_EMOJI[meal.key]}`,
        body: clip(`${dishes.map((d) => d.name).join(', ')} · ${mess.name}`, 180),
        url: `/tools/mess-menu?mess=${encodeURIComponent(mess.slug)}&meal=${meal.key}`,
      });
    }
  }

  const c = prefs.classes;
  if (c.before && c.days.includes(clock.day)) {
    for (const course of c.courses)
      for (const t of course.times) {
        if (t.day !== clock.day) continue;
        if (clock.minutes < t.start - c.lead || clock.minutes >= t.start) continue;
        add({
          key: `class:${clock.date}:${t.start}`,
          tag: 'class',
          title: `${clip(course.name, 40)} in ${t.start - clock.minutes} min`,
          body: [course.code, course.room, formatClock(t.start)].filter(Boolean).join(' · '),
          url: '/tools/timetable',
        });
      }
  }

  if (c.nightly) {
    const at = toMinutes(c.nightlyAt);
    const tomorrow = (clock.day + 1) % 7;
    if (clock.minutes >= at && clock.minutes < at + 60 && c.days.includes(tomorrow)) {
      const list = c.courses
        .flatMap((course) => course.times.filter((t) => t.day === tomorrow).map((t) => ({ course, t })))
        .sort((a, b) => a.t.start - b.t.start);
      if (list.length)
        add({
          key: `nightly:${addDays(clock.date, 1)}`,
          tag: 'nightly',
          title: `Tomorrow · ${list.length} class${list.length === 1 ? '' : 'es'}`,
          body: clip(
            list.map(({ course, t }) => `${shortName(course)} ${formatClock(t.start, false)}`).join(' · '),
            180,
          ),
          url: '/tools/timetable?day=tomorrow',
        });
    }
  }
  return out;
}
