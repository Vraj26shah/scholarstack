import { type AdminActivityDto, type AdminInsightsDto, STUCK_SIGNALS, type StuckSignal } from '@ss/contracts';

/**
 * Turns the raw counts behind Admin › Insights into the answers an admin actually asks: which tools
 * get used, where people get stuck, and where the path to buying loses them. Pure functions, so
 * the screen stays simple and the rules can be tested.
 */

const TOOL_NAMES: Record<string, string> = {
  cgpa: 'CGPA calculator',
  attendance: 'Attendance',
  timetable: 'Timetable maker',
  'mess-menu': 'Mess menu',
};

export const toolName = (key: string) =>
  TOOL_NAMES[key] ?? key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home page',
  '/shelf': 'My shelf',
  '/account': 'Account',
  '/contribute': 'Contribute & earn',
  '/help': 'Help',
  '/sign-in': 'Sign-in page',
  '/read': 'Reader',
  '/checkout': 'Payment result page',
  '/other': 'Other pages',
};

/** "/tools/mess-menu" → "Mess menu", "/c/dbms-2025" → "Course page (dbms-2025)". */
export function placeName(page: string): string {
  if (PAGE_NAMES[page]) return PAGE_NAMES[page];
  const m = page.match(/^\/(c|b|tools)\/(.+)$/);
  if (!m) return page;
  if (m[1] === 'tools') return toolName(m[2]!);
  return `${m[1] === 'c' ? 'Course' : 'Bundle'} page (${m[2]})`;
}

const sumWhere = (a: AdminActivityDto | undefined, test: (name: string) => boolean) =>
  (a?.actions ?? []).filter((x) => test(x.target.split(':')[0] ?? '')).reduce((s, x) => s + x.hits, 0);

// ── Tools ──

export interface ToolRow {
  key: string;
  name: string;
  /** Times the tool page was opened. */
  opened: number;
  /** Visits where someone tapped or typed inside it. */
  used: number;
  /** Different signed-in students who opened it. */
  students: number;
  verdict: 'good' | 'mixed' | 'poor' | 'early';
}

/** A tool needs this many opens before we judge it. */
export const MIN_OPENS = 5;

export function toolRows(a: AdminActivityDto | undefined): ToolRow[] {
  const rows = new Map<string, ToolRow>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) {
      r = { key, name: toolName(key), opened: 0, used: 0, students: 0, verdict: 'early' };
      rows.set(key, r);
    }
    return r;
  };
  for (const p of a?.pages ?? []) {
    const key = p.target.match(/^\/tools\/(.+)$/)?.[1];
    if (!key) continue;
    const r = row(key);
    r.opened += p.hits;
    r.students += p.students;
  }
  for (const x of a?.actions ?? []) {
    const key = x.target.match(/^tool_used:\/tools\/(.+)$/)?.[1];
    if (key) row(key).used += x.hits;
  }
  for (const r of rows.values()) {
    // A visit can't be "used" more than opened (a page hit may be missed by an ad blocker).
    r.opened = Math.max(r.opened, r.used);
    const share = r.opened ? r.used / r.opened : 0;
    r.verdict = r.opened < MIN_OPENS ? 'early' : share >= 0.6 ? 'good' : share >= 0.3 ? 'mixed' : 'poor';
  }
  return [...rows.values()].sort((x, y) => y.opened - x.opened || x.name.localeCompare(y.name));
}

export const VERDICT: Record<ToolRow['verdict'], string> = {
  good: 'Most people who open it use it.',
  mixed: 'Many open it and leave without using it.',
  poor: 'Most leave without trying it: make the first step clearer.',
  early: 'Too few visits to judge yet.',
};

// ── Where people get stuck ──

export interface StuckRow {
  signal: StuckSignal;
  page: string;
  place: string;
  /** Page visits where it happened (each kind counted once per visit). */
  times: number;
  students: number;
  what: string;
  fix: string;
}

const FIX: Record<StuckSignal, string> = {
  stuck_error:
    'The page asked the server for data and failed. Check Problems and Sentry for this page; it is often a slow or failing request.',
  stuck_crash: 'The page broke. Admin › Storage › Problems has the exact error and the part of the page.',
  stuck_rage:
    'People kept tapping something that did nothing. Look for text or pictures that look like buttons on this page, or a button that stays disabled without saying why.',
  stuck_form:
    'People got an error message filling a form here. Make the field labels and hints clearer, or relax a rule that trips them.',
  payment_cancelled:
    'People opened the payment window and closed it. The price, the payment options or trust (refund, what they get) may be stopping them.',
};

export function stuckRows(a: AdminActivityDto | undefined): StuckRow[] {
  const out: StuckRow[] = [];
  for (const x of a?.actions ?? []) {
    const [name = '', page = ''] = x.target.split(/:(.*)/s);
    if (!(name in STUCK_SIGNALS)) continue;
    const signal = name as StuckSignal;
    out.push({
      signal,
      page,
      place: page ? placeName(page) : 'Somewhere on the site',
      times: x.hits,
      students: x.students,
      what: STUCK_SIGNALS[signal],
      fix: FIX[signal],
    });
  }
  // Crashes first at the same count: they block the student completely.
  const weight: Record<StuckSignal, number> = {
    stuck_crash: 3,
    stuck_error: 2,
    payment_cancelled: 2,
    stuck_form: 1,
    stuck_rage: 1,
  };
  return out.sort((x, y) => y.times * weight[y.signal] - x.times * weight[x.signal] || y.times - x.times);
}

