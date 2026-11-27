import { PHONE_OTP } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { memoryContainer } from '../src/composition/memory';
import { createApp } from '../src/http/app';
import { hmacSha256Hex } from '../src/infrastructure/crypto';
import { Browser, TestClock } from './harness';

const SECRET = 'meta-app-secret-for-tests';

function setupWa() {
  const clock = new TestClock();
  const env = memoryContainer({
    seed: true,
    clock,
    pageProducer: async () => new Uint8Array([1]),
    whatsappNumber: '919000000000',
    config: { whatsappVerifyToken: 'hello-meta', whatsappAppSecret: SECRET },
  });
  return { clock, env, app: createApp(() => env.container) };
}

/** What Meta posts when someone messages the site's number. */
const metaBody = (from: string, text: string) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: text } }] } }] }],
  });

async function deliver(app: ReturnType<typeof createApp>, body: string, sign = true) {
  return app.request('/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sign ? { 'x-hub-signature-256': `sha256=${await hmacSha256Hex(SECRET, body)}` } : {}),
    },
    body,
  });
}

describe('free phone checks through WhatsApp', () => {
  it('a student gets a code and link; their WhatsApp message keeps the number it came from', async () => {
    const { app } = setupWa();
    const s = new Browser(app);
    await s.signIn('asha.24bce10001@vitbhopal.ac.in');
    const before = (await s.call('GET', '/me/phone')).json;
    expect(before).toMatchObject({ available: true, phone: null, whatsapp: { waiting: null } });

    const started = (await s.call('POST', '/me/phone/whatsapp')).json;
    const waiting = started.whatsapp.waiting;
    expect(waiting.code).toMatch(/^\d{6}$/);
    expect(waiting.link).toBe(
      `https://wa.me/919000000000?text=${encodeURIComponent(`VERIFY ${waiting.code}`)}`,
    );
    // Asking again while it runs shows the same code.
    expect((await s.call('POST', '/me/phone/whatsapp')).json.whatsapp.waiting.code).toBe(waiting.code);

    expect((await deliver(app, metaBody('919876543210', `VERIFY ${waiting.code}`))).status).toBe(200);
    const after = (await s.call('GET', '/me/phone')).json;
    expect(after.phone).toBe('9876543210');
    expect(after.whatsapp.waiting).toBeNull();
    // The code works once.
    await deliver(app, metaBody('919111111111', `VERIFY ${waiting.code}`));
    expect((await s.call('GET', '/me/phone')).json.phone).toBe('9876543210');
  });

  it('refuses unsigned or forged webhooks, wrong codes, expired codes and other text', async () => {
    const { app, clock } = setupWa();
    const s = new Browser(app);
    await s.signIn('asha.24bce10001@vitbhopal.ac.in');
    const code = (await s.call('POST', '/me/phone/whatsapp')).json.whatsapp.waiting.code;
    // No signature, or a wrong one: refused, nothing changes.
    expect((await deliver(app, metaBody('919876543210', `VERIFY ${code}`), false)).status).toBe(401);
    const forged = await app.request('/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      body: metaBody('919876543210', `VERIFY ${code}`),
    });
    expect(forged.status).toBe(401);
    // Signed, but not a code that's waiting, or just chatter: ignored.
    await deliver(app, metaBody('919876543210', 'VERIFY 000000'));
    await deliver(app, metaBody('919876543210', 'hello, call me'));
    expect((await s.call('GET', '/me/phone')).json.phone).toBeNull();
    // Too late.
    clock.advance(PHONE_OTP.ttlSeconds * 1000 + 1000);
    await deliver(app, metaBody('919876543210', `VERIFY ${code}`));
    expect((await s.call('GET', '/me/phone')).json.phone).toBeNull();
  });

  it('answers Meta’s handshake only with the right token', async () => {
    const { app } = setupWa();
    const ok = await app.request(
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=hello-meta&hub.challenge=42',
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('42');
    const bad = await app.request(
      '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42',
    );
    expect(bad.status).toBe(403);
  });

  it('once checked, orders carry the WhatsApp number', async () => {
    const { app, env } = setupWa();
    const feature = env.db.features.get('mess-menu')!;
    env.db.features.set('mess-menu', { ...feature, status: 'live' });
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const slug = 'radha-rani-ka-dhaba';
    const { updatedAt: _u, sort: _s, ...input } = (await admin.call('GET', `/mess/${slug}`)).json;
    await admin.call('PUT', `/admin/mess/${slug}`, { ...input, published: true, ordersOpen: true });
    const item = (input.order as { items: { name: string; available: boolean; tiffin?: boolean }[] }[])
      .flatMap((x) => x.items)
      .find((i) => i.available && !i.tiffin)!;
    const s = new Browser(app);
    await s.signIn('asha.24bce10001@vitbhopal.ac.in');
    const order = {
      lines: [{ name: item.name, qty: 1, detail: '' }],
      mode: 'pickup',
      name: 'Asha',
      phone: '9123456780',
      phoneConfirmed: true,
    };
    // Not checked yet: ordering asks for the check first.
    expect((await s.call('POST', `/mess/${slug}/orders`, order)).status).toBe(400);
    const code = (await s.call('POST', '/me/phone/whatsapp')).json.whatsapp.waiting.code;
    await deliver(app, metaBody('919876543210', `verify ${code}`));
    const placed = await s.call('POST', `/mess/${slug}/orders`, order);
    expect(placed.status).toBe(200);
    expect(placed.json.phone).toBe('9876543210');
  });
});
