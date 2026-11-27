import { describe, expect, it } from 'vitest';
import { rounded } from '../features/tools/attendance/domain';
import {
  type Exam,
  type PlanSubject,
  type PlannerState,
  blankState,
  planFor,
  planSubject,
  readState,
  recordClass,
  remainingClasses,
  skippable,
  upcomingExam,
  weeklyFromSlots,
} from '../features/tools/attendance/planner';

const theory = (weekly: PlanSubject['weekly'], extra: Partial<PlanSubject> = {}): PlanSubject => ({
  id: 's1',
  name: 'DS',
  kind: 'theory',
  labWeight: 1,
  weekly,
  ...extra,
});
const exam = (date: string, countFrom = ''): Exam => ({
  id: 'e',
  name: 'CAT 2',
  kind: 'cat',
  date,
  countFrom,
});

describe('remaining classes', () => {
  // 2026-11-30 is a Monday.
  it('counts from the day after today up to the day before the exam, never Sundays', () => {
    const s = theory([1, 1, 1, 1, 1, 1]);
    // Tue 1 Dec … Mon 7 Dec (exam Tue 8 Dec): Tue–Sat = 5, Sun skipped, Mon = 1.
    expect(remainingClasses(s, exam('2026-12-08'), '2026-11-30', [])).toBe(6);
    // Exam tomorrow: nothing left.
    expect(remainingClasses(s, exam('2026-12-01'), '2026-11-30', [])).toBe(0);
    // Exam already past.
    expect(remainingClasses(s, exam('2026-11-20'), '2026-11-30', [])).toBe(0);
  });
  it('skips holidays, including multi-day ranges', () => {
    const s = theory([2, 0, 0, 0, 0, 0]);
    const holidays = [{ id: 'h', from: '2026-12-07', to: '2026-12-07', label: '' }];
    // Mondays 7 and 14 Dec before 15 Dec; 7 Dec is a holiday.
    expect(remainingClasses(s, exam('2026-12-15'), '2026-11-30', holidays)).toBe(2);
    const range = [{ id: 'r', from: '2026-12-01', to: '2026-12-20', label: '' }];
    expect(remainingClasses(s, exam('2026-12-22'), '2026-11-30', range)).toBe(2); // only Mon 21 Dec
  });
  it('weights a lab session by the student’s choice', () => {
    const lab = theory([1, 0, 0, 0, 0, 0], { kind: 'lab', labWeight: 2 });
    expect(remainingClasses(lab, exam('2026-12-15'), '2026-11-30', [])).toBe(4); // 2 Mondays × 2
  });
  it('does not count before the exam’s own window starts', () => {
    const s = theory([1, 1, 1, 1, 1, 1]);
    expect(remainingClasses(s, exam('2026-12-15'), '2026-11-30', [], '2026-12-14')).toBe(1);
  });
});

describe('skipping with a fixed total', () => {
  it('stays above 75 (rounded) and one more skip would not', () => {
    for (let held = 0; held <= 60; held += 3) {
      for (let attended = 0; attended <= held; attended += 2) {
        for (const remaining of [0, 1, 5, 20]) {
          const total = held + remaining;
          const k = skippable(attended, held, remaining);
          if (total === 0 || rounded(attended + remaining, total) <= 75) {
            expect(k).toBeNull();
            continue;
          }
          expect(k).not.toBeNull();
          expect(rounded(attended + remaining - k!, total)).toBeGreaterThan(75);
          if (k! < remaining) expect(rounded(attended + remaining - k! - 1, total)).toBeLessThanOrEqual(75);
        }
      }
    }
  });
  it('treats exactly 75% (rounded) as not enough', () => {
    // 30 of 40 = 75 → not eligible, nothing to skip.
    expect(skippable(30, 40, 0)).toBeNull();
    // 74.5% rounds to 75 → still not enough: 149 of 200.
    expect(skippable(149, 200, 0)).toBeNull();
    // 75.5% rounds to 76 → eligible: 151 of 200.
    expect(skippable(151, 200, 0)).toBe(0);
  });
});