// ── The path to buying ──

export interface FunnelStep {
  label: string;
  hint: string;
  value: number;
}

export function funnel(data: AdminInsightsDto, a: AdminActivityDto | undefined): FunnelStep[] {
  const s = data.summary;
  return [
    { label: 'Opened a course page', hint: 'Course and bundle page views', value: s.views },
    {
      label: 'Peeked inside',
      hint: 'Opened the free preview pages',
      value: sumWhere(a, (n) => n === 'peek_open'),
    },
    { label: 'Started paying', hint: 'The payment window opened', value: s.checkouts },
    { label: 'Paid', hint: 'Orders paid', value: s.paidOrders },
  ];
}

/** The step that loses the biggest share of people (needs at least 5 people before it). */
export function biggestDrop(steps: FunnelStep[]): number | null {
  let worst: number | null = null;
  let worstShare = 1;
  for (let i = 1; i < steps.length; i++) {
    const before = steps[i - 1]!.value;
    if (before < 5) continue;
    const share = steps[i]!.value / before;
    if (share < worstShare) {
      worstShare = share;
      worst = i;
    }
  }
  return worst;
}

export const DROP_ADVICE: Record<string, string> = {
  'Peeked inside':
    'Most visitors read the course page but never open the preview. Make "Peek inside" more visible, or show a page of the notes right on the course page.',
  'Started paying':
    'People look but don’t start buying. The price, what’s included, or reviews may not convince them yet.',
  Paid: 'People start paying but don’t finish. Check the payment step: UPI apps, failed payments, or a promo code that didn’t work.',
};

/** Signing in: links emailed vs. students who came back signed in. */
export function signIn(a: AdminActivityDto | undefined) {
  return { sent: sumWhere(a, (n) => n === 'signin_link_sent'), signedIn: sumWhere(a, (n) => n === 'login') };
}

export const actionTotal = (a: AdminActivityDto | undefined, name: string) => sumWhere(a, (n) => n === name);

const SOURCE_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  insta: 'Instagram',
  poster: 'Poster (QR)',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  email: 'Email',
};
/** "whatsapp" → "WhatsApp", "class-rep" → "Class rep". */
export const sourceName = (s: string) =>
  SOURCE_NAMES[s] ?? s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export interface SourceRow {
  source: string;
  /** The group, post or poster ("ece-25"), or null when the link had none. */
  campaign: string | null;
  /** Visits that landed from this link. */
  arrived: number;
  /** Of those, how many signed in afterwards (on the same device, within 30 days). */
  signedIn: number;
  /** The page those visits landed on most. */
  topPage: string | null;
}

/**
 * Each tagged link (a WhatsApp group, an Instagram post, a poster): how many people it brought and
 * how many of them signed in. Built from the "from:…" and "signin_from:…" actions. Best first:
 * sign-ins, then visits.
 */
export function sourceRows(a: AdminActivityDto | undefined): SourceRow[] {
  const rows = new Map<string, SourceRow & { pages: Map<string, number> }>();
  const row = (tag: string) => {
    let r = rows.get(tag);
    if (!r) {
      const [source = '', campaign = '-'] = tag.split('/');
      r = {
        source,
        campaign: campaign === '-' ? null : campaign,
        arrived: 0,
        signedIn: 0,
        topPage: null,
        pages: new Map(),
      };
      rows.set(tag, r);
    }
    return r;
  };
  for (const x of a?.actions ?? []) {
    const [kind, tag, page] = x.target.split(':');
    if (!tag || !tag.includes('/')) continue;
    if (kind === 'from') {
      const r = row(tag);
      r.arrived += x.hits;
      if (page) r.pages.set(page, (r.pages.get(page) ?? 0) + x.hits);
    } else if (kind === 'signin_from') row(tag).signedIn += x.hits;
  }
  return [...rows.values()]
    .map(({ pages, ...r }) => ({
      ...r,
      topPage: [...pages.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null,
    }))
    .sort((p, q) => q.signedIn - p.signedIn || q.arrived - p.arrived);
}

/** Totals by source ("WhatsApp: 120 visits, 14 sign-ins"), best first. */
export function sourceTotals(rows: SourceRow[]) {
  const by = new Map<string, { source: string; arrived: number; signedIn: number; links: number }>();
  for (const r of rows) {
    const t = by.get(r.source) ?? { source: r.source, arrived: 0, signedIn: 0, links: 0 };
    t.arrived += r.arrived;
    t.signedIn += r.signedIn;
    t.links += 1;
    by.set(r.source, t);
  }
  return [...by.values()].sort((p, q) => q.signedIn - p.signedIn || q.arrived - p.arrived);
}
