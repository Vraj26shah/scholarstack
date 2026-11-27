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
  /** A monthly tiffin plan: ordered with a meal plan and a start date, runs TIFFIN_DAYS days. */
  tiffin: z.boolean().optional(),
});
export type MessOrderItem = z.infer<typeof MessOrderItem>;
export const MessOrderSection = z.object({
  title: z.string().trim().min(1).max(60),
  items: z.array(MessOrderItem).max(60),
});
export type MessOrderSection = z.infer<typeof MessOrderSection>;

// ── A restaurant's offers ───────────────────────────────────────────────────
// Three kinds, all set up by the owner in their dashboard:
//  • code:  a promo code students type ("WELCOME20": 20% off, first order only, up to ₹60)
//  • deal:  applied by itself ("₹30 off orders above ₹299")
//  • combo: dishes together for one price ("Paneer + 2 roti + lassi for ₹199")
// One discount per order (the code if it works, else the best deal); combos are already a deal,
// so discounts apply to the rest of the order.

export const MESS_OFFER_KINDS = ['code', 'deal', 'combo'] as const;
export type MessOfferKind = (typeof MESS_OFFER_KINDS)[number];

export const MessOffer = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]{4,16}$/)
    .default(() => Math.random().toString(36).slice(2, 10)),
  kind: z.enum(MESS_OFFER_KINDS),
  /** What students see: "20% off your first order". */
  title: z.string().trim().min(3, 'Give the offer a name').max(60),
  active: z.boolean().default(true),
  /** Promo codes only: letters and digits, saved in capitals. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9]{3,15})?$/, 'Codes are 3–15 letters or digits')
    .default(''),
  /** Code or deal: a percentage off, or rupees off (one of them). */
  percentOff: z.number().int().min(0).max(90).default(0),
  flatOff: z.number().int().min(0).max(2000).default(0),
  /** The order (before the discount, combos left out) must reach this, in rupees. */
  minTotal: z.number().int().min(0).max(10000).default(0),
  /** Largest discount from a percentage (0 = no cap). */
  maxOff: z.number().int().min(0).max(2000).default(0),
  /** Only for a student's first order at this restaurant. */
  firstOrderOnly: z.boolean().default(false),
  /** Combos: the dishes in it (names from the menu card) and its price. */
  items: z
    .array(z.object({ name: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(10) }))
    .max(8)
    .default([]),
  price: z.number().int().min(0).max(10000).default(0),
  /** Optional dates it runs (campus dates, inclusive); empty = always. */
  startsOn: z.union([isoDate, z.literal('')]).default(''),
  endsOn: z.union([isoDate, z.literal('')]).default(''),
});
export type MessOffer = z.infer<typeof MessOffer>;

/** What's wrong with an offer as the owner wrote it ('' = fine). */
export function offerProblem(o: MessOffer, menu: { name: string }[]): string {
  if (o.kind === 'code' && !o.code) return `"${o.title}": add the code students type.`;
  if (o.kind !== 'combo' && !o.percentOff && !o.flatOff) return `"${o.title}": say how much it takes off.`;
  if (o.kind !== 'combo' && o.percentOff && o.flatOff)
    return `"${o.title}": a percentage or rupees off, not both.`;
  if (o.kind === 'combo') {
    if (o.items.length < 2) return `"${o.title}": a combo needs at least two dishes.`;
    if (!o.price) return `"${o.title}": give the combo a price.`;
    const names = new Set(menu.map((i) => i.name.toLowerCase()));
    const missing = o.items.find((i) => !names.has(i.name.toLowerCase()));
    if (missing) return `"${o.title}": "${missing.name}" isn't on your menu card.`;
  }
  if (o.startsOn && o.endsOn && o.endsOn < o.startsOn) return `"${o.title}": it ends before it starts.`;
  return '';
}

/** Is it running on this campus date? */
export const offerLive = (o: MessOffer, date: string) =>
  o.active && (!o.startsOn || o.startsOn <= date) && (!o.endsOn || o.endsOn >= date);

/** A combo's line on an order: its name says what's in it. */
export const COMBO_PREFIX = 'combo:';
export const comboLineName = (o: Pick<MessOffer, 'title'>) => `${o.title} (combo)`;

/** The rupees an offer takes off a subtotal (0 when it doesn't apply). */
export function offerSaving(o: MessOffer, subtotal: number): number {
  if (o.kind === 'combo' || subtotal <= 0 || subtotal < o.minTotal) return 0;
  const raw = o.flatOff ? o.flatOff : Math.floor((subtotal * o.percentOff) / 100);
  return Math.max(0, Math.min(subtotal, o.maxOff && o.percentOff ? Math.min(raw, o.maxOff) : raw));
}

/**
 * The one discount on an order: the typed code when it works here today, otherwise the best
 * automatic deal. `subtotal` leaves combos out. The same sum runs on the order slip and on the
 * server, so the student sees exactly what the restaurant gets.
 */
export function bestDiscount(
  offers: MessOffer[],
  subtotal: number,
  opts: { date: string; code?: string; firstOrder: boolean },
): { offer: MessOffer | null; saving: number; codeProblem: string } {
  const live = offers.filter((o) => offerLive(o, opts.date) && (!o.firstOrderOnly || opts.firstOrder));
  const typed = (opts.code ?? '').trim().toUpperCase();
  let codeProblem = '';
  if (typed) {
    const any = offers.find((o) => o.kind === 'code' && o.code === typed);
    const hit = live.find((o) => o.kind === 'code' && o.code === typed);
    if (!any) codeProblem = `"${typed}" isn't a code here.`;
    else if (!hit)
      codeProblem =
        any.firstOrderOnly && !opts.firstOrder
          ? `"${typed}" is for a first order only.`
          : `"${typed}" isn't running today.`;
    else if (subtotal < hit.minTotal) codeProblem = `"${typed}" needs an order of ₹${hit.minTotal} or more.`;
    else return { offer: hit, saving: offerSaving(hit, subtotal), codeProblem: '' };
  }
  let best: MessOffer | null = null;
  let saving = 0;
  for (const o of live.filter((x) => x.kind === 'deal')) {
    const s = offerSaving(o, subtotal);
    if (s > saving) {
      best = o;
      saving = s;
    }
  }
  return { offer: best, saving, codeProblem };
}