describe('subject plan', () => {
  it('says impossible clearly instead of a fake success', () => {
    const p = planSubject(theory([1, 0, 0, 0, 0, 0]), { attended: 10, held: 30 }, 4);
    expect(p.status).toBe('risk');
    expect(p.canSkip).toBeNull();
    expect(p.mustAttend).toBeNull();
    expect(p.ifAll).toBe(41); // 14/34
  });
  it('recovers when below 75 now but reachable', () => {
    const p = planSubject(theory([1, 1, 1, 1, 1, 0]), { attended: 20, held: 28 }, 20);
    expect(p.now).toBe(71);
    expect(p.status).toBe('recover');
    // Must attend enough that (20 + attend) / 48 rounds above 75.
    expect(rounded(20 + p.mustAttend!, 48)).toBeGreaterThan(75);
    expect(rounded(20 + p.mustAttend! - 1, 48)).toBeLessThanOrEqual(75);
  });
  it('counts lab skips in whole sessions', () => {
    const lab = theory([1, 0, 0, 0, 0, 0], { kind: 'lab', labWeight: 2 });
    // 20/20 held, 10 classes (5 sessions) left: total 30, may drop to 23 attended (76.7%) → 7 classes → 3 sessions.
    const p = planSubject(lab, { attended: 20, held: 20 }, 10);
    expect(p.remainingSessions).toBe(5);
    expect(p.canSkip).toBe(3);
    expect(p.mustAttend).toBe(2);
    expect(rounded(30 - 3 * 2, 30)).toBeGreaterThan(75);
  });
  it('shows the effect of skipping the next class', () => {
    const p = planSubject(theory([1, 0, 0, 0, 0, 0]), { attended: 31, held: 40 }, 3);
    expect(p.ifSkipNext).toBe(rounded(31, 41));
  });
  it('flags more attended than held instead of guessing', () => {
    expect(planSubject(theory([1, 0, 0, 0, 0, 0]), { attended: 12, held: 10 }, 3).status).toBe('invalid');
  });
  it('is empty before anything is known', () => {
    expect(planSubject(theory([0, 0, 0, 0, 0, 0]), { attended: 0, held: 0 }, 0).status).toBe('empty');
  });
});

describe('planner state', () => {
  it('shares counts between exams on the same window and separates a reset window', () => {
    const state: PlannerState = {
      ...blankState(),
      subjects: [theory([1, 0, 0, 0, 0, 0])],
      counts: { s1: { '': { attended: 9, held: 10 }, '2026-12-01': { attended: 1, held: 4 } } },
    };
    const shared = planFor(state, exam('2026-12-15'), '2026-11-30');
    expect(shared[0]!.counts).toEqual({ attended: 9, held: 10 });
    const reset = planFor(state, exam('2026-12-15', '2026-12-01'), '2026-11-30');
    expect(reset[0]!.counts).toEqual({ attended: 1, held: 4 });
  });
  it('picks the next exam that has not started', () => {
    const exams: Exam[] = [
      { id: 'a', name: 'CAT 1', kind: 'cat', date: '2026-10-01', countFrom: '' },
      { id: 'b', name: 'CAT 2', kind: 'cat', date: '2026-12-10', countFrom: '' },
      { id: 'c', name: 'Term End', kind: 'final', date: '2027-01-10', countFrom: '' },
    ];
    expect(upcomingExam(exams, '2026-11-30')?.id).toBe('b');
    expect(upcomingExam(exams, '2027-02-01')?.id).toBe('c');
  });
  it('reads the old saved list and damaged data without crashing', () => {
    const migrated = readState(null, [
      { id: 'x', name: 'Maths', attended: 30, total: 40 },
      'junk',
      { total: -3 },
    ]);
    expect(migrated.subjects).toHaveLength(3);
    expect(migrated.counts.x?.['']).toEqual({ attended: 30, held: 40 });
    expect(migrated.exams.map((e) => e.name)).toEqual(['CAT 1', 'CAT 2', 'Term End']);
    const damaged = readState({
      v: 2,
      subjects: [{ id: 'q', weekly: 'no', kind: 'lab', labWeight: 9 }],
      exams: 5,
      counts: { q: { '': { attended: 50, held: 10 } } },
    });
    expect(damaged.subjects[0]).toMatchObject({ kind: 'lab', labWeight: 1, weekly: [0, 0, 0, 0, 0, 0] });
    expect(damaged.counts.q?.['']).toEqual({ attended: 50, held: 10 });
    expect(damaged.exams).toHaveLength(3);
    expect(readState('garbage').subjects).toEqual([]);
  });
  it('adds a class to every window that has started, weighted for labs', () => {
    const state: PlannerState = {
      ...blankState(),
      semesterStart: '2026-07-20',
      subjects: [theory([1, 0, 0, 0, 0, 0], { kind: 'lab', labWeight: 2 })],
      exams: [
        { id: 'a', name: 'CAT 2', kind: 'cat', date: '2026-12-14', countFrom: '' },
        { id: 'b', name: 'Term End', kind: 'final', date: '2027-01-11', countFrom: '2026-11-01' },
        { id: 'c', name: 'Later', kind: 'cat', date: '2027-03-01', countFrom: '2027-01-20' },
      ],
    };
    const next = recordClass(state, 's1', false, '2026-11-30');
    expect(next.counts.s1).toEqual({ '': { attended: 0, held: 2 }, '2026-11-01': { attended: 0, held: 2 } });
  });
  it('turns timetable slots into classes per weekday', () => {
    // A1 = A11 (Mon) + A12 (Wed) + A13 (Fri); A14 is Monday too.
    expect(weeklyFromSlots(['A11', 'A12', 'A13', 'A14'])).toEqual([2, 0, 1, 0, 1, 0]);
  });
});
