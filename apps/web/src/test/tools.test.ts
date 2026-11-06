import { describe, expect, it } from 'vitest';
import { canMiss, evaluate, marksFor, mustAttend, rounded } from '../features/tools/attendance/domain';
import { neededNext, overallCgpa, semesterGpa } from '../features/tools/cgpa/domain';
import { type Course, clashes, expandSlots, stats } from '../features/tools/timetable/domain';

describe('CGPA', () => {
  it('weights grades by credits and skips incomplete rows', () => {
    const r = semesterGpa([
      { id: '1', name: 'Maths', credits: 4, grade: 'A' },
      { id: '2', name: 'Physics', credits: 3, grade: 'B' },
      { id: '3', name: 'Chem', credits: 3, grade: 'S' },
      { id: '4', name: 'Blank', credits: '', grade: 'S' },
    ]);
    expect(r?.counted).toBe(3);
    expect(r?.gpa).toBeCloseTo((4 * 9 + 3 * 8 + 3 * 10) / 10);
  });
  it('combines semesters into a CGPA', () => {
    expect(
      overallCgpa([
        { id: 'a', label: '1', gpa: 8, credits: 20 },
        { id: 'b', label: '2', gpa: 9, credits: 20 },
      ])?.cgpa,
    ).toBe(8.5);
  });
  it('works out the GPA needed next semester', () => {
    expect(neededNext(8, 40, 20, 8.5)?.needed).toBeCloseTo(9.5);
    expect(neededNext(6, 100, 20, 9)?.reachable).toBe(false);
    expect(neededNext(10.1, 40, 20, 9)).toBeNull();
    expect(neededNext(8, 40, 20, 10.1)).toBeNull();
    expect(neededNext(Number.POSITIVE_INFINITY, 40, 20, 9)).toBeNull();
  });
});

describe('attendance', () => {
  it('follows the rounded-above-75 rule and the marks bands', () => {
    expect(marksFor(75)).toBe(0);
    expect(marksFor(76)).toBe(1);
    expect(marksFor(96)).toBe(5);
    const r = evaluate(30, 40);
    expect('error' in r ? null : r.percent).toBe(75);
    expect('error' in r ? null : r.standing).toBe('edge');
  });
  it('counts safe misses and classes needed', () => {
    expect(canMiss(38, 40)).toBe(10);
    expect(mustAttend(30, 40)).toBe(1);
    expect(mustAttend(39, 40)).toBe(0);
    expect('error' in evaluate(41, 40)).toBe(true);
  });
  it('does not cap recovery calculations at 10,000 classes', () => {
    const needed = mustAttend(1, 100_000);
    expect(needed).toBeGreaterThan(10_000);
    expect(rounded(1 + needed!, 100_000 + needed!)).toBeGreaterThan(75);
    expect(rounded(needed!, 99_999 + needed!)).toBeLessThanOrEqual(75);
    expect(mustAttend(0, 40)).toBe(124);
  });
  it('keeps miss and recovery counts on the rounded 75% boundary', () => {
    for (let total = 1; total <= 120; total++) {
      for (let attended = 0; attended <= total; attended++) {
        const miss = canMiss(attended, total);
        if (rounded(attended, total) > 75) {
          expect(rounded(attended, total + miss)).toBeGreaterThan(75);
          expect(rounded(attended, total + miss + 1)).toBeLessThanOrEqual(75);
        } else expect(miss).toBe(0);

        const needed = mustAttend(attended, total);
        expect(needed).not.toBeNull();
        expect(rounded(attended + needed!, total + needed!)).toBeGreaterThan(75);
        if (needed! > 0) expect(rounded(attended + needed! - 1, total + needed! - 1)).toBeLessThanOrEqual(75);
      }
    }
  });
});

describe('timetable', () => {
  it('expands slot groups like A1 and B2', () => {
    expect(expandSlots('A1+B2').slots.sort()).toEqual(['A11', 'A12', 'A13', 'B21', 'B22', 'B23'].sort());
    expect(expandSlots('A14, Z9').unknown).toEqual(['Z9']);
  });
  it('finds clashes only with registered courses', () => {
    const c: Course[] = [
      { id: '1', name: 'DBMS', code: '', teacher: '', slots: ['A11'], color: '#fff', tentative: false },
    ];
    expect(clashes(c, ['A11', 'B11'], false)).toHaveLength(1);
    expect(clashes(c, ['A11'], true)).toHaveLength(0);
    expect(stats(c)).toMatchObject({ total: 42, filled: 1, courses: 1 });
  });
});

describe('tool storage', () => {
  it('a memory store stands in for the browser store', async () => {
    const { memoryStore } = await import('../features/tools/core/storage');
    const store = memoryStore();
    expect(store.load('x', 1)).toBe(1);
    store.save('x', 2);
    expect(store.load('x', 1)).toBe(2);
  });
  it('every registered tool has a key, an icon and a screen', async () => {
    const { toolModule } = await import('../features/tools/registry');
    for (const key of ['cgpa', 'attendance', 'timetable']) {
      const m = toolModule(key);
      expect(m?.key).toBe(key);
      expect(m?.icon).toBeTruthy();
      expect(m?.screen).toBeTruthy();
    }
    expect(toolModule('nope')).toBeUndefined();
  });

  it('only stamps a listed tool Live when it has a registered screen', async () => {
    const { toolCardStatus } = await import('../features/tools/toolbox');
    expect(toolCardStatus({ key: 'cgpa', status: 'live' })).toEqual({
      ready: true,
      live: true,
      label: 'Live',
    });
    expect(toolCardStatus({ key: 'cgpa', status: 'soon' })).toEqual({
      ready: true,
      live: false,
      label: 'Coming soon',
    });
    expect(toolCardStatus({ key: 'unbuilt', status: 'live' })).toEqual({
      ready: false,
      live: false,
      label: 'Coming soon',
    });
  });
});
