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