/** Most people who can open one restaurant's orders (owner, manager, cooks, a counter phone…). */
export const MAX_OWNERS = 10;

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
  ownerEmails: z.array(z.string().trim().toLowerCase().email()).max(MAX_OWNERS).default([]),
  /** The owner is taking orders on the site right now. */
  ordersOpen: z.boolean().default(false),
  /** Most orders the restaurant takes on the site in one day (campus time); 0 = no limit. */
  dailyOrderCap: z.number().int().min(0).max(2000).default(0),
  /** Promo codes, automatic deals and combos (see MessOffer). */
  offers: z.array(MessOffer).max(20).default([]),
  /** The owner's UPI ID ("name@okaxis"): students pay it straight, before pay-first orders are made. */
  upiId: z
    .string()
    .trim()
    .regex(/^([a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,40})?$/, 'Use a UPI ID like shopname@okaxis')
    .default(''),
  /** Orders above this many rupees are paid first by UPI (0 = no limit; needs a UPI ID). */
  prepayAbove: z.number().int().min(0).max(100_000).default(0),
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
  dailyOrderCap: true,
  offers: true,
  upiId: true,
  prepayAbove: true,
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
/** Where the restaurant can move an order. 'rejected' at any open step = the restaurant cancels it
 *  (with a reason the student sees). A running tiffin plan (status 'done') can be stopped too. */
export const MESS_ORDER_NEXT: Record<MessOrderStatus, MessOrderStatus[]> = {
  placed: ['accepted', 'rejected'],
  accepted: ['ready', 'rejected'],
  ready: ['done', 'rejected'],
  done: [],
  rejected: [],
  cancelled: [],
};

/**
 * Students who don't collect what they ordered. The owner marks it ("Didn't collect"); the count
 * covers every restaurant over the last 60 days. One is a warning, two means paying first by UPI,
 * three pauses ordering until the oldest one is 60 days old.
 */
export const NO_SHOW = { windowDays: 60, payFirstAt: 2, pauseAt: 3 };

/**
 * Handing food over, checked from both sides. The student's order screen shows a secret 4-digit
 * code (one per order, and one per tiffin meal). The restaurant types it in when it hands the food
 * over: that proves the student got it. When there's no code (left at the door, phone dead), the
 * restaurant can still mark it handed over and the student is asked "Did you get it?". The student
 * can also say "I got it" themselves, or "I didn't get it". A "didn't collect" can be contested
 * too. Anything contested goes to the admin, and a contested no-show doesn't count until then.
 */
export const HANDOVER = {
  codeLength: 4,
  /** Wrong codes allowed per order (or tiffin plan) per day before only "without code" is left. */
  triesPerDay: 5,
  /** How long the student has to answer "Did you get it?" or contest a no-show. */
  answerHours: 48,
  /** "I didn't get it" on an order still being made opens this long after the restaurant accepted it. */
  lateAfterMinutes: 45,
  /** "Didn't collect" can be marked only this long after accepting (time to come and get it). */
  noShowAfterMinutes: 20,
};
/** How an order or tiffin meal was handed over: the student's code, the student's own word, or
 *  the restaurant's word alone (the student is asked to confirm). '' = not handed over yet. */
export const HANDOVER_HOW = ['', 'code', 'student', 'owner'] as const;
export type HandoverHow = (typeof HANDOVER_HOW)[number];
/** What a student contests: food marked handed over (or long late) that never came, or a no-show. */
export const DISPUTE_KINDS = ['', 'not_received', 'no_show'] as const;
export type DisputeKind = (typeof DISPUTE_KINDS)[number];
/** open = waiting for the admin; student/owner = the admin sided with them; settled = the code
 *  was entered after all (the food did reach the student). */
export const DISPUTE_STATES = ['', 'open', 'student', 'owner', 'settled'] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

export const HandoverBody = z.object({
  /** The student's 4-digit code; '' with `withoutCode` when there isn't one. */
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$|^$/, 'The code is 4 digits')
    .default(''),
  withoutCode: z.boolean().default(false),
});
export type HandoverInput = z.infer<typeof HandoverBody>;
export const OrderDisputeBody = z.object({
  kind: z.enum(['not_received', 'no_show']),
  note: z.string().trim().max(300).default(''),
});
export const DisputeDecisionBody = z.object({ decision: z.enum(['student', 'owner']) });
/** The admin's decision on one tiffin meal the student says never came. */
export const TiffinDisputeDecisionBody = z.object({
  orderId: z.string().min(1).max(64),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(['lunch', 'dinner']),
  makeupFor: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  decision: z.enum(['student', 'owner']),
});
export const TiffinConfirmBody = z.object({
  orderId: z.string().min(1).max(64),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(['lunch', 'dinner']),
  makeupFor: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  /** yes = I got this meal; no = I didn't. */
  answer: z.enum(['yes', 'no']),
});
export type TiffinConfirmInput = z.infer<typeof TiffinConfirmBody>;

