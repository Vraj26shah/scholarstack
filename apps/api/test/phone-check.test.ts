import { PHONE_OTP } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { DEMO_OTP_CODE, DemoSms, TwoFactorSms } from '../src/infrastructure/sms-verifier';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
let sms: DemoSms;

const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';

beforeEach(() => {
  sms = new DemoSms();
  ({ clock, env, app } = setup({ sms }));
});

const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const order = (phone = '9123456780') => ({
  lines: [{ name: 'Mess thali', qty: 1, detail: '' }],
  mode: 'pickup',
  name: 'Asha',
  phone,
  phoneConfirmed: true,
});

async function openDhaba() {
  const f = env.db.features.get('mess-menu')!;
  env.db.features.set('mess-menu', { ...f, status: 'live' });
  const admin = await signedIn('admin@vitbhopal.ac.in');
  const { updatedAt: _u, sort: _s, ...input } = (await admin.call('GET', `/mess/${SLUG}`)).json;
  await admin.call('PUT', `/admin/mess/${SLUG}`, {
    ...input,
    published: true,
    ordersOpen: true,
    ownerEmails: [OWNER],
  });
  return admin;
}

describe('checking a mobile number with an SMS code', () => {
  it('sends a code, refuses a wrong one, keeps the number once the right one is entered', async () => {
    const s = await signedIn('student1@vitbhopal.ac.in');
    expect((await s.call('GET', '/me/phone')).json).toEqual({
      available: true,
      phone: null,
      pending: null,
      whatsapp: null,
    });
    expect((await s.call('POST', '/me/phone/start', { phone: '12345' })).status).toBe(400);

    const sent = await s.call('POST', '/me/phone/start', { phone: '+91 98765 43210' });
    expect(sent.status).toBe(200);
    expect(sent.json.pending).toMatchObject({
      phone: '9876543210',
      resendInSeconds: PHONE_OTP.resendSeconds,
    });
    expect(sms.sent).toEqual(['9876543210']);

    const wrong = await s.call('POST', '/me/phone/check', { phone: '9876543210', code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.message).toMatch(/4 tries left/);
    // A code for another number than the one it was sent to.
    expect(
      (await s.call('POST', '/me/phone/check', { phone: '9000000000', code: DEMO_OTP_CODE })).status,
    ).toBe(400);

    const ok = await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    expect(ok.json).toEqual({ available: true, phone: '9876543210', pending: null, whatsapp: null });
    // Checked once: no new codes, the number can't be swapped.
    expect((await s.call('POST', '/me/phone/start', { phone: '9123456780' })).status).toBe(400);
    expect(sms.sent).toHaveLength(1);
  });

  it('limits resends, wrong tries, codes a day, and expires old codes', async () => {
    const s = await signedIn('student1@vitbhopal.ac.in');
    await s.call('POST', '/me/phone/start', { phone: '9876543210' });
    expect((await s.call('POST', '/me/phone/start', { phone: '9876543210' })).status).toBe(400); // too soon
    for (let i = 0; i < PHONE_OTP.attempts; i++)
      await s.call('POST', '/me/phone/check', { phone: '9876543210', code: '111111' });
    const locked = await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    expect(locked.json.error.message).toMatch(/new code/);

    clock.advance(PHONE_OTP.resendSeconds * 1000);
    expect((await s.call('POST', '/me/phone/start', { phone: '9876543210' })).status).toBe(200);
    clock.advance(PHONE_OTP.ttlSeconds * 1000 + 1000);
    const late = await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    expect(late.json.error.message).toMatch(/expired/);

    for (let i = 2; i < PHONE_OTP.perDay; i++) {
      clock.advance(PHONE_OTP.resendSeconds * 1000);
      expect((await s.call('POST', '/me/phone/start', { phone: '9876543210' })).status).toBe(200);
    }
    clock.advance(PHONE_OTP.resendSeconds * 1000);
    const capped = await s.call('POST', '/me/phone/start', { phone: '9876543210' });
    expect(capped.json.error.message).toMatch(/most codes for today/);
  });

  it('orders need a checked number, and always carry it (not what the form says)', async () => {
    await openDhaba();
    const s = await signedIn('student1@vitbhopal.ac.in');
    const refused = await s.call('POST', `/mess/${SLUG}/orders`, order());
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toMatch(/SMS code/);

    await s.call('POST', '/me/phone/start', { phone: '9876543210' });
    await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    const placed = await s.call('POST', `/mess/${SLUG}/orders`, order('9123456780'));
    expect(placed.status).toBe(200);
    expect(placed.json.phone).toBe('9876543210');
  });

  it('an admin can forget a number so a student with a new SIM can check it', async () => {
    const admin = await openDhaba();
    const s = await signedIn('student1@vitbhopal.ac.in');
    await s.call('POST', '/me/phone/start', { phone: '9876543210' });
    await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    expect((await s.call('POST', '/admin/phones/reset', { email: 'student1@vitbhopal.ac.in' })).status).toBe(
      403,
    );
    const r = await admin.call('POST', '/admin/phones/reset', { email: 'student1@vitbhopal.ac.in' });
    expect(r.json).toEqual({ found: true, phone: '9876543210' });
    expect((await s.call('GET', '/me/phone')).json.phone).toBeNull();
  });

  it('the owner is told, loudly and in words, when a student cancels', async () => {
    await openDhaba();
    const owner = await signedIn(OWNER);
    await owner.call('POST', '/push/account', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/owner-1',
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      label: 'Android · Chrome',
    });
    const s = await signedIn('student1@vitbhopal.ac.in');
    await s.call('POST', '/me/phone/start', { phone: '9876543210' });
    await s.call('POST', '/me/phone/check', { phone: '9876543210', code: DEMO_OTP_CODE });
    const placed = (await s.call('POST', `/mess/${SLUG}/orders`, order())).json;
    expect(env.campus.pushSender.sent.at(-1)!.message.body).toContain('1× Mess thali');
    await s.call('POST', `/me/mess-orders/${placed.id}/cancel`);
    expect(env.campus.pushSender.sent.at(-1)!.message).toMatchObject({
      title: `❌ Order ${placed.code} cancelled by Asha`,
      requireInteraction: true,
    });
    expect(env.campus.pushSender.sent.at(-1)!.message.body).toMatch(/^Don't make it: 1× Mess thali/);
  });
});

describe('2Factor', () => {
  it('sends with AUTOGEN and checks the session', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url));
      const body = String(url).includes('/VERIFY/')
        ? { Status: 'Success', Details: 'OTP Matched' }
        : { Status: 'Success', Details: 'sess-1' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const two = new TwoFactorSms('KEY', 'ORDER_OTP', fake);
    expect(await two.start('9876543210')).toBe('sess-1');
    expect(await two.check('9876543210', 'sess-1', '123456')).toBe(true);
    expect(calls).toEqual([
      'https://2factor.in/API/V1/KEY/SMS/919876543210/AUTOGEN/ORDER_OTP',
      'https://2factor.in/API/V1/KEY/SMS/VERIFY/sess-1/123456',
    ]);
  });
});
