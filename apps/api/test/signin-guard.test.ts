import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const check = (b: Browser, email: string, ip = '203.0.113.7') =>
  b.call('POST', '/auth/check-email', { email }, { 'cf-connecting-ip': ip });

describe('sign-in check', () => {
  it('accepts college addresses and admin addresses of any domain; refuses everything else', async () => {
    const { app, env } = setup();
    const b = new Browser(app);
    expect((await check(b, 'rahul.23bce10001@vitbhopal.ac.in')).json).toEqual({ ok: true, admin: false });
    env.db.admins.push({ email: 'owner@gmail.com', source: 'github', addedAt: new Date() });
    env.container.admins.forget();
    expect((await check(b, 'Owner@Gmail.com')).json).toEqual({ ok: true, admin: true });
    const r = await check(b, 'stranger@gmail.com');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('NOT_COLLEGE_EMAIL');
    expect((await check(b, 'rahul+x@vitbhopal.ac.in')).status).toBe(403);
    expect((await check(b, 'rahul@vitbhopal.ac.in.evil.com')).status).toBe(403);
  });

  it('blocks a network for 24 hours after 5 refused addresses, without touching other networks', async () => {
    const { app, clock } = setup();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await check(b, `nope${i}@gmail.com`)).status).toBe(403);
    const fifth = await check(b, 'nope5@gmail.com');
    expect(fifth.status).toBe(429);
    expect(fifth.json.error.message).toContain('This network can try again after');
    // Blocked even for a valid address now.
    expect((await check(b, 'good.23bce1@vitbhopal.ac.in')).status).toBe(429);
    // Another network is fine.
    expect((await check(b, 'good.23bce1@vitbhopal.ac.in', '198.51.100.2')).status).toBe(200);
    clock.advance(24 * 3600_000 + 60_000);
    expect((await check(b, 'good.23bce1@vitbhopal.ac.in')).status).toBe(200);
  });
});
