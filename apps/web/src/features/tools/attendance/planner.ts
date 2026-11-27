import { GRID } from '../timetable/domain';
import { marksFor, rounded } from './domain';

/**
 * The exam planner: CAT 1, CAT 2 and Term End each need a rounded attendance above 75%. Which
 * classes count for an exam changes every semester, so the student types the window ("count
 * classes from" and the exam date) and we work out the classes still to come in it from their
 * weekly timetable, minus holidays. Every number uses one rule (domain.ts `rounded`) and one
 * denominator: classes held so far plus every class still to come before the exam.
 */

/** "2026-11-27" (campus calendar date). */
export type Day = string;
export type ExamKind = 'cat' | 'final';

export interface PlanSubject {
  id: string;
  name: string;
  kind: 'theory' | 'lab';
  /** How many classes one lab session counts as (the student's choice). Theory is always 1. */
  labWeight: 1 | 2;
  /** Sessions on each weekday, Monday first (Monday–Saturday). */
  weekly: [number, number, number, number, number, number];
  /** The Timetable maker course it came from, so a second import updates instead of duplicating. */
  courseId?: string;
}

export interface Exam {
  id: string;
  name: string;
  kind: ExamKind;
  /** First day of the exam: classes are counted up to the day before. */
  date: Day;
  /** Where counting starts for this exam; empty means "from the semester start". */
  countFrom: Day;
}

export interface Holiday {
  id: string;
  from: Day;
  to: Day;
  label: string;
}

export interface Counts {
  attended: number;
  held: number;
}

export interface PlannerState {
  v: 2;
  semesterStart: Day;
  subjects: PlanSubject[];
  exams: Exam[];
  holidays: Holiday[];
  /** counts[subjectId][window] where window is the exam's count-from date ("" = semester start). */
  counts: Record<string, Record<string, Counts>>;
}

export const RULE_TEXT: Record<ExamKind, string> = {
  cat: 'Below 75% you need your teacher’s approval to sit it.',
  final: 'Below 75% you can’t sit the Term End exam.',
};

const DAY_MS = 86_400_000;
const isDay = (v: unknown): v is Day =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const addDays = (d: Day, n: number): Day =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (d: Day) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
/** Today on the campus clock (IST), whatever the phone's time zone. */
export const campusToday = (now = Date.now()): Day =>
  new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);

export const sessionWeight = (s: PlanSubject) => (s.kind === 'lab' ? s.labWeight : 1);
/** The window an exam counts in: its own start, or the semester's. */
export const windowOf = (exam: Exam) => exam.countFrom || '';
export const windowStart = (state: Pick<PlannerState, 'semesterStart'>, exam: Exam): Day =>
  exam.countFrom || state.semesterStart;

export function isHoliday(d: Day, holidays: Holiday[]) {
  return holidays.some(
    (h) => isDay(h.from) && d >= h.from && d <= (isDay(h.to) && h.to >= h.from ? h.to : h.from),
  );
}

/**
 * Classes (weighted) the subject still has after `after` and before `exam.date`, not before the
 * exam's window starts, skipping Sundays and holidays.
 */
export function remainingClasses(
  subject: PlanSubject,
  exam: Exam,
  after: Day,
  holidays: Holiday[],
  start: Day = '',
): number {
  if (!isDay(exam.date)) return 0;
  let d = addDays(after, 1);
  if (isDay(start) && start > d) d = start;
  const w = sessionWeight(subject);
  let n = 0;
  // Bounded walk: a semester is months, never more than a few hundred days.
  for (let i = 0; d < exam.date && i < 800; i++, d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 6 || isHoliday(d, holidays)) continue;
    n += (subject.weekly[wd] ?? 0) * w;
  }
  return n;
}

/** Days with at least one class left before the exam (for the summary line). */
export function teachingDaysLeft(state: PlannerState, exam: Exam, after: Day): number {
  if (!isDay(exam.date)) return 0;
  const start = windowStart(state, exam);
  let d = addDays(after, 1);
  if (isDay(start) && start > d) d = start;
  let n = 0;
  for (let i = 0; d < exam.date && i < 800; i++, d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 6 || isHoliday(d, state.holidays)) continue;
    if (state.subjects.some((s) => (s.weekly[wd] ?? 0) > 0)) n++;
  }
  return n;
}

export type PlanStatus = 'safe' | 'recover' | 'risk' | 'empty' | 'invalid';

