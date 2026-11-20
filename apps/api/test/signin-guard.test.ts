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

  it('caps how many links one address may ask for in a day', async () => {
    const { app } = setup();
    const b = new Browser(app);
    for (let i = 0; i < 5; i++) expect((await check(b, 'rahul.23bce1@vitbhopal.ac.in')).status).toBe(200);
    const sixth = await check(b, 'rahul.23bce1@vitbhopal.ac.in');
    expect(sixth.status).toBe(429);
    expect(sixth.json.error.message).toContain('Continue with Google');
    // A different address still gets its link; the cap is per address.
    expect((await check(b, 'other.23bce2@vitbhopal.ac.in')).status).toBe(200);
  });

  it('stops one network cycling many addresses to drain the day’s emails', async () => {
    const { app } = setup();
    const b = new Browser(app);
    for (let i = 0; i < 15; i++)
      expect((await check(b, `student${i}.23bce1@vitbhopal.ac.in`)).status).toBe(200);
    const burst = await check(b, 'another.23bce9@vitbhopal.ac.in');
    expect(burst.status).toBe(429);
    expect(burst.json.error.message).toContain('from this network this hour');
    // Another network is unaffected: the brake is per network, not global.
    expect((await check(b, 'another.23bce9@vitbhopal.ac.in', '198.51.100.9')).status).toBe(200);
  });

  it('keeps a site-wide daily budget so no amount of mischief exhausts the mail allowance', async () => {
    const { app } = setup();
    const b = new Browser(app);
    // The full daily budget, spread across networks so the per-network brakes stay quiet.
    for (let i = 0; i < 250; i++) {
      const r = await check(b, `s${i}.23bce1@vitbhopal.ac.in`, `10.${Math.floor(i / 15)}.${i % 250}.1`);
      expect(r.status).toBe(200);
    }
    const beyond = await check(b, 'onemore.23bce1@vitbhopal.ac.in', '192.0.2.1');
    expect(beyond.status).toBe(429);
    expect(beyond.json.error.message).toContain('all the sign-in emails');
    expect(beyond.json.error.message).toContain('Continue with Google');
  });
});
