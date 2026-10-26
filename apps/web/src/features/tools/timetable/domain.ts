/** VIT Bhopal's weekly theory grid (from the original timetable maker). */
export const PERIODS = [
  { n: 1, time: '08:30 – 10:00' },
  { n: 2, time: '10:05 – 11:35' },
  { n: 3, time: '11:40 – 13:10' },
  { n: 4, time: '13:15 – 14:45' },
  { n: 5, time: '14:50 – 16:20' },
  { n: 6, time: '16:25 – 17:55' },
  { n: 7, time: '18:00 – 19:30' },
] as const;
/** Lunch sits between period 3 and period 4. */
export const LUNCH_AFTER = 3;

export const GRID: { day: string; slots: string[] }[] = [
  { day: 'Monday', slots: ['A11', 'B11', 'C11', 'A21', 'A14', 'B21', 'C21'] },
  { day: 'Tuesday', slots: ['D11', 'E11', 'F11', 'D21', 'E14', 'E21', 'F21'] },
  { day: 'Wednesday', slots: ['A12', 'B12', 'C12', 'A22', 'B14', 'B22', 'A24'] },
  { day: 'Thursday', slots: ['D12', 'E12', 'F12', 'D22', 'F14', 'E22', 'F22'] },
  { day: 'Friday', slots: ['A13', 'B13', 'C13', 'A23', 'C14', 'B23', 'B24'] },
  { day: 'Saturday', slots: ['D13', 'E13', 'F13', 'D23', 'D14', 'D24', 'E23'] },
];
export const ALL_SLOTS = GRID.flatMap((d) => d.slots);

/**
 * Slot groups as students say them: "A1" is A11 + A12 + A13, "A2" is A21 + A22 + A23, and the
 * single "…4" slots stand alone. Lets someone type "A1+B2" instead of tapping six cells.
 */
export function expandSlots(text: string): { slots: string[]; unknown: string[] } {
  const slots = new Set<string>();
  const unknown: string[] = [];
  for (const raw of text
    .toUpperCase()
    .split(/[\s,+/]+/)
    .filter(Boolean)) {
    if (ALL_SLOTS.includes(raw)) slots.add(raw);
    else if (/^[A-F][12]$/.test(raw)) {
      const found = ALL_SLOTS.filter((s) => s.startsWith(raw) && s.length === 3 && s[2] !== '4');
      if (found.length) for (const s of found) slots.add(s);
      else unknown.push(raw);
    } else unknown.push(raw);
  }
  return { slots: [...slots], unknown };
}

export interface Course {
  id: string;
  name: string;
  code: string;
  teacher: string;
  slots: string[];
  color: string;
  /** Planned but not registered yet: drawn hatched, and may overlap other tentative courses. */
  tentative: boolean;
  /** Where the class is, e.g. "AB1-204" (optional). */
  room?: string;
}

/** Course colours that read well with dark text, in the site's palette family. */
export const COLORS = [
  '#A1D6E2',
  '#F5C96B',
  '#FBC3C9',
  '#B9E4C9',
  '#D7C8F2',
  '#F7D6B5',
  '#BFD3F2',
  '#E6E1A8',
];

/** Which registered (non-tentative) course already holds each slot. */
export function occupied(courses: Course[], exceptId?: string): Map<string, Course> {
  const m = new Map<string, Course>();
  for (const c of courses) if (!c.tentative && c.id !== exceptId) for (const s of c.slots) m.set(s, c);
  return m;
}

/** Slots the new course wants that a registered course already has. */
export function clashes(courses: Course[], slots: string[], tentative: boolean, exceptId?: string) {
  if (tentative) return [];
  const taken = occupied(courses, exceptId);
  return slots.filter((s) => taken.has(s)).map((s) => ({ slot: s, course: taken.get(s)! }));
}

export const nextColor = (courses: Course[]) =>
  COLORS.find((c) => !courses.some((x) => x.color === c)) ?? COLORS[courses.length % COLORS.length]!;

export function stats(courses: Course[]) {
  const registered = courses.filter((c) => !c.tentative);
  return {
    total: ALL_SLOTS.length,
    filled: new Set(registered.flatMap((c) => c.slots)).size,
    courses: registered.length,
    tentative: courses.length - registered.length,
  };
}

// ── Time: what's on now and next ─────────────────────────────────────────────

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
/** Each period's start and end, in minutes from midnight. */
export const PERIOD_TIMES = PERIODS.map((p) => {
  const [start, end] = p.time.split(/\s*[–-]\s*/);
  return { n: p.n, start: minutes(start!), end: minutes(end!), label: p.time };
});

/** Monday = 0 … Saturday = 5; Sunday = -1. */
export const dayIndex = (d: Date) => ((d.getDay() + 6) % 7 === 6 ? -1 : (d.getDay() + 6) % 7);