export interface SubjectPlan {
  subject: PlanSubject;
  counts: Counts;
  /** Rounded % now, or null before any class is held. */
  now: number | null;
  /** Classes (weighted) still to come before the exam. */
  remaining: number;
  /** Sessions still to come (labs: sessions, not classes). */
  remainingSessions: number;
  /** Rounded % on exam day if every remaining class is attended. */
  ifAll: number | null;
  /** Most sessions that can be skipped and still be above 75% on exam day; null when impossible. */
  canSkip: number | null;
  /** Fewest of the remaining sessions to attend; null when impossible. */
  mustAttend: number | null;
  /** Rounded % right after skipping the very next session. */
  ifSkipNext: number | null;
  /** Attendance marks on exam day if every remaining class is attended. */
  marks: number;
  status: PlanStatus;
}

export function planSubject(subject: PlanSubject, counts: Counts, remaining: number): SubjectPlan {
  const w = sessionWeight(subject);
  const { attended: a, held: t } = counts;
  const total = t + remaining;
  const remainingSessions = Math.round(remaining / w);
  const base = {
    subject,
    counts,
    now: t > 0 ? rounded(a, t) : null,
    remaining,
    remainingSessions,
    ifSkipNext: remaining > 0 && t + w > 0 ? rounded(a, t + w) : null,
  };
  if (a > t)
    return {
      ...base,
      now: null,
      ifSkipNext: null,
      ifAll: null,
      canSkip: null,
      mustAttend: null,
      marks: 0,
      status: 'invalid',
    };
  if (total <= 0) return { ...base, ifAll: null, canSkip: null, mustAttend: null, marks: 0, status: 'empty' };
  const ifAll = rounded(a + remaining, total);
  const skipClasses = skippable(a, t, remaining);
  if (skipClasses === null)
    return { ...base, ifAll, canSkip: null, mustAttend: null, marks: marksFor(ifAll), status: 'risk' };
  // Whole sessions only: half a lab can't be skipped.
  const skipSessions = Math.floor(skipClasses / w);
  return {
    ...base,
    ifAll,
    canSkip: skipSessions,
    mustAttend: remainingSessions - skipSessions,
    marks: marksFor(ifAll),
    // Above 75 now (or nothing held yet) and able to stay there: safe. Below now but reachable: recover.
    status: base.now === null || base.now > 75 ? 'safe' : 'recover',
  };
}

/**
 * Classes out of the remaining R that can be skipped: skipping k means attending (A + R − k) of
 * (T + R), a fixed total, so this solves the rounded rule directly. Null when even attending all
 * of them doesn't get above 75%.
 */
export function skippable(attended: number, held: number, remaining: number): number | null {
  const total = held + remaining;
  if (total <= 0 || rounded(attended + remaining, total) <= 75) return null;
  // rounded(x, total) > 75 ⇔ x/total ≥ 0.755 (bar float edges): start near it, then correct.
  let k = Math.max(0, Math.min(remaining, Math.floor(attended + remaining - 0.755 * total)));
  while (k > 0 && rounded(attended + remaining - k, total) <= 75) k--;
  while (k < remaining && rounded(attended + remaining - k - 1, total) > 75) k++;
  return k;
}

export function planFor(state: PlannerState, exam: Exam, today: Day): SubjectPlan[] {
  const win = windowOf(exam);
  const start = windowStart(state, exam);
  return state.subjects.map((s) => {
    const counts = state.counts[s.id]?.[win] ?? { attended: 0, held: 0 };
    return planSubject(s, counts, remainingClasses(s, exam, today, state.holidays, start));
  });
}

