import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

describe('deleting bundles', () => {
  it('a bundle nobody ordered is deleted; one with orders must be archived instead', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const live = [...env.db.courses.values()]
      .filter((c) => c.status === 'live' && c.batchYear === 2025)
      .slice(0, 2);
    const made = (
      await a.call('POST', '/admin/bundles', {
        title: 'Throwaway pack',
        description: '',
        batchYear: 2025,
        courseIds: live.map((c) => c.id),
        pricePaise: 100,
        status: 'draft',
      })
    ).json;
    expect((await a.call('DELETE', `/admin/bundles/${made.id}`)).status).toBe(200);
    expect((await a.call('GET', '/admin/bundles')).json.some((b: any) => b.id === made.id)).toBe(false);

    const sold = [...env.db.bundles.values()].find((b) => b.status === 'live')!;
    const s = new Browser(app);
    await s.signIn('buyer@vitbhopal.ac.in');
    await pay(s, { bundleId: sold.id });
    const r = await a.call('DELETE', `/admin/bundles/${sold.id}`);
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/Archive it instead/);
    expect((await new Browser(app).call('DELETE', `/admin/bundles/${sold.id}`)).status).toBe(401);
  });
});