export interface ClassSlot {
  day: number;
  period: number;
  slot: string;
  course: Course;
  start: number;
  end: number;
}

/** The registered course in each period of a day (planned ones only where nothing is registered). */
export function dayClasses(courses: Course[], day: number): ClassSlot[] {
  const row = GRID[day];
  if (!row) return [];
  const taken = occupied(courses);
  const out: ClassSlot[] = [];
  row.slots.forEach((slot, i) => {
    const course = taken.get(slot) ?? courses.find((c) => c.tentative && c.slots.includes(slot));
    const t = PERIOD_TIMES[i]!;
    if (course) out.push({ day, period: t.n, slot, course, start: t.start, end: t.end });
  });
  return out;
}

/** What's on right now and what's next (looking ahead up to a week). Registered courses only. */
export function nowAndNext(
  courses: Course[],
  at: Date,
): { now: ClassSlot | null; next: ClassSlot | null; nextDay: number } {
  const registered = courses.filter((c) => !c.tentative);
  const today = dayIndex(at);
  const mins = at.getHours() * 60 + at.getMinutes();
  const todays = today >= 0 ? dayClasses(registered, today) : [];
  const now = todays.find((c) => c.start <= mins && mins < c.end) ?? null;
  let next = todays.find((c) => c.start > mins) ?? null;
  let nextDay = 0;
  for (let ahead = 1; !next && ahead <= 7; ahead++) {
    const d = (today + ahead + 7) % 7;
    if (d === 6) continue;
    next = dayClasses(registered, d)[0] ?? null;
    nextDay = ahead;
  }
  return { now, next, nextDay };
}

export const clock = (mins: number) => {
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// ── Share links ─────────────────────────────────────────────────────────────

type Shared = { n: string; c?: string; t?: string; r?: string; s: string[]; k?: string; p?: 1 };

/** A timetable as a short, URL-safe string (no ids; colours kept). */
export function encodeShare(courses: Course[]): string {
  const data: Shared[] = courses.map((x) => ({
    n: x.name,
    ...(x.code ? { c: x.code } : {}),
    ...(x.teacher ? { t: x.teacher } : {}),
    ...(x.room ? { r: x.room } : {}),
    s: x.slots,
    k: x.color,
    ...(x.tentative ? { p: 1 as const } : {}),
  }));
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reads a shared timetable back, keeping only what's valid on this grid. Null if it's not one. */
export function decodeShare(text: string, newId: () => string): Course[] | null {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (!Array.isArray(data) || data.length > 40) return null;
    const out: Course[] = [];
    for (const d of data as Shared[]) {
      const slots = Array.isArray(d.s)
        ? d.s.filter((x) => typeof x === 'string' && ALL_SLOTS.includes(x))
        : [];
      if (!slots.length || typeof d.n !== 'string') continue;
      const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
      out.push({
        id: newId(),
        name: clip(d.n, 80) || 'Course',
        code: clip(d.c, 20),
        teacher: clip(d.t, 60),
        room: clip(d.r, 30),
        slots,
        color: COLORS.includes(d.k ?? '') ? d.k! : nextColor(out),
        tentative: d.p === 1,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// ── Calendar file (.ics) ────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const icsTime = (d: Date, mins: number) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
const icsText = (t: string) => t.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

/**
 * Every registered class as a weekly repeating event from the week of `from`, for `weeks` weeks.
 * Times are local (no time zone), so they show at the right hour on the student's phone.
 */
export function toIcs(courses: Course[], from: Date, weeks = 16): string {
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate() - ((from.getDay() + 6) % 7));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Scholars Stack//Timetable maker//EN',
    'CALSCALE:GREGORIAN',
  ];
  const stamp = `${icsTime(new Date(), new Date().getHours() * 60 + new Date().getMinutes())}`;
  for (const c of courses.filter((x) => !x.tentative))
    GRID.forEach((row, day) =>
      row.slots.forEach((slot, i) => {
        if (!c.slots.includes(slot)) return;
        const t = PERIOD_TIMES[i]!;
        const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day);
        lines.push(
          'BEGIN:VEVENT',
          `UID:${c.id}-${slot}@scholarstack`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsTime(date, t.start)}`,
          `DTEND:${icsTime(date, t.end)}`,
          `RRULE:FREQ=WEEKLY;COUNT=${weeks}`,
          `SUMMARY:${icsText(c.code ? `${c.code} ${c.name}` : c.name)}`,
          ...(c.room ? [`LOCATION:${icsText(c.room)}`] : []),
          `DESCRIPTION:${icsText(`Slot ${slot}${c.teacher ? ` · ${c.teacher}` : ''}`)}`,
          'END:VEVENT',
        );
      }),
    );
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