/** The next exam that hasn't started yet; otherwise the last one. */
export function upcomingExam(exams: Exam[], today: Day): Exam | undefined {
  const dated = exams.filter((e) => isDay(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  return dated.find((e) => e.date > today) ?? dated.at(-1) ?? exams[0];
}

/** Sessions per weekday for a Timetable maker course (theory grid slots). */
export function weeklyFromSlots(slots: string[]): PlanSubject['weekly'] {
  const out: PlanSubject['weekly'] = [0, 0, 0, 0, 0, 0];
  GRID.forEach((day, i) => {
    out[i] = day.slots.filter((s) => slots.includes(s)).length;
  });
  return out;
}

export const blankState = (): PlannerState => ({
  v: 2,
  semesterStart: '',
  subjects: [],
  exams: [
    { id: 'cat1', name: 'CAT 1', kind: 'cat', date: '', countFrom: '' },
    { id: 'cat2', name: 'CAT 2', kind: 'cat', date: '', countFrom: '' },
    { id: 'tee', name: 'Term End', kind: 'final', date: '', countFrom: '' },
  ],
  holidays: [],
  counts: {},
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Kept as typed (attended may briefly exceed held while someone types); the plan flags it. */
function readCounts(v: unknown): Counts {
  const o = obj(v);
  return { held: Math.min(num(o.held), 9999), attended: Math.min(num(o.attended), 9999) };
}

/**
 * Reads whatever was saved, field by field, so an old or damaged copy never crashes the page.
 * Version 1 (a flat list of {name, attended, total}) becomes subjects counted from the semester start.
 */
export function readState(saved: unknown, legacy: unknown = null): PlannerState {
  const fresh = blankState();
  const o = obj(saved);
  if (o.v !== 2) {
    if (!Array.isArray(legacy)) return fresh;
    for (const item of legacy.slice(0, 40)) {
      const s = obj(item);
      const id = str(s.id, 20) || Math.random().toString(36).slice(2, 10);
      fresh.subjects.push({
        id,
        name: str(s.name) || 'Subject',
        kind: 'theory',
        labWeight: 1,
        weekly: [0, 0, 0, 0, 0, 0],
      });
      fresh.counts[id] = { '': readCounts({ held: s.total, attended: s.attended }) };
    }
    return fresh;
  }
  const subjects: PlanSubject[] = (Array.isArray(o.subjects) ? o.subjects : [])
    .slice(0, 40)
    .flatMap((item) => {
      const s = obj(item);
      const id = str(s.id, 40);
      if (!id) return [];
      const wk = Array.isArray(s.weekly) ? s.weekly : [];
      const sub: PlanSubject = {
        id,
        name: str(s.name) || 'Subject',
        kind: s.kind === 'lab' ? 'lab' : 'theory',
        labWeight: s.labWeight === 2 ? 2 : 1,
        weekly: [0, 1, 2, 3, 4, 5].map((i) => Math.min(num(wk[i]), 7)) as PlanSubject['weekly'],
      };
      const courseId = str(s.courseId, 40);
      return [courseId ? { ...sub, courseId } : sub];
    });
  const exams: Exam[] = (Array.isArray(o.exams) ? o.exams : []).slice(0, 8).flatMap((item) => {
    const e = obj(item);
    const id = str(e.id, 40);
    if (!id) return [];
    return [
      {
        id,
        name: str(e.name, 40) || 'Exam',
        kind: e.kind === 'final' ? 'final' : 'cat',
        date: isDay(e.date) ? e.date : '',
        countFrom: isDay(e.countFrom) ? e.countFrom : '',
      },
    ];
  });
  const holidays: Holiday[] = (Array.isArray(o.holidays) ? o.holidays : []).slice(0, 60).flatMap((item) => {
    const h = obj(item);
    if (!isDay(h.from)) return [];
    return [
      {
        id: str(h.id, 40) || h.from,
        from: h.from,
        to: isDay(h.to) && h.to >= h.from ? h.to : h.from,
        label: str(h.label, 60),
      },
    ];
  });
  const counts: PlannerState['counts'] = {};
  for (const [sid, wins] of Object.entries(obj(o.counts))) {
    if (!subjects.some((s) => s.id === sid)) continue;
    counts[sid] = {};
    for (const [win, c] of Object.entries(obj(wins)))
      if (win === '' || isDay(win)) counts[sid][win] = readCounts(c);
  }
  return {
    v: 2,
    semesterStart: isDay(o.semesterStart) ? o.semesterStart : '',
    subjects,
    exams: exams.length ? exams : fresh.exams,
    holidays,
    counts,
  };
}

/**
 * One class just happened: add it to every counting window it belongs to (each upcoming exam's
 * window that has already started), so "+ Attended" after a class keeps every exam right.
 */
export function recordClass(
  state: PlannerState,
  subjectId: string,
  attended: boolean,
  today: Day,
): PlannerState {
  const subject = state.subjects.find((s) => s.id === subjectId);
  if (!subject) return state;
  const w = sessionWeight(subject);
  const wins = new Set<string>();
  for (const e of state.exams) {
    if (isDay(e.date) && e.date <= today) continue;
    const start = windowStart(state, e);
    if (!isDay(start) || start <= today) wins.add(windowOf(e));
  }
  if (!wins.size) wins.add('');
  const mine = { ...(state.counts[subjectId] ?? {}) };
  for (const win of wins) {
    const c = mine[win] ?? { attended: 0, held: 0 };
    mine[win] = { held: c.held + w, attended: c.attended + (attended ? w : 0) };
  }
  return { ...state, counts: { ...state.counts, [subjectId]: mine } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** "Thu 10 Dec". */
export const shortDay = (d: Day) =>
  isDay(d) ? `${WEEKDAYS[weekdayOf(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : '';
export { isDay };
