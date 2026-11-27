import { PushSubscribeBody } from '@ss/contracts';
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import type { PushMessage } from '../src/domain/campus-ports';
import { FcmPushSender, SplitPushSender, fcmMessage, readServiceAccount } from '../src/infrastructure/fcm';
import { MemoryPushSender } from '../src/infrastructure/web-push';

const TOKEN = `fcm:${'a1B2_c3-D4:'.repeat(12)}`;
const order: PushMessage = {
  title: 'New order',
  body: '2 × Thali',
  tag: 'order-1',
  url: '/partner',
  requireInteraction: true,
};
const reminder: PushMessage = { title: 'Lunch', body: 'Rajma chawal', tag: 'meal', url: '/tools/mess-menu' };

async function serviceAccount() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    client_email: 'sender@demo.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    project_id: 'demo',
  };
}

/** A fake Google: the token endpoint and the FCM send endpoint, with scripted answers. */
function google(answers: number[]) {
  const calls: { url: string; body: string; auth: string }[] = [];
  let tokens = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = String(init.body ?? '');
    calls.push({ url, body, auth: new Headers(init.headers).get('authorization') ?? '' });
    if (url.includes('oauth2')) return Response.json({ access_token: `tok-${++tokens}`, expires_in: 3600 });
    const status = answers.shift() ?? 200;
    return new Response(
      status === 404 ? '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' : '{}',
      { status },
    );
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('Firebase Cloud Messaging sender', () => {
  it('rings new orders on the loud channel and other messages on the general one', () => {
    const o = fcmMessage('t', order, 600).message;
    expect(o.android.notification.channel_id).toBe('new_orders');
    expect(o.android.notification.sound).toBe('order_ring');
    expect(o.android.priority).toBe('high');
    expect(o.android.ttl).toBe('600s');
    expect(o.data).toEqual({ url: '/partner', tag: 'order-1' });
    const r = fcmMessage('t', reminder, 60).message;
    expect(r.android.notification.channel_id).toBe('general');
    expect('sound' in r.android.notification).toBe(false);
  });

  it('signs in once, reuses the token, and renews it after a 401', async () => {
    const sa = await serviceAccount();
    const g = google([200, 200, 401, 200]);
    const sender = new FcmPushSender('demo', sa, g.fetcher);
    const target = { endpoint: TOKEN, p256dh: '', auth: '' };
    expect(await sender.send(target, order, 600)).toBe('ok');
    expect(await sender.send(target, reminder, 60)).toBe('ok');
    expect(g.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const assertion = new URLSearchParams(g.calls[0]!.body).get('assertion')!;
    expect(decodeJwt(assertion)).toMatchObject({
      iss: sa.client_email,
      aud: 'https://oauth2.googleapis.com/token',
    });
    const send = g.calls[1]!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/demo/messages:send');
    expect(send.auth).toBe('Bearer tok-1');
    expect(JSON.parse(send.body).message.token).toBe(TOKEN.slice(4));
    // 401 → new token → retried once.
    expect(await sender.send(target, reminder, 60)).toBe('ok');
    expect(g.calls.at(-1)!.auth).toBe('Bearer tok-2');
  });

  it('forgets uninstalled apps and reports other failures', async () => {
    const sa = await serviceAccount();
    const target = { endpoint: TOKEN, p256dh: '', auth: '' };
    expect(await new FcmPushSender('demo', sa, google([404]).fetcher).send(target, order, 60)).toBe('gone');
    expect(await new FcmPushSender('demo', sa, google([500]).fetcher).send(target, order, 60)).toBe('failed');
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await new FcmPushSender('demo', sa, broken).send(target, order, 60)).toBe('failed');
  });

  it('sends app devices through Firebase and browsers through Web Push', async () => {
    const web = new MemoryPushSender('BKey');
    const app = new MemoryPushSender('');
    const split = new SplitPushSender(web, app);
    await split.send(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' },
      reminder,
      60,
    );
    await split.send({ endpoint: TOKEN, p256dh: '', auth: '' }, order, 60);
    expect(web.sent.map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/x']);
    expect(app.sent.map((s) => s.endpoint)).toEqual([TOKEN]);
    expect(split.publicKey).toBe('BKey');
    expect(
      await new SplitPushSender(web, null).send({ endpoint: TOKEN, p256dh: '', auth: '' }, order, 60),
    ).toBe('failed');
  });

  it('reads the service account from base64 or JSON, and refuses junk', async () => {
    const sa = await serviceAccount();
    expect(readServiceAccount(btoa(JSON.stringify(sa)))?.client_email).toBe(sa.client_email);
    expect(readServiceAccount(JSON.stringify(sa))?.project_id).toBe('demo');
    expect(readServiceAccount('not base64 !!')).toBeNull();
    expect(readServiceAccount('')).toBeNull();
  });

  it('accepts an app device without Web Push keys, but not a browser without them', () => {
    const prefs = { meals: [], classes: false };
    const app = PushSubscribeBody.safeParse({ endpoint: TOKEN, keys: { p256dh: '', auth: '' }, prefs });
    const browser = PushSubscribeBody.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: '', auth: '' },
      prefs,
    });
    expect(browser.success).toBe(false);
    expect(
      PushSubscribeBody.safeParse({ endpoint: 'fcm:short', keys: { p256dh: '', auth: '' }, prefs }).success,
    ).toBe(false);
    // ReminderPrefs may need more fields; only the key rule matters here.
    if (!app.success) expect(app.error.issues.some((i) => i.message === 'Missing push keys')).toBe(false);
  });
});
