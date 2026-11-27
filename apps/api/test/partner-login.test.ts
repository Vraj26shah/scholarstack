import { OWNER_PIN, ownerAddressFor } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

const SLUG = 'radha-rani-ka-dhaba';
const PHONE = '9876543210';

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const admin = async () => {
  const b = new Browser(app);
  await b.signIn('admin@vitbhopal.ac.in');
  return b;
};

/** The Partner app: signs in with the session the PIN endpoints return, then claims this device. */
async function partner(path: '/partner/login' | '/partner/set-pin', body: Record<string, string>) {
  const b = new Browser(app);
  const res = await b.call('POST', path, body);
  if (res.status !== 200) return { b, res };
  b.token = res.json.accessToken;
  await b.call('POST', '/session/claim', { label: 'Owner phone' });
  return { b, res };
}

describe('restaurant owners sign in with mobile number + PIN', () => {
  it('admin adds the number, the owner sets a PIN with the code and lands on their restaurant', async () => {
    const a = await admin();
    const added = await a.call('POST', '/admin/owner-logins', {
      phone: '+91 98765 43210',
      name: 'Radha ji',
      messSlug: SLUG,
    });
    expect(added.status).toBe(200);
    expect(added.json.code).toMatch(/^\d{6}$/);

    // The owner's private address is now on the restaurant.
    const mess = (await a.call('GET', `/mess/${SLUG}`)).json;
    expect(mess.ownerEmails).toContain(ownerAddressFor(PHONE));

    // No PIN yet.
    expect((await partner('/partner/login', { phone: PHONE, pin: '1234' })).res.status).toBe(400);

    const wrongCode = await partner('/partner/set-pin', {
      phone: PHONE,
      code: added.json.code === '000000' ? '111111' : '000000',
      pin: '1234',
    });
    expect(wrongCode.res.status).toBe(400);
    expect(wrongCode.res.json.error.message).toMatch(/4 tries left/);

    const set = await partner('/partner/set-pin', { phone: PHONE, code: added.json.code, pin: '4821' });
    expect(set.res.status).toBe(200);
    expect(set.res.json.email).toBe(ownerAddressFor(PHONE));
    const owned = await set.b.call('GET', '/owner/messes');
    expect(owned.status).toBe(200);
    expect(owned.json.map((m: { slug: string }) => m.slug)).toEqual([SLUG]);

    // The code works once only; the PIN works from now on.
    expect(
      (await partner('/partner/set-pin', { phone: PHONE, code: added.json.code, pin: '1111' })).res.status,
    ).toBe(400);
    const again = await partner('/partner/login', { phone: '09876543210', pin: '4821' });
    expect(again.res.status).toBe(200);
    expect((await again.b.call('GET', '/owner/messes')).json).toHaveLength(1);

    const list = (await a.call('GET', '/admin/owner-logins')).json;
    expect(list.available).toBe(true);
    expect(list.owners[0]).toMatchObject({ phone: PHONE, name: 'Radha ji', hasPin: true, setupUntil: null });
    expect(list.owners[0].messes).toEqual([{ slug: SLUG, name: expect.any(String) }]);
    // Hashes never leave the server.
    expect(JSON.stringify(list)).not.toMatch(/pinHash|setupHash|4821/);
  });

  it('locks the number after 5 wrong PINs, then opens again after 15 minutes', async () => {
    const a = await admin();
    const { code } = (await a.call('POST', '/admin/owner-logins', { phone: PHONE, messSlug: SLUG })).json;
    await partner('/partner/set-pin', { phone: PHONE, code, pin: '4821' });

    for (let i = 1; i < OWNER_PIN.maxTries; i++)
      expect((await partner('/partner/login', { phone: PHONE, pin: '0000' })).res.status).toBe(400);
    const locked = await partner('/partner/login', { phone: PHONE, pin: '0000' });
    expect(locked.res.status).toBe(429);
    // Even the right PIN waits out the lock.
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(429);
    expect((await a.call('GET', '/admin/owner-logins')).json.owners[0].lockedUntil).not.toBeNull();

    clock.advance(OWNER_PIN.lockMinutes * 60_000 + 1000);
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(200);
  });

  it('admin can unlock, and a new setup code resets a forgotten PIN', async () => {
    const a = await admin();
    const { code } = (await a.call('POST', '/admin/owner-logins', { phone: PHONE, messSlug: SLUG })).json;
    await partner('/partner/set-pin', { phone: PHONE, code, pin: '4821' });
    for (let i = 0; i < OWNER_PIN.maxTries; i++)
      await partner('/partner/login', { phone: PHONE, pin: '0000' });
    expect((await a.call('POST', `/admin/owner-logins/${PHONE}/unlock`)).status).toBe(200);
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(200);

    const fresh = (await a.call('POST', `/admin/owner-logins/${PHONE}/setup-code`)).json;
    expect(fresh.code).toMatch(/^\d{6}$/);
    expect(
      (await partner('/partner/set-pin', { phone: PHONE, code: fresh.code, pin: '7777' })).res.status,
    ).toBe(200);
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(400);
    expect((await partner('/partner/login', { phone: PHONE, pin: '7777' })).res.status).toBe(200);
  });

  it('setup codes expire after 24 hours', async () => {
    const a = await admin();
    const { code } = (await a.call('POST', '/admin/owner-logins', { phone: PHONE, messSlug: SLUG })).json;
    clock.advance(OWNER_PIN.setupHours * 3_600_000 + 1000);
    const late = await partner('/partner/set-pin', { phone: PHONE, code, pin: '4821' });
    expect(late.res.status).toBe(400);
    expect(late.res.json.error.message).toMatch(/expired/);
  });

  it('unknown numbers, removed owners and non-admins are refused', async () => {
    expect((await partner('/partner/login', { phone: '9000000001', pin: '1234' })).res.status).toBe(400);
    expect((await partner('/partner/login', { phone: '12345', pin: '1234' })).res.status).toBe(400);

    const student = new Browser(app);
    await student.signIn('student1@vitbhopal.ac.in');
    expect((await student.call('POST', '/admin/owner-logins', { phone: PHONE, messSlug: SLUG })).status).toBe(
      403,
    );

    const a = await admin();
    const { code } = (await a.call('POST', '/admin/owner-logins', { phone: PHONE, messSlug: SLUG })).json;
    await partner('/partner/set-pin', { phone: PHONE, code, pin: '4821' });
    // Taken off the restaurant: the PIN no longer signs in.
    const { updatedAt: _u, sort: _s, ...input } = (await a.call('GET', `/mess/${SLUG}`)).json;
    await a.call('PUT', `/admin/mess/${SLUG}`, { ...input, ownerEmails: [] });
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(403);
    // Removed: unknown number.
    await a.call('DELETE', `/admin/owner-logins/${PHONE}`);
    expect((await partner('/partner/login', { phone: PHONE, pin: '4821' })).res.status).toBe(400);
  });

  it('is off without a pepper', async () => {
    const { memoryContainer } = await import('../src/composition/memory');
    const { createApp } = await import('../src/http/app');
    const off = memoryContainer({ seed: true, ownerPinPepper: '' });
    const offApp = createApp(() => off.container);
    const res = await offApp.request('/api/partner/status');
    expect(await res.json()).toEqual({ available: false });
    const login = await offApp.request('/api/partner/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, pin: '1234' }),
    });
    expect(login.status).toBe(409);
    void env;
  });
});