/** Where someone is looking right now, so a notification about it isn't sent (they see it live). */
export const PRESENCE_SCOPE = /^(orders|board:[a-z0-9-]{1,60}|chat:[A-Za-z0-9-]{1,64})$/;
export const PresenceLeaveBody = z.object({
  scopes: z.array(z.string().regex(PRESENCE_SCOPE)).max(6),
});
/** Seen within this long = still looking (pages refresh every 10–30 seconds while visible). */
export const PRESENCE_MS = 45_000;
/** A pay-first order not paid in this long is cancelled; once paid the restaurant's usual clock runs. */
export const PAY_FIRST_WINDOW_MS = 20 * 60_000;
export const ORDER_PAYMENTS = ['', 'due', 'claimed', 'paid'] as const;
/** '' = pay on delivery/pickup; due = waiting for the student's UPI payment; claimed = the student
 *  says they paid; paid = the owner saw the money arrive. */
export type OrderPayment = (typeof ORDER_PAYMENTS)[number];

/** A UPI app link for paying a restaurant (opens GPay, PhonePe, Paytm… on a phone). */
export const upiPayLink = (upiId: string, name: string, rupees: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name.slice(0, 40))}&am=${rupees.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note.slice(0, 40))}`;

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
  /** Only for a monthly tiffin plan: which meals, and from which day. */
  tiffin: z.object({ plan: z.enum(['lunch', 'dinner', 'both']), startsOn: isoDate }).optional(),
  /** A promo code the student typed (the server checks it again). */
  promoCode: z.string().trim().max(20).default(''),
});
export type PlaceMessOrderInput = z.infer<typeof PlaceMessOrderBody>;

// ── Mobile number check (an SMS code) ───────────────────────────────────────
// A restaurant calls the number on an order, so it must be the student's real phone: once a code
// sent by SMS is entered, the number is kept on the account and every order uses it.

export const PHONE_OTP = {
  /** A code works this long. */
  ttlSeconds: 10 * 60,
  /** Wait this long before asking for another code. */
  resendSeconds: 45,
  /** Wrong tries before a new code is needed. */
  attempts: 5,
  /** Codes per account per day, and per number per day (SMS costs money). */
  perDay: 5,
} as const;

export const PhoneStartBody = z.object({
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => normaliseMobile(v) !== null, 'Use a 10-digit Indian mobile number'),
});
export const PhoneCheckBody = PhoneStartBody.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code from the SMS'),
});

export interface PhoneStatusDto {
  /** Can codes be sent at all (an SMS service is set up on the server)? */
  available: boolean;
  /** The checked number (10 digits), or null. Once set, orders always use it. */
  phone: string | null;
  /** A code sent and not yet used. */
  pending: { phone: string; resendInSeconds: number; expiresInSeconds: number } | null;
  /**
   * Free check through WhatsApp (null when it isn't set up): the student sends "VERIFY <code>" to
   * the site's WhatsApp number and the number they sent from is the one kept. `waiting` is the code
   * they were given and the link that opens WhatsApp with the message typed.
   */
  whatsapp: { waiting: { code: string; link: string; expiresInSeconds: number } | null } | null;
}

// ── Tiffin (monthly meal plans) ──────────────────────────────────────────────

export const TIFFIN_PLANS = ['lunch', 'dinner', 'both'] as const;
export type TiffinPlan = (typeof TIFFIN_PLANS)[number];
export const TIFFIN_PLAN_TEXT: Record<TiffinPlan, string> = {
  lunch: 'Lunch',
  dinner: 'Dinner',
  both: 'Lunch & dinner',
};
/** A plan runs this many days from its first day. */
export const TIFFIN_DAYS = 30;
/** A plan can start today or up to this many days ahead. */
export const TIFFIN_START_WITHIN_DAYS = 14;
/** An item is a tiffin plan when the owner says so, or (never set) its name says "tiffin". */
export const isTiffinItem = (i: { name: string; tiffin?: boolean }) => i.tiffin ?? /tiffin/i.test(i.name);
/** The last day of a plan starting on `startsOn` (YYYY-MM-DD). */
export const tiffinEnds = (startsOn: string) => {
  const d = new Date(`${startsOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + TIFFIN_DAYS - 1);
  return d.toISOString().slice(0, 10);
};

export interface TiffinDto {
  plan: TiffinPlan;
  startsOn: string;
  endsOn: string;
  /** For the student: meals delivered and missed so far, and missed meals they can still get. */
  delivered?: number;
  missed?: number;
  makeups?: { day: string; meal: TiffinMeal; until: string }[];
  /**
   * For the student: today's meals (and make-ups) with the secret code to give at the door, and
   * meals the restaurant marked delivered without a code that wait for "Did you get it?".
   */
  meals?: TiffinMealDto[];
}

export interface TiffinMealDto {
  day: string;
  meal: TiffinMeal;
  /** '' for the day's regular meal, else the missed day this make-up is for. */
  makeupFor: string;
  /** Give this only once the tiffin is in your hands ('' once it's handed over). */
  code: string;
  mark: 'delivered' | 'missed' | null;
  how: HandoverHow;
  /** The student's answer to a delivery marked without a code. */
  confirm: '' | 'yes' | 'no';
  /** The student may still say yes or no about this meal. */
  canAnswer: boolean;
}

// ── Tiffin deliveries: delivered, missed, and make-up meals ──
// Every day the owner marks each tiffin meal Delivered or Missed. A missed meal can be made up
// (delivered as an extra) within the next TIFFIN_MAKEUP_DAYS days; after that it lapses.

export const TIFFIN_MAKEUP_DAYS = 4;
export const TIFFIN_MEALS = ['lunch', 'dinner'] as const;
export type TiffinMeal = (typeof TIFFIN_MEALS)[number];
export type TiffinMark = 'delivered' | 'missed';

