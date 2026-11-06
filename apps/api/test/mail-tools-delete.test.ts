import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('deleting emails and tools', () => {
  it('a draft email is deleted; a tool can be removed from the home page', async () => {
    const { app } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const draft = (
      await a.call('POST', '/admin/announcements', {
        subject: 'A draft to throw away',
        heading: 'Hello',
        body: 'Nothing yet.',
        ctaLabel: '',
        ctaUrl: '',
        featureKey: null,
      })
    ).json;
    expect((await a.call('DELETE', `/admin/announcements/${draft.id}`)).status).toBe(200);
    expect((await a.call('GET', '/admin/announcements')).json.some((x: any) => x.id === draft.id)).toBe(
      false,
    );

    const tools = (await a.call('GET', '/admin/features')).json;
    const key = tools[0].key;
    expect((await a.call('DELETE', `/admin/features/${key}`)).status).toBe(200);
    expect((await a.call('GET', '/admin/features')).json.some((t: any) => t.key === key)).toBe(false);
    expect((await new Browser(app).call('GET', '/features')).json.some((t: any) => t.key === key)).toBe(
      false,
    );
    expect((await a.call('DELETE', '/admin/features/nope')).status).toBe(404);
    expect((await new Browser(app).call('DELETE', `/admin/announcements/${draft.id}`)).status).toBe(401);
  });
});
