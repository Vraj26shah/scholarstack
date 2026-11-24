import type { AdminActivityDto, AdminInsightsDto } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { biggestDrop, funnel, stuckRows, toolRows } from '../features/admin/insights-derive';

const activity = (
  pages: [string, number, number][],
  actions: [string, number, number][],
): AdminActivityDto => ({
  days: '7',
  checkedAt: '2026-11-24T00:00:00Z',
  summary: { activeStudents: 0, studentPages: 0, visitorPages: 0, actions: 0 },
  daily: [],
  pages: pages.map(([target, hits, students]) => ({
    target,
    hits,
    studentHits: hits,
    visitorHits: 0,
    students,
  })),
  actions: actions.map(([target, hits, students]) => ({ target, hits, visitorHits: 0, students })),
  students: [],
});

describe('Insights answers', () => {
  it('tells tools people use from tools people only open', () => {
    const rows = toolRows(
      activity(
        [
          ['/tools/cgpa', 20, 10],
          ['/tools/mess-menu', 10, 6],
          ['/tools/timetable', 2, 2],
          ['/shelf', 50, 20],
        ],
        [
          ['tool_used:/tools/cgpa', 16, 9],
          ['tool_used:/tools/mess-menu', 2, 2],
          ['tool_used:/tools/timetable', 2, 2],
        ],
      ),
    );
    expect(rows.map((r) => [r.name, r.opened, r.used, r.verdict])).toEqual([
      ['CGPA calculator', 20, 16, 'good'],
      ['Mess menu', 10, 2, 'poor'],
      ['Timetable maker', 2, 2, 'early'],
    ]);
  });

  it('lists where people got stuck, crashes before tapping at the same count', () => {
    const rows = stuckRows(
      activity(
        [],
        [
          ['stuck_rage:/tools/mess-menu', 3, 1],
          ['stuck_crash:/shelf', 3, 2],
          ['login', 9, 9],
        ],
      ),
    );
    expect(rows.map((r) => [r.place, r.signal, r.times])).toEqual([
      ['My shelf', 'stuck_crash', 3],
      ['Mess menu', 'stuck_rage', 3],
    ]);
  });

  it('finds the step on the way to buying that loses the most people', () => {
    const data = {
      summary: { views: 100, checkouts: 20, paidOrders: 4 },
    } as unknown as AdminInsightsDto;
    const steps = funnel(data, activity([], [['peek_open:/c/a', 60, 30]]));
    expect(steps.map((s) => s.value)).toEqual([100, 60, 20, 4]);
    expect(steps[biggestDrop(steps)!]!.label).toBe('Paid'); // 20 → 4 is 20%, worse than 60 → 20
  });
});