export const TiffinMarkBody = z.object({
  orderId: z.string().min(1).max(64),
  day: isoDate,
  meal: z.enum(TIFFIN_MEALS),
  /** 'clear' takes a mark back. */
  status: z.enum(['delivered', 'missed', 'clear']),
  /** A make-up meal: the day of the missed meal it makes up for. */
  makeupFor: z.union([isoDate, z.literal('')]).default(''),
  /** Delivered: the student's 4-digit code for this meal ('' = without a code, the student confirms). */
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$|^$/, 'The code is 4 digits')
    .default(''),
});
export type TiffinMarkInput = z.infer<typeof TiffinMarkBody>;

/** The last day a meal missed on `day` can still be made up. */
export const makeupUntil = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + TIFFIN_MAKEUP_DAYS * 86_400_000).toISOString().slice(0, 10);

/** One plan on the owner's delivery sheet. */
export interface TiffinRowDto {
  orderId: string;
  code: string;
  name: string;
  phone: string;
  mode: 'delivery' | 'pickup';
  address: string;
  plan: TiffinPlan;
  startsOn: string;
  endsOn: string;
  note: string;
  unread: number;
  /** Which meal this row is for, and how it was marked on the sheet's day (null = not yet). */
  meal: TiffinMeal;
  mark: TiffinMark | null;
  /** How a delivered meal was proved, and the student's answer when it was without a code. */
  how: HandoverHow;
  confirm: '' | 'yes' | 'no';
  /** A make-up row: the missed day it makes up for, and the last day it can be given. */
  makeupFor: string;
  makeupUntil: string;
  /**
   * This student's whole plan so far: meals delivered, missed, made up later, missed and too late
   * to make up, not marked yet (days gone by), and still to come after the sheet's day.
   */
  record: {
    total: number;
    delivered: number;
    missed: number;
    madeUp: number;
    lapsed: number;
    unmarked: number;
    left: number;
  };
}

/** The owner's tiffin sheet for a day: who gets lunch, who gets dinner, and plans ending soon. */
export interface TiffinSheetDto {
  date: string;
  lunch: TiffinRowDto[];
  dinner: TiffinRowDto[];
  /** Missed meals from the last TIFFIN_MAKEUP_DAYS days that can still be given (or were today). */
  makeups: TiffinRowDto[];
  /** Today's regular meals: delivered, missed, still to do. */
  counts: { delivered: number; missed: number; pending: number };
  /** Plans ending within 3 days of `date` (to remind about renewing). */
  ending: TiffinRowDto[];
  /** Plans waiting for the owner to accept. */
  waiting: number;
  active: number;
}

/** Someone who ordered from this restaurant, as its owner sees them. */
export interface OwnerCustomerDto {
  userId: string;
  name: string;
  phone: string;
  orders: number;
  /** Rupees across orders that weren't declined or cancelled. */
  spent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  /** Their latest order (to open its chat). */
  lastOrderId: string;
  tiffin: TiffinDto | null;
  blocked: boolean;
}

/** One student's whole record at a restaurant (the last 12 months), for its owner. */
export interface OwnerCustomerDetailDto {
  customer: OwnerCustomerDto;
  /** Days they opened the restaurant's page, and opens in all (signed in only). */
  visitDays: number;
  views: number;
  /** Orders that went through (accepted, ready or delivered). */
  completed: number;
  /** Cancelled by the student, declined or cancelled by the restaurant, or never answered. */
  cancelledByThem: number;
  declinedByYou: number;
  /** Orders they didn't collect, here and at every restaurant (last 60 days). */
  noShows: number;
  noShowsEverywhere: number;
  unanswered: number;
  /** Rupees per completed order (0 when none). */
  avgOrder: number;
  modes: { delivery: number; pickup: number };
  /** What they order most, with how many in all. */
  favourites: { name: string; qty: number }[];
  /** Busiest hour for them (0–23, campus time), or -1. */
  usualHour: number;
  /** Rupees spent per month, oldest first ("2026-11"). */
  months: { month: string; spent: number; orders: number }[];
  /** Every order, newest first. */
  history: {
    id: string;
    code: string;
    createdAt: string;
    total: number;
    status: MessOrderStatus;
    mode: 'delivery' | 'pickup';
    items: string;
    offer: string;
  }[];
}

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
  /** When the restaurant first accepted or declined it (null: not yet, or it never did). */
  respondedAt: string | null;
  /** Who closed it when it didn't finish: the student, the owner, the 10-minute timer, an admin. */
  endedBy: OrderEndedBy;
  /** Chat messages the person asking hasn't read yet. */
  unread: number;
  /** The chat's latest line, for lists ("📷 Photo" for a picture). */
  last: { sender: ChatSender; body: string; at: string } | null;
  /** Live updates channel ('' = none: the page asks every few seconds instead). */
  topic: string;
  /** A monthly tiffin plan (null: an ordinary order). */
  tiffin: TiffinDto | null;
  /** Rupees taken off by an offer (the total is after it), and which offer ('' = none). */
  discount: number;
  offer: string;
  /** Paying first by UPI ('' = pays the restaurant on delivery or pickup). */
  payment: OrderPayment;
  /** Where to pay ('' unless the order is pay-first). */
  upiId: string;
  /** The restaurant marked that the student never collected it. */
  noShow: boolean;
  /** For the restaurant: this student's record across all restaurants (null for students). */
  trust: { orders: number; noShows: number } | null;
  /** For the student only, while the order is open: the code to give when the food is in hand. */
  handoverCode: string;
  /** How it was handed over ('' = not yet), and when. */
  handoverHow: HandoverHow;
  handedOverAt: string | null;
  /** Something the student contested, and where it stands. */
  dispute: { kind: DisputeKind; state: DisputeState; at: string; note: string } | null;
  /** For the student: they can say "I got it" now, or contest ('' = nothing to contest). */
  canConfirm: boolean;
  canDispute: DisputeKind;
}

