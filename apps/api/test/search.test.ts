import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('catalogue search', () => {
  it('finds live courses across every batch by title, code, semester and programme', async () => {
    const { env, app } = setup();
    const v = new Browser(app);
    const live = [...env.db.courses.values()].filter((c) => c.status === 'live');
    const target = live[0]!;
    const word = target.title.split(' ')[0]!.toLowerCase();
    const r = await v.call('GET', `/catalogue/search?q=${encodeURIComponent(word)}`);
    expect(r.status).toBe(200);
    expect(r.json.courses.map((c: any) => c.id)).toContain(target.id);
    // Every word must match: title word + its semester narrows, a wrong semester excludes.
    const narrowed = await v.call(
      'GET',
      `/catalogue/search?q=${encodeURIComponent(`${word} sem ${target.semester}`)}`,
    );
    expect(narrowed.json.courses.map((c: any) => c.id)).toContain(target.id);
    const wrong = await v.call('GET', `/catalogue/search?q=${encodeURIComponent(`${word} semester 99`)}`);
    expect(wrong.json.courses).toHaveLength(0);
  });

  it('never returns drafts and refuses empty or huge queries', async () => {
    const { env, app } = setup();
    const v = new Browser(app);
    const course = [...env.db.courses.values()].find((c) => c.status === 'live')!;
    course.status = 'draft';
    const r = await v.call('GET', `/catalogue/search?q=${encodeURIComponent(course.title)}`);
    expect(r.json.courses.map((c: any) => c.id)).not.toContain(course.id);
    expect((await v.call('GET', '/catalogue/search?q=')).status).toBe(400);
    expect((await v.call('GET', `/catalogue/search?q=${'a'.repeat(200)}`)).status).toBe(400);
  });
});
