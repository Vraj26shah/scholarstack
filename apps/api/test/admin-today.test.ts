import { describe, expect, it } from 'vitest';
import { openProblems, todaySummary } from '../src/application/admin-today';
import { Browser, setup } from './harness';

describe('admin today', () => {
  it('lists what needs the admin, in a fixed order', async () => {
    const { app } = setup();
    const s = new Browser(app);
    await s.signIn('student.23bce10020@vitbhopal.ac.in');
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const r = await a.call('GET', '/admin/today');
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: any) => i.key)).toEqual([
      'questions',
      'uploads',
      'publish',
      'files',
      'rewards',
      'emails',
      'problems',
    ]);
    expect(r.json.items.every((i: any) => typeof i.count === 'number')).toBe(true);
    expect((await s.call('GET', '/admin/today')).status).toBe(403);
  });

  it('a part that fails shows as unknown, the rest still load', async () => {
    const ok = async () => 2;
    const t = await todaySummary({
      questions: ok,
      uploads: async () => {
        throw new Error('down');
      },
      publish: ok,
      files: ok,
      rewards: async () => ({ count: 1, amountPaise: 5000 }),
      emails: ok,
      problems: ok,
    });
    expect(t.items.find((i) => i.key === 'uploads')!.count).toBeNull();
    expect(t.items.find((i) => i.key === 'rewards')).toEqual({ key: 'rewards', count: 1, amountPaise: 5000 });
    expect(t.items.find((i) => i.key === 'questions')!.count).toBe(2);
  });

  it('a part that takes too long shows as unknown, is reported, and never holds up the rest', async () => {
    const ok = async () => 1;
    const timedOut: string[] = [];
    const t0 = Date.now();
    const t = await todaySummary(
      {
        questions: ok,
        uploads: ok,
        publish: ok,
        files: ok,
        rewards: () => new Promise(() => {}), // never answers
        emails: ok,
        problems: ok,
      },
      new Date(),
      { timeoutMs: 50, onTimeout: (key) => timedOut.push(key) },
    );
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(t.items.find((i) => i.key === 'rewards')!.count).toBeNull();
    expect(t.items.find((i) => i.key === 'questions')!.count).toBe(1);
    expect(timedOut).toEqual(['rewards']);
  });

  it('counts problems until they are cleared, however old', () => {
    expect(openProblems([{ lastAt: '2026-10-26T01:00:00Z' }, { lastAt: '2026-10-01T01:00:00Z' }])).toBe(2);
    expect(openProblems([])).toBe(0);
  });
});