export interface OwnedMessDto {
  slug: string;
  name: string;
  ordersOpen: boolean;
  /** Live updates channel for this restaurant's board ('' = none). */
  topic: string;
  /** Unread chat messages across this restaurant's open and recent orders. */
  unread: number;
}

// ── Order chat (student ⇄ restaurant, per order) ─────────────────────────────

export const CHAT_SENDERS = ['student', 'owner', 'system'] as const;
export type ChatSender = (typeof CHAT_SENDERS)[number];
export const ORDER_ENDED_BY = ['', 'student', 'owner', 'auto', 'admin'] as const;
export type OrderEndedBy = (typeof ORDER_ENDED_BY)[number];

/**
 * The clock every new order runs on. Owners hear an alarm every minute until they answer; after
 * three minutes the student gets a one-tap WhatsApp nudge (and the owner a second alert); after
 * ten the order is cancelled so nobody waits for food that isn't coming.
 */
export const ORDER_TIMERS = {
  alarmEveryMs: 60_000,
  nudgeAfterMs: 3 * 60_000,
  autoCancelAfterMs: 10 * 60_000,
};

export const CHAT_LIMITS = {
  bodyMax: 1000,
  /** Messages one person may send in a minute, and in a day (across all their chats). */
  perMinute: 20,
  perDay: 300,
  /** A chat stays open this long after its order finishes, then turns read-only. */
  openHoursAfterEnd: 12,
};

/** One-tap replies (free text is always allowed too). */
export const STUDENT_QUICK_REPLIES = [
  'Where is my order?',
  'How long will it take?',
  "I'm at the gate",
  'Coming to pick up now',
  'Please make it less spicy',
  'Thank you!',
];
export const OWNER_QUICK_REPLIES = [
  'Order received, starting now',
  'Ready in 10 minutes',
  'Out for delivery',
  'Ready, please collect from the counter',
  'Sorry, one item is sold out. Shall we replace it?',
  'Reached. Please come down',
];

const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const LINK_IN_TEXT =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|in|net|org|io|me|co|app|link|xyz|ly|gl|to|be|info|site|online|shop|store|live|tk|ru|cn)\b/i;
/** Eight or more digits close together, however they're spaced: a phone number, not a price. */
const PHONE_IN_TEXT = /(?:\+?\d[\s\-().]*){8,}/;

/**
 * Why a chat message can't be sent, or null. Links, email addresses and phone numbers stay out of
 * chats: they are how scams and harassment move off the site. Each side has a Call button instead.
 */
export function chatTextProblem(raw: string): string | null {
  // Full-width digits and letters become plain ones; invisible characters (often used to slip a
  // number past a filter) are dropped before checking.
  const text = raw.normalize('NFKC').replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  if (EMAIL_IN_TEXT.test(text)) return "Email addresses can't be shared in chat.";
  if (LINK_IN_TEXT.test(text)) return "Links can't be sent in chat.";
  if (PHONE_IN_TEXT.test(text)) return "Phone numbers can't be shared in chat. Use the Call button.";
  return null;
}

const chatPhoto = z
  .string()
  .regex(/^([a-f0-9]{24}\.(webp|jpg|png))?$/)
  .default('');

export const ChatMessageBody = z
  .object({
    body: z.string().trim().max(CHAT_LIMITS.bodyMax).default(''),
    /** A photo sent first to /chats/:id/photos ('' = none). */
    photo: chatPhoto,
  })
  .refine((m) => m.body.length > 0 || m.photo.length > 0, { message: 'Type a message', path: ['body'] })
  .superRefine((m, ctx) => {
    const problem = chatTextProblem(m.body);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['body'] });
  });
export type ChatMessageInput = z.infer<typeof ChatMessageBody>;

export const ChatReportBody = z.object({
  reason: z.string().trim().min(3, 'Say what happened').max(500),
});
export const ChatBlockBody = z.object({ reason: z.string().trim().max(200).default('') });
export const ChatReportStatus = z.enum(['new', 'done']);
export type ChatReportStatus = z.infer<typeof ChatReportStatus>;
export const ChatReportStatusBody = z.object({ status: ChatReportStatus });

/** A device that wants order alerts and chat messages for the signed-in account. */
export const PushAccountBody = z
  .object({
    endpoint: z
      .string()
      .max(1000)
      .refine((u) => isPushAddress(u), 'Not a push address'),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    label: z.string().trim().max(60).default(''),
  })
  .refine(
    (v) => /^fcm:/.test(v.endpoint) || (v.keys.p256dh.length >= 20 && v.keys.auth.length >= 8),
    'Missing push keys',
  );
export type PushAccountInput = z.infer<typeof PushAccountBody>;

export interface ChatMessageDto {
  id: string;
  sender: ChatSender;
  body: string;
  photo: string;
  createdAt: string;
}

export type ChatRole = 'student' | 'owner' | 'admin';

export interface OrderChatDto {
  order: MessOrderDto;
  /** Who is looking: their own messages show on the right. */
  role: ChatRole;
  messages: ChatMessageDto[];
  /** When the other side last read the chat (for ✓✓). Admins: null. */
  otherReadAt: string | null;
  /** Whether this person may send now, and if not, why ('' when they may). */
  canSend: boolean;
  closedReason: string;
  /** The student is blocked by this restaurant. */
  blocked: boolean;
  /** The number the Call button rings ('' = none). */
  callPhone: string;
  /** "Clear chat" on this side hid everything before this moment. */
  clearedAt: string | null;
}

