import { ReminderPrefs } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import {
  VapidPushSender,
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  toB64url,
} from '../src/infrastructure/web-push';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const admin = async () => {
  const b = new Browser(app);
  await b.signIn('admin@vitbhopal.ac.in');
  return b;
};
const launch = (key: string) => {
  const f = env.db.features.get(key)!;
  env.db.features.set(key, { ...f, status: 'live' });
};
/** Monday 23 Nov 2026, hh:mm on campus (IST). */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  clock.t = Date.UTC(2026, 10, 23, h!, m!) - 330 * 60_000;
};
const device = (n = 1, prefs: Partial<ReminderPrefs> = {}) => ({
  endpoint: `https://push.example.com/send/device-${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  prefs: ReminderPrefs.parse({ mess: { slug: 'safal-hostel-mess' }, ...prefs }),
  label: 'Android · Chrome',
});

describe('mess menus before launch', () => {
  it('students get "not found" while the tool is coming soon; admins see every menu', async () => {
    const student = new Browser(app);
    expect((await student.call('GET', '/mess')).status).toBe(404);
    const a = await admin();
    const list = await a.call('GET', '/mess');
    expect(list.status).toBe(200);
    expect(list.json.map((m: { slug: string }) => m.slug)).toEqual([
      'safal-hostel-mess',
      'radha-rani-ka-dhaba',
    ]);
    const safal = await a.call('GET', '/mess/safal-hostel-mess');
    expect(safal.json.meals.map((m: { key: string }) => m.key)).toEqual([
      'breakfast',
      'lunch',
      'snacks',
      'dinner',
    ]);
    const dhaba = await a.call('GET', '/mess/radha-rani-ka-dhaba');
    expect(dhaba.json.meals.map((m: { key: string }) => m.key)).toEqual(['lunch', 'dinner']);
    expect(dhaba.json.source).toBe('owner');
    expect(dhaba.json.prices).toContain('₹80');
  });

  it('after launch, students see only published menus', async () => {
    launch('mess-menu');
    const student = new Browser(app);
    expect((await student.call('GET', '/mess')).json).toEqual([]);
    expect((await student.call('GET', '/mess/safal-hostel-mess')).status).toBe(404);
    const a = await admin();
    const safal = (await a.call('GET', '/mess/safal-hostel-mess')).json;
    const { updatedAt: _u, sort: _s, ...input } = safal;
    expect((await a.call('PUT', '/admin/mess/safal-hostel-mess', { ...input, published: true })).status).toBe(
      200,
    );
    expect((await student.call('GET', '/mess')).json.map((m: { slug: string }) => m.slug)).toEqual([
      'safal-hostel-mess',
    ]);
  });

  it('refuses a menu whose meal ends before it starts, or the same meal twice', async () => {
    const a = await admin();
    const base = (await a.call('GET', '/mess/radha-rani-ka-dhaba')).json;
    const { updatedAt: _u, sort: _s, ...input } = base;
    const bad = { ...input, meals: [{ key: 'lunch', start: '15:00', end: '12:00', extras: '' }] };
    expect((await a.call('PUT', '/admin/mess/radha-rani-ka-dhaba', bad)).status).toBe(400);
    const twice = { ...input, meals: [input.meals[0], input.meals[0]] };
    expect((await a.call('PUT', '/admin/mess/radha-rani-ka-dhaba', twice)).status).toBe(400);
  });
});

describe('"Something changed? Tell us"', () => {
  it('reaches the admin, who can mark it done', async () => {
    launch('mess-menu');
    const a = await admin();
    await a.call('PUT', '/admin/mess/radha-rani-ka-dhaba', {
      ...(({ updatedAt: _u, sort: _s, ...m }) => m)((await a.call('GET', '/mess/radha-rani-ka-dhaba')).json),
      published: true,
    });
    const student = new Browser(app);
    const sent = await student.call('POST', '/mess/reports', {
      slug: 'radha-rani-ka-dhaba',
      day: 'fri',
      meal: 'dinner',
      message: 'Picadi is actually papad, and the thali is ₹90 now.',
    });
    expect(sent.status).toBe(200);
    const reports = await a.call('GET', '/admin/mess-reports');
    expect(reports.json).toHaveLength(1);
    expect(reports.json[0]).toMatchObject({
      messName: 'Radha Rani Ka · Vrindavan Dhaba',
      meal: 'dinner',
      status: 'new',
    });
    expect(
      (await a.call('PUT', `/admin/mess-reports/${reports.json[0].id}`, { status: 'done' })).status,
    ).toBe(200);
    expect((await a.call('GET', '/admin/mess-reports')).json[0].status).toBe('done');
    // Students can't read the reports.
    expect((await student.call('GET', '/admin/mess-reports')).status).toBe(401);
  });

  it('is refused for an unpublished menu (students) and when too short', async () => {
    launch('mess-menu');
    const student = new Browser(app);
    expect(
      (
        await student.call('POST', '/mess/reports', {
          slug: 'safal-hostel-mess',
          message: 'Wrong dal on Monday',
        })
      ).status,
    ).toBe(404);
    expect(
      (await student.call('POST', '/mess/reports', { slug: 'safal-hostel-mess', message: 'no' })).status,
    ).toBe(400);
  });
});

describe('reminders', () => {
  it('only admins can turn them on before launch', async () => {
    const student = new Browser(app);
    expect((await student.call('GET', '/push/status')).json).toMatchObject({ configured: true, open: false });
    expect((await student.call('POST', '/push/subscribe', device())).status).toBe(404);
    const a = await admin();
    expect((await a.call('GET', '/push/status')).json.open).toBe(true);
    expect((await a.call('POST', '/push/subscribe', device())).status).toBe(200);
    launch('reminders');
    expect((await student.call('POST', '/push/subscribe', device(2))).status).toBe(200);
  });

  it('sends lunch 30 minutes before, once, with the menu, and links the device to the signed-in student', async () => {
    const a = await admin();
    await a.call('POST', '/push/subscribe', device());
    at('11:40');
    expect((await a.call('POST', '/admin/push/run')).json.sent).toBe(0);
    at('11:45');
    const run = await a.call('POST', '/admin/push/run');
    expect(run.json).toMatchObject({ checked: 1, sent: 1 });
    const msg = env.campus.pushSender.sent.at(-1)!.message;
    expect(msg.title).toBe('Lunch in 30 min 🍛');
    expect(msg.body).toContain('Dal fry');
    expect(msg.body).toContain('Safal hostel mess');
    expect(msg.tag).toBe('mess');
    expect(msg.url).toBe('/tools/mess-menu?mess=safal-hostel-mess&meal=lunch');
    expect(msg.actions?.map((x) => x.action)).toEqual(['open', 'mute']);
    at('11:50');
    expect((await a.call('POST', '/admin/push/run')).json.sent).toBe(0);
    const devices = await a.call('GET', '/push/devices');
    expect(devices.json).toHaveLength(1);
    expect(devices.json[0]).toMatchObject({ label: 'Android · Chrome', summary: 'Lunch, Dinner' });
  });

  it('a favourite dish announces a meal that was not ticked', async () => {
    const a = await admin();
    await a.call(
      'POST',
      '/push/subscribe',
      device(1, { mess: { slug: 'safal-hostel-mess', meals: [], lead: 30, favourites: ['paneer'] } }),
    );
    at('12:00');
    expect((await a.call('POST', '/admin/push/run')).json.sent).toBe(0);
    at('19:05'); // Monday dinner: methi mutter malai paneer
    await a.call('POST', '/admin/push/run');
    expect(env.campus.pushSender.sent.at(-1)!.message.title).toBe('Dinner in 25 min · paneer ⭐');
  });

  it("tomorrow's classes at 9 pm, and a class reminder only for chosen subjects and days", async () => {
    const a = await admin();
    const classes = {
      nightly: true,
      nightlyAt: '21:00',
      before: true,
      lead: 10,
      days: [0, 1],
      courses: [
        {
          code: 'CSE2001',
          name: 'DSA',
          room: 'AB1-204',
          times: [
            { day: 0, start: 600 + 5 },
            { day: 1, start: 510 },
          ],
        },
        { code: 'CSE3001', name: 'Java', room: '', times: [{ day: 1, start: 605 }] },
      ],
    };
    await a.call('POST', '/push/subscribe', device(1, { mess: { slug: null }, classes } as never));
    at('09:55');
    await a.call('POST', '/admin/push/run');
    expect(env.campus.pushSender.sent.at(-1)!.message).toMatchObject({
      title: 'DSA in 10 min',
      body: 'CSE2001 · AB1-204 · 10:05 am',
      tag: 'class',
    });
    at('21:02');
    await a.call('POST', '/admin/push/run');
    expect(env.campus.pushSender.sent.at(-1)!.message).toMatchObject({
      title: 'Tomorrow · 2 classes',
      body: 'CSE2001 8:30 · CSE3001 10:05',
      tag: 'nightly',
    });
  });

  it('"Mute today" stops everything until tomorrow; a dead push address is dropped', async () => {
    const a = await admin();
    await a.call('POST', '/push/subscribe', device());
    await a.call('POST', '/push/subscribe', device(2));
    at('11:00');
    expect((await a.call('POST', '/push/mute', { endpoint: device().endpoint })).status).toBe(200);
    env.campus.pushSender.gone.add(device(2).endpoint);
    at('11:50');
    const run = (await a.call('POST', '/admin/push/run')).json;
    expect(run).toMatchObject({ checked: 2, sent: 0, gone: 1 });
    expect(env.campus.push.subs.size).toBe(1);
    // The next day it rings again.
    clock.advance(86_400_000); // Tuesday 11:50
    expect((await a.call('POST', '/admin/push/run')).json.sent).toBe(1);
  });

  it('a renewed push address keeps the settings and the account link', async () => {
    const a = await admin();
    await a.call(
      'POST',
      '/push/subscribe',
      device(1, { mess: { slug: 'radha-rani-ka-dhaba', meals: ['dinner'] } } as never),
    );
    const renewed = await new Browser(app).call('POST', '/push/renew', {
      oldEndpoint: device(1).endpoint,
      subscription: { endpoint: device(9).endpoint, keys: device(9).keys },
    });
    expect(renewed.status).toBe(200);
    const subs = [...env.campus.push.subs.values()];
    expect(subs.map((s) => s.endpoint)).toEqual([device(9).endpoint]);
    expect(subs[0]!.prefs.mess).toMatchObject({ slug: 'radha-rani-ka-dhaba', meals: ['dinner'] });
    expect((await a.call('GET', '/push/devices')).json).toHaveLength(1);
  });

  it('turning reminders off forgets the device', async () => {
    const a = await admin();
    await a.call('POST', '/push/subscribe', device());
    expect((await a.call('POST', '/push/test', { endpoint: device().endpoint })).status).toBe(200);
    expect((await a.call('POST', '/push/unsubscribe', { endpoint: device().endpoint })).status).toBe(200);
    expect(env.campus.push.subs.size).toBe(0);
    expect(
      (await a.call('PUT', '/push/prefs', { endpoint: device().endpoint, prefs: device().prefs })).status,
    ).toBe(404);
  });
});

/** The browser's side of RFC 8291, to prove what we send can be read. */
type Bytes = Uint8Array<ArrayBuffer>;
async function decrypt(body: Bytes, ua: CryptoKeyPair, authSecret: Bytes) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256),
  );
  const hkdf = async (s: Bytes, ikm: Bytes, info: Bytes, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s, info },
        await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    );
  const te = new TextEncoder();
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, shared, info, 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('web push', () => {
  it('encrypts a message the browser can read (RFC 8291)', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const p256dh = toB64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
    const body = await encryptPayload(
      { p256dh, auth: toB64url(auth) },
      new Uint8Array(new TextEncoder().encode('{"title":"Lunch"}')),
    );
    expect(await decrypt(body, ua, auth)).toBe('{"title":"Lunch"}');
  });

  it('signs a VAPID token for the push service and reads 410 as "gone"', async () => {
    const keys = await generateVapidKeys();
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const sender = new VapidPushSender(
      keys.publicKey,
      keys.privateKey,
      'mailto:test@example.com',
      async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response('', { status });
      },
    );
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: toB64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))),
      auth: toB64url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const msg = { title: 'Lunch in 30 min', body: 'Dal fry', tag: 'mess', url: '/tools/mess-menu' };
    expect(await sender.send(target, msg, 600)).toBe('ok');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    const claims = JSON.parse(
      atob(headers.authorization!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.topic).toBe('mess');
    status = 410;
    expect(await sender.send(target, msg, 600)).toBe('gone');
  });
});