export interface MessBlockDto {
  messSlug: string;
  messName: string;
  userId: string;
  name: string;
  phone: string;
  reason: string;
  createdAt: string;
  /** Admins only ('' for owners). */
  email: string;
}

export interface ChatReportDto {
  id: string;
  orderId: string;
  orderCode: string;
  messSlug: string;
  messName: string;
  by: 'student' | 'owner';
  reason: string;
  status: ChatReportStatus;
  createdAt: string;
  /** Who the order was from (admins only). */
  studentEmail: string;
  studentPhone: string;
}

/** A restaurant's typical time to answer: half of its answers came faster than this. */
export interface ReplyTimeDto {
  minutes: number | null;
  samples: number;
}

export interface AdminOrderRowDto extends MessOrderDto {
  email: string;
  /** What happened to the owner's alert ("Sent to 2 phones", "No phone has alerts on"). */
  alertNote: string;
  reports: number;
}

/** Something a student contested, for the admin to decide: an order, or one tiffin meal. */
export interface AdminDisputeDto {
  orderId: string;
  code: string;
  messSlug: string;
  messName: string;
  name: string;
  email: string;
  phone: string;
  total: number;
  /** not_received / no_show on an order, or 'tiffin' (a meal marked delivered that the student says never came). */
  kind: 'not_received' | 'no_show' | 'tiffin';
  state: DisputeState;
  note: string;
  at: string;
  /** Tiffin: which meal. */
  meal: { day: string; meal: TiffinMeal; makeupFor: string } | null;
  /** How many contests this student and this restaurant have had in 90 days (patterns of abuse). */
  studentDisputes: number;
  messDisputes: number;
}

export type OrderStatusCounts = Record<MessOrderStatus, number>;

export interface AdminRestaurantStatsDto {
  slug: string;
  name: string;
  ordersOpen: boolean;
  ownerEmails: string[];
  /** Owner phones/laptops that will get order alerts. 0 = nobody hears new orders when away. */
  ownerDevices: number;
  today: OrderStatusCounts;
  week: OrderStatusCounts;
  autoCancelledWeek: number;
  reply: ReplyTimeDto;
  blocks: number;
  openReports: number;
}

export interface AdminOrdersOverviewDto {
  pushConfigured: boolean;
  liveConfigured: boolean;
  restaurants: AdminRestaurantStatsDto[];
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
      /** Dishes the student ticked (or words like "paneer"): matched against each meal's dishes. */
      favourites: z.array(z.string().trim().min(2).max(80)).max(40).default([]),
      /**
       * false: every ticked meal is announced (and a favourite at any meal).
       * true: only ticked meals that serve one of the favourites.
       */
      only: z.boolean().default(false),
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

/**
 * The push services browsers actually use. The server sends requests to a device's push address,
 * so any other host is refused: otherwise anyone could make the server call any URL (SSRF).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, Samsung, Opera, Brave
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari, iPhone home-screen apps
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows
];
/** An Android app's Firebase Cloud Messaging token, stored as "fcm:<token>". */
export const isAppDevice = (u: string) => /^fcm:[A-Za-z0-9_:-]{20,400}$/.test(u);
export const isPushAddress = (u: string) => {
  if (isAppDevice(u)) return true;
  // "https://" + a bare host name (no port, no user, nothing odd) + "/".
  const m = /^https:\/\/([a-z0-9.-]+)\//i.exec(u);
  return !!m && PUSH_HOSTS.some((h) => h.test(m[1]!.toLowerCase()));
};
const endpoint = z.string().max(1000).refine(isPushAddress, 'Not a push address');
/** Web Push keys; app devices (fcm:) have none and send empty strings. */
const pushKeys = z.object({ p256dh: z.string().max(200), auth: z.string().max(100) });
const keysFit = (v: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
  isAppDevice(v.endpoint) || (v.keys.p256dh.length >= 20 && v.keys.auth.length >= 8);

export const PushSubscribeBody = z
  .object({
    endpoint,
    keys: pushKeys,
    prefs: ReminderPrefs,
    /** "Android · Chrome", so a student can tell their devices apart. */
    label: z.string().trim().max(60).default(''),
  })
  .refine(keysFit, 'Missing push keys');
export type PushSubscribeInput = z.infer<typeof PushSubscribeBody>;
export const PushEndpointBody = z.object({ endpoint });
/** "Send a test" from a tool: a meal sample from the Mess menu, a class sample from the Timetable. */
export const PushTestBody = z.object({ endpoint, kind: z.enum(['meal', 'class']).optional() });
export type PushTestKind = 'meal' | 'class';
export const PushPrefsBody = z.object({ endpoint, prefs: ReminderPrefs });
/** The browser replaced a device's push address (sent by the service worker). */
export const PushRenewBody = z.object({
  oldEndpoint: endpoint,
  subscription: z.object({ endpoint, keys: pushKeys }).refine(keysFit, 'Missing push keys'),
});
export type PushRenewInput = z.infer<typeof PushRenewBody>;

export interface PushStatusDto {
  /** The server has its push keys. Without them reminders can't be sent at all. */
  configured: boolean;
  publicKey: string;
  /** Students can turn some reminders on (either kind below). Admins always can. */
  open: boolean;
  /** Class reminders: open once the Timetable maker is live. */
  classes: boolean;
  /** Meal reminders: open once the Mess menu is live. */
  meals: boolean;
}

/** What a device reports back about a notification: it reached the screen, or it was tapped. */
export const PUSH_KINDS = ['class', 'nightly', 'mess', 'order', 'chat', 'test', 'other'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
/** Any notification tag, folded into the kinds the admin counts. */
export const pushKind = (tag: string): PushKind => {
  if ((PUSH_KINDS as readonly string[]).includes(tag)) return tag as PushKind;
  if (tag.startsWith('chat')) return 'chat';
  if (tag.startsWith('order')) return 'order';
  return 'other';
};
export const PushReceiptBody = z.object({
  endpoint,
  tag: z.string().max(80).optional(),
  event: z.enum(['shown', 'opened']).optional(),
});

/** One day of one kind of notification, for Admin › Reminders. */
export interface PushDailyDto {
  day: string;
  kind: PushKind;
  /** Accepted by the browser's push service. */
  sent: number;
  /** The device said it showed it on screen. */
  seen: number;
  /** Tapped. */
  opened: number;
  failed: number;
  /** The device had switched notifications off (it is forgotten). */
  gone: number;
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
  /** Signed-in students with at least one device getting class reminders. */
  classStudents: number;
  /** Devices that showed at least one notification in the last 7 days. */
  activeDevices: number;
  /** The last 14 days, per kind (newest first). */
  daily: PushDailyDto[];
  /** Big sends go through the queue: true when this server has one. */
  queue: boolean;
}

/** One device that gets notifications, as the admin sees it when testing. */
export interface AdminPushDeviceDto {
  id: string;
  label: string;
  /** The account's address when the device asked for order alerts ('' otherwise). */
  email: string;
  createdAt: string;
  /** Last time the device reported that a notification reached its screen (null: never). */
  seenAt: string | null;
  /** What it gets: "Lunch, dinner · Order alerts". */
  summary: string;
  /** Only right after a test: what the push service said. */
  result?: 'ok' | 'gone' | 'failed';
}

export const AdminPushTestBody = z.object({ email: z.string().trim().toLowerCase().email() });

export interface PushRunDto {
  checked: number;
  sent: number;
  gone: number;
  failed: number;
  /** Due but left for the next run (each run may only send so many). */
  deferred: number;
  /** Handed to the queue, which sends them within a minute or so. */
  queued?: number;
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

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ── Which reminders are due ──────────────────────────────────────────────────

/**
 * The most class reminders a device gets in a day: one "tomorrow's classes" list the night before,
 * plus at most this many nudges before classes. Told to students on the page and in the email.
 */
export const MAX_CLASS_NUDGES_PER_DAY = 8;
export const MAX_CLASS_REMINDERS_PER_DAY = MAX_CLASS_NUDGES_PER_DAY + 1;
/** Devices one account can get reminders on (phone, laptop, tablet). */
export const MAX_REMINDER_DEVICES = 3;

export interface DuePush {
  /** Sent once per key (per device): "mess:2026-11-23:lunch". */
  key: string;
  /** A new notification replaces the last one with the same tag, so they never pile up. */
  tag: 'mess' | 'class' | 'nightly';
  title: string;
  body: string;
  /** The page a tap opens. */
  url: string;
  /** Campus minutes from midnight when the thing starts: the soonest go out first. */
  at?: number;
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
      const ticked = prefs.mess.meals.includes(meal.key);
      if (prefs.mess.only ? !ticked || !favs.length : !ticked && !favs.length) continue;
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
        at: start,
      });
    }
  }

  const c = prefs.classes;
  if (c.before && c.days.includes(clock.day)) {
    // Nudges already sent today count towards the daily cap.
    let nudges = [...sent].filter((k) => k.startsWith(`class:${clock.date}:`)).length;
    const times = c.courses
      .flatMap((course) => course.times.map((t) => ({ course, t })))
      .filter(({ t }) => t.day === clock.day)
      .sort((a, b) => a.t.start - b.t.start);
    for (const { course, t } of times) {
      if (clock.minutes < t.start - c.lead || clock.minutes >= t.start) continue;
      if (sent.has(`class:${clock.date}:${t.start}`)) continue;
      if (nudges >= MAX_CLASS_NUDGES_PER_DAY) break;
      nudges++;
      add({
        key: `class:${clock.date}:${t.start}`,
        tag: 'class',
        title: `${clip(course.name, 40)} in ${t.start - clock.minutes} min`,
        body: [course.code, course.room, formatClock(t.start)].filter(Boolean).join(' · '),
        url: '/tools/timetable',
        at: t.start,
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
          // Not tied to a start time: after the nudges for classes about to begin.
          at: at + 60,
        });
    }
  }
  return out;
}

// ── A restaurant's own insights (the owner's dashboard) ─────────────────────

export const INSIGHT_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

/** The numbers for one period (and, for comparison, the one before it). */
export interface InsightTotalsDto {
  /** Every order placed. */
  orders: number;
  /** Accepted, ready or delivered: the orders that count as sales. */
  confirmed: number;
  /** Takings from confirmed orders, in rupees. */
  revenue: number;
  /** Takings ÷ confirmed orders (0 when none). */
  avgOrder: number;
  cancelledByStudent: number;
  /** Declined, or cancelled later, by the restaurant. */
  cancelledByYou: number;
  /** Nobody answered in 10 minutes. */
  autoCancelled: number;
  /** Still waiting for an answer. */
  waiting: number;
  /** Different students who ordered. */
  customers: number;
  /** Of them: first order here in the year before. */
  newCustomers: number;
  /** Times the restaurant's page was opened (owners and admins not counted). */
  views: number;
  /** Different people (or devices, when signed out) who opened it. */
  visitors: number;
  /** Of them, signed in. */
  signedInVisitors: number;
  /** Signed-in visitors who had ordered here before. */
  pastCustomersVisiting: number;
  /** Ordering students ÷ visitors, as a percentage (0–100), or null with no visitors. */
  conversion: number | null;
  /** Middle time to accept or decline, in minutes (null with too few). */
  replyMinutes: number | null;
}

export interface OwnerInsightsDto {
  period: InsightPeriod;
  /** First and last day covered (campus dates, inclusive). */
  from: string;
  to: string;
  /** "Wed 25 Nov 2026", "23–29 Nov 2026", "November 2026", "2026". */
  label: string;
  /** The anchor dates for the arrows. */
  prevAnchor: string;
  nextAnchor: string | null;
  totals: InsightTotalsDto;
  previous: InsightTotalsDto;
  /** Hours (day), days (week, month) or months (year). */
  series: { key: string; label: string; orders: number; revenue: number; visitors: number; views: number }[];
  topDishes: { name: string; qty: number; revenue: number; orders: number }[];
  /** Orders by hour of day, 0–23 (campus time). */
  hours: number[];
  /** Orders by weekday, Monday first. */
  weekdays: number[];
  modes: { delivery: number; pickup: number };
  topCustomers: { name: string; orders: number; spent: number }[];
  /** Offers used on confirmed orders: how often, and how much they gave away. */
  offers: { label: string; orders: number; discount: number; revenue: number }[];
  /** Every sale in the period (newest first, up to 300): what was sold, to whom, for how much. */
  sales: OwnerSaleDto[];
}

// ════════════════════════════════════════════════════════════════════════════
// Partner app: restaurant owners sign in with their mobile number and a 4-digit PIN
//
// No SMS: the admin checks the number in person when adding the owner, then reads them a one-time
// setup code (valid 24 hours). The owner types number + code, picks a PIN, and stays signed in.
// ════════════════════════════════════════════════════════════════════════════

export const OWNER_PIN = {
  /** Wrong PINs (or setup codes) in a row before the number is locked for a while. */
  maxTries: 5,
  lockMinutes: 15,
  setupHours: 24,
} as const;

const mobileField = z
  .string()
  .trim()
  .refine((v) => normaliseMobile(v) !== null, 'Use a 10-digit Indian mobile number')
  .transform((v) => normaliseMobile(v)!);
const pinField = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'The PIN is 4 digits');

export const partnerLoginSchema = z.object({ phone: mobileField, pin: pinField });
export type PartnerLoginInput = z.infer<typeof partnerLoginSchema>;

export const partnerSetPinSchema = z.object({
  phone: mobileField,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'The setup code is 6 digits'),
  pin: pinField,
});
export type PartnerSetPinInput = z.infer<typeof partnerSetPinSchema>;

/** What a successful sign-in returns: a normal session for the owner's account. */
export interface PartnerSessionDto {
  accessToken: string;
  /** Null in the demo (its tokens aren't refreshed). */
  refreshToken: string | null;
  email: string;
}

export const ownerLoginAddSchema = z.object({
  phone: mobileField,
  name: z.string().trim().max(60).default(''),
  /** The restaurant this owner runs. */
  messSlug: z.string().trim().min(1).max(80),
  /** The owner's own email if they have one; otherwise a private address is made for the number. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type OwnerLoginAddInput = z.infer<typeof ownerLoginAddSchema>;

/** One owner sign-in, as the admin sees it. */
export interface OwnerLoginDto {
  phone: string;
  name: string;
  email: string;
  /** The restaurants this owner runs (names). */
  messes: { slug: string; name: string }[];
  hasPin: boolean;
  /** A setup code is waiting to be used (until this time). */
  setupUntil: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Shown once to the admin, to read out to the owner. */
export interface OwnerSetupCodeDto {
  phone: string;
  code: string;
  expiresAt: string;
}

/** The private address made for an owner without email (never mailed: .invalid can't receive). */
export const ownerAddressFor = (phone: string) => `p${phone}@owners.invalid`;
export const isOwnerAddress = (email: string) => /^p[6-9]\d{9}@owners\.invalid$/.test(email);

/** Admin overview of the apps and the restaurants: owners, devices, orders, takings. */
export interface AppsSummaryDto {
  owners: { total: number; withPin: number; locked: number; signedInThisWeek: number };
  /** Devices that get notifications: browsers (website) and the Android apps. */
  devices: { website: number; apps: number; ownersReachable: number };
  restaurants: { total: number; openNow: number };
  orders: {
    today: number;
    todayRevenue: number;
    month: number;
    monthRevenue: number;
    year: number;
    yearRevenue: number;
    /** Different students who ordered this year. */
    customersThisYear: number;
  };
  /** Per restaurant, this year (best first). */
  byRestaurant: { slug: string; name: string; open: boolean; orders: number; revenue: number }[];
}

/** A student's ordering standing from no-shows (see NO_SHOW), for the cart and their orders. */
export interface OrderStandingDto {
  /** Orders not collected in the last 60 days, at any restaurant. */
  noShows: number;
  /** Every order must be paid first by UPI. */
  payFirst: boolean;
  /** Ordering is paused until this moment (null = not paused). */
  pausedUntil: string | null;
}

/** One sale in an owner's Sales / Insights list. */
export interface OwnerSaleDto {
  id: string;
  code: string;
  at: string;
  name: string;
  items: string;
  /** Rupees the restaurant gets (after any offer). */
  total: number;
  discount: number;
  offer: string;
  mode: 'delivery' | 'pickup';
  /** Paid first by UPI and confirmed by the restaurant. */
  paidUpi: boolean;
  tiffin: boolean;
  /** Paid but never collected (still a sale: the restaurant has the money). */
  notCollected: boolean;
}
