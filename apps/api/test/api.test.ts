import { TILE_SEED_HEADER, VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const dbmsId = () => [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!.id;
const dbmsFile = () =>
  [...env.db.files.values()].find((f) => f.courseId === dbmsId() && f.unitKey === 'unit-3')!;

async function buy(b: Browser, courseId: string) {
  const start = await b.call('POST', '/orders', { courseId });
  const pay = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
  return b.call('POST', '/orders/verify', {
    orderId: start.json.orderId,
    gatewayOrderId: start.json.gatewayOrderId,
    gatewayPaymentId: pay.json.gatewayPaymentId,
    signature: pay.json.signature,
  });
}

describe('health and errors', () => {
  it('health is ok and unknown routes return the JSON error shape', async () => {
    const b = new Browser(app);
    expect((await b.call('GET', '/health')).json.ok).toBe(true);
    const nf = await b.call('GET', '/nope');
    expect(nf.status).toBe(404);
    expect(nf.json.error.code).toBe('NOT_FOUND');
    expect(nf.json.error.requestId).toBeTruthy();
  });

  it('rejects malformed input with BAD_REQUEST', async () => {
    const b = new Browser(app);
    const r = await b.call('GET', '/catalogue/drawer?batch=abc&branch=');
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('BAD_REQUEST');
  });
});

describe('admin R2 sync', () => {
  it('reconciles one exact R2 key and keeps similarly prefixed source records intact', async () => {
    const original = [...env.db.files.values()][0]!;
    const siblingKey = `${original.sourceKey}.copy.pdf`;
    env.sources.put(siblingKey, new TextEncoder().encode('%PDF-1.7 copy'), 'application/pdf', 'copy');
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');

    const siblingSync = await admin.call('POST', `/admin/courses/${original.courseId}/sync-file`, {
      sourceKey: siblingKey,
    });
    expect(siblingSync.status).toBe(200);
    const sibling = [...env.db.files.values()].find((file) => file.sourceKey === siblingKey)!;
    expect(sibling).toBeTruthy();

    await env.sources.delete(original.sourceKey);
    const missingSync = await admin.call('POST', `/admin/courses/${original.courseId}/sync-file`, {
      sourceKey: original.sourceKey,
    });

    expect(missingSync.status).toBe(200);
    expect(missingSync.json.filesRetired).toBe(1);
    expect(env.db.files.get(original.id)?.sourceMissingAt).toBeTruthy();
    expect(env.db.files.get(sibling.id)?.sourceMissingAt ?? null).toBeNull();
  });

  it('retires only missing files inside the selected folder and preserves history', async () => {
    const course = [...env.db.courses.values()].find((item) => item.slug === 'dbms-2025-cse-core')!;
    const file = [...env.db.files.values()].find((item) => item.courseId === course.id)!;
    const sibling = [...env.db.files.values()].find(
      (item) => item.courseId === course.id && item.id !== file.id,
    )!;
    const relative = file.sourceKey.slice(course.r2Prefix.length);
    const folderPrefix = `${course.r2Prefix}${relative.split('/')[0]}/`;
    course.status = 'live';
    for (const item of env.db.files.values()) {
      if (item.courseId === course.id) item.hidden = true;
    }
    file.hidden = false;
    file.unitHidden = false;
    file.conversionStatus = 'ready';
    file.pageCount = 1;
    file.previewKey = `pages/${file.id}/preview.webp`;
    sibling.hidden = false;
    sibling.unitHidden = false;
    sibling.conversionStatus = 'failed';
    env.pages.put(`pages/${file.id}/1.webp`, new Uint8Array([1]), 'image/webp');
    env.pages.put(file.previewKey, new Uint8Array([2]), 'image/webp');
    env.db.progress.set(`student|${file.id}`, {
      userId: 'student',
      fileId: file.id,
      page: 1,
      updatedAt: new Date(),
    });
    await env.sources.delete(file.sourceKey);

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const scanned = await admin.call(
      'GET',
      `/admin/storage-audit/bucket?prefix=${encodeURIComponent(folderPrefix)}`,
    );
    expect(scanned.status).toBe(200);
    expect(scanned.json.complete).toBe(true);

    const synced = await admin.call('POST', '/admin/storage-audit/sync-scope', { prefix: folderPrefix });
    expect(synced.status).toBe(200);
    expect(synced.json).toMatchObject({ filesRetired: 1, pageObjectsRemoved: 2, conversionQueued: 0 });
    expect(env.db.courses.get(course.id)?.status).toBe('draft');
    expect(env.db.files.get(file.id)).toMatchObject({
      hidden: true,
      conversionStatus: 'failed',
      pageCount: 0,
    });
    expect(env.db.files.get(file.id)?.sourceMissingAt).toBeTruthy();
    expect(env.db.files.get(sibling.id)?.sourceMissingAt ?? null).toBeNull();
    expect(env.db.progress.has(`student|${file.id}`)).toBe(true);
    expect(await env.pages.list(`pages/${file.id}/`)).toEqual([]);
    expect((await admin.call('PUT', `/admin/files/${file.id}`, { hidden: false })).status).toBe(409);

    env.sources.put(
      file.sourceKey,
      new TextEncoder().encode('%PDF-1.7 restored source'),
      'application/pdf',
      'restored',
    );
    const restored = await admin.call('POST', '/admin/storage-audit/sync-scope', { prefix: folderPrefix });
    expect(restored.status).toBe(200);
    expect(env.db.files.get(file.id)?.sourceMissingAt ?? null).toBeNull();
    expect(env.db.files.get(file.id)?.hidden).toBe(true);
    expect(restored.json.conversionQueued).toBe(0);
  });

  it('removes orphan page objects on a full-bucket sync but leaves pending conversions alone', async () => {
    for (const file of env.db.files.values()) file.hidden = true;
    const pending = [...env.db.files.values()][0]!;
    pending.conversionStatus = 'pending';
    env.pages.put('pages/orphan-record/1.webp', new Uint8Array([1]), 'image/webp');
    env.pages.put(`pages/${pending.id}/1.webp`, new Uint8Array([2]), 'image/webp');

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const synced = await admin.call('POST', '/admin/storage-audit/sync-scope', { prefix: '' });

    expect(synced.status).toBe(200);
    expect(synced.json.pageObjectsRemoved).toBe(1);
    expect(await env.pages.list('pages/orphan-record/')).toEqual([]);
    expect((await env.pages.list(`pages/${pending.id}/`)).map((object) => object.key)).toEqual([
      `pages/${pending.id}/1.webp`,
    ]);
  });

  it('audits archived courses and keeps hidden pending files paused', async () => {
    const course = [...env.db.courses.values()].find((item) => item.slug === 'dbms-2025-cse-core')!;
    const file = [...env.db.files.values()].find((item) => item.courseId === course.id)!;
    course.status = 'archived';
    file.hidden = true;
    file.conversionStatus = 'pending';

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');

    const audit = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(audit.status).toBe(200);
    expect(audit.json.totals.pending).toBe(0);
    expect(audit.json.objects.find((item: any) => item.fileId === file.id)).toMatchObject({
      hidden: true,
      conversionStatus: 'pending',
    });

    const sync = await admin.call('POST', `/admin/courses/${course.id}/sync-file`, {
      sourceKey: file.sourceKey,
    });
    expect(sync.status).toBe(200);
    expect(env.db.courses.get(course.id)?.status).toBe('archived');
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('pending');
  });
});

describe('catalogue', () => {
  it('lists four batch drawers newest first, with year labels', async () => {
    const r = await new Browser(app).call('GET', '/catalogue');
    expect(r.json.batches.map((b: any) => b.year)).toEqual([2026, 2025, 2024, 2023]);
    expect(r.json.batches[1]).toMatchObject({ label: '2nd year', semesters: 'Sem 3–4' });
    expect(r.json.branches.map((b: any) => b.code)).toEqual(['BAI', 'BCE', 'BCG', 'BEY', 'BSA', 'MIM']);
  });

  it('a drawer + tab returns index cards with call numbers', async () => {
    const r = await new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bce');
    expect(r.json).toHaveLength(4);
    const dbms = r.json.find((c: any) => c.slug === 'dbms-2025-cse-core');
    expect(dbms).toMatchObject({ callNo: 'S3 · BCE · 01', fileCount: 14, pageCount: 212, pricePaise: 9900 });
  });

  it('first-year drawers include the shared courses for every branch', async () => {
    const r = await new Browser(app).call('GET', '/catalogue/drawer?batch=2026&branch=bcg');
    expect(r.json.map((c: any) => c.title)).toContain('Engineering Physics');
  });

  it('course page shows units and locked files without signing in', async () => {
    const r = await new Browser(app).call('GET', '/courses/dbms-2025-cse-core');
    expect(r.json.owned).toBe(false);
    expect(r.json.units.map((u: any) => u.label)).toEqual([
      'UNIT 1',
      'UNIT 2',
      'UNIT 3',
      'UNIT 4',
      'UNIT 5',
      'REVISION',
    ]);
    expect(r.json.units[2]).toMatchObject({ title: 'Normalisation', fileCount: 3, pageCount: 46 });
  });
});

describe('college-only sign in', () => {
  it('refuses non-college emails', async () => {
    const r = await new Browser(app).signIn('someone@gmail.com');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('NOT_COLLEGE_EMAIL');
  });

  it('refuses a token without a session and protected routes without a token', async () => {
    const b = new Browser(app);
    expect((await b.call('GET', '/me')).json.error.code).toBe('UNAUTHENTICATED');
    b.token = 'not.a.jwt';
    expect((await b.call('GET', '/me')).status).toBe(401);
  });

  it('a college student signs in and sees their account', async () => {
    const b = new Browser(app);
    const claim = await b.signIn('rahul.k2023@vitbhopal.ac.in');
    expect(claim.status).toBe(200);
    expect(claim.json.devices).toHaveLength(1);
    expect(claim.json.devices[0].current).toBe(true);
    expect(b.cookie).toMatch(/^ss_device=/);
    expect(claim.res.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect((await b.call('GET', '/me')).json.email).toBe('rahul.k2023@vitbhopal.ac.in');
  });
});

describe('sessions resist sharing', () => {
  it('keeps both registered devices signed in at the same time', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    await phone.signIn('rahul@vitbhopal.ac.in', 'Phone');
    await laptop.signIn('rahul@vitbhopal.ac.in', 'Laptop');
    const r = await phone.call('GET', '/me');
    expect(r.status).toBe(200);
    expect((await laptop.call('GET', '/me')).status).toBe(200);
    expect(r.json.devices).toHaveLength(2);
  });

  it('a copied token used from another browser (no device cookie) is rejected', async () => {
    const owner = new Browser(app);
    await owner.signIn('rahul@vitbhopal.ac.in');
    const friend = new Browser(app);
    friend.token = owner.token; // copied out of dev tools
    const result = await friend.call('GET', '/me');
    expect(result.json.error.code).toBe('SESSION_REPLACED');
    expect(result.json.error.details).toEqual({ reason: 'device-check' });
    const deviceId = (await owner.call('GET', '/me')).json.devices[0].id;
    const remove = await friend.call('DELETE', `/me/devices/${deviceId}`);
    expect(remove.json.error.code).toBe('SESSION_REPLACED');
  });

  it('allows two devices and blocks a third', async () => {
    await new Browser(app).signIn('rahul@vitbhopal.ac.in', 'Phone');
    await new Browser(app).signIn('rahul@vitbhopal.ac.in', 'Laptop');
    const third = await new Browser(app).signIn('rahul@vitbhopal.ac.in', 'Friend');
    expect(third.status).toBe(409);
    expect(third.json.error.code).toBe('DEVICE_LIMIT');
    expect(third.json.error.details).toHaveLength(2);
  });

  it('can replace a removed device immediately without exceeding two devices', async () => {
    const phone = new Browser(app);
    await phone.signIn('rahul@vitbhopal.ac.in', 'Phone');
    const laptop = new Browser(app);
    const me = await laptop.signIn('rahul@vitbhopal.ac.in', 'Laptop');
    const phoneId = me.json.devices.find((d: any) => d.label === 'Phone').id;
    expect((await laptop.call('DELETE', `/me/devices/${phoneId}`)).json.devices).toHaveLength(1);
    const tablet = await new Browser(app).signIn('rahul@vitbhopal.ac.in', 'Tablet');
    expect(tablet.status).toBe(200);
    expect(tablet.json.devices).toHaveLength(2);
  });

  it('lets a freshly signed-in third browser remove an old device and then sign in', async () => {
    const phone = new Browser(app);
    const phoneMe = await phone.signIn('rahul@vitbhopal.ac.in', 'Phone');
    const laptop = new Browser(app);
    const laptopMe = await laptop.signIn('rahul@vitbhopal.ac.in', 'Laptop');
    const phoneId = phoneMe.json.devices.find((d: any) => d.label === 'Phone').id;
    const laptopId = laptopMe.json.devices.find((d: any) => d.label === 'Laptop').id;

    const tablet = new Browser(app);
    const blocked = await tablet.signIn('rahul@vitbhopal.ac.in', 'Tablet');
    expect(blocked.json.error.code).toBe('DEVICE_LIMIT');
    expect((await tablet.call('DELETE', `/me/devices/${phoneId}`)).status).toBe(200);
    expect((await phone.call('GET', '/me')).json.error.code).toBe('SESSION_REPLACED');
    expect((await phone.call('DELETE', `/me/devices/${laptopId}`)).json.error.code).toBe('SESSION_REPLACED');
    phone.cookie = '';
    expect((await phone.call('DELETE', `/me/devices/${laptopId}`)).json.error.code).toBe('SESSION_REPLACED');
    expect((await tablet.call('POST', '/session/claim', { label: 'Tablet' })).status).toBe(200);
    expect((await tablet.call('GET', '/me')).json.devices).toHaveLength(2);
    expect((await laptop.call('GET', '/me')).status).toBe(200);
  });

  it('removing one device leaves the other device session active', async () => {
    const phone = new Browser(app);
    const phoneMe = await phone.signIn('rahul@vitbhopal.ac.in', 'Phone');
    const laptop = new Browser(app);
    await laptop.signIn('rahul@vitbhopal.ac.in', 'Laptop');
    const phoneId = phoneMe.json.devices.find((d: any) => d.label === 'Phone').id;
    expect((await laptop.call('DELETE', `/me/devices/${phoneId}`)).status).toBe(200);
    expect((await laptop.call('GET', '/me')).status).toBe(200);
    expect((await phone.call('GET', '/me')).json.error.code).toBe('SESSION_REPLACED');
  });

  it('a known device signing in again reuses its slot', async () => {
    const laptop = new Browser(app);
    await laptop.signIn('rahul@vitbhopal.ac.in');
    const again = await laptop.signIn('rahul@vitbhopal.ac.in');
    expect(again.json.devices).toHaveLength(1);
  });

  it('a forged device cookie is ignored', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    b.cookie = b.cookie.replace(/\.[^.]+$/, '.forged');
    expect((await b.call('GET', '/me')).json.error.code).toBe('SESSION_REPLACED');
  });
});

describe('checkout (all sales final)', () => {
  it('buys a course; price comes from the server; access granted once', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    const start = await b.call('POST', '/orders', { courseId: dbmsId(), pricePaise: 1 });
    expect(start.status).toBe(201);
    expect(start.json.amountPaise).toBe(9900);
    const pay = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
    const body = {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: pay.json.gatewayPaymentId,
      signature: pay.json.signature,
    };
    expect((await b.call('POST', '/orders/verify', body)).json.status).toBe('paid');
    expect((await b.call('POST', '/orders/verify', body)).json.status).toBe('paid'); // idempotent
    expect((await b.call('GET', '/courses/dbms-2025-cse-core')).json.owned).toBe(true);
    expect((await b.call('GET', '/me/shelf')).json).toHaveLength(1);
    expect((await b.call('POST', '/orders', { courseId: dbmsId() })).json.error.code).toBe('ALREADY_OWNED');
  });

  it('rejects a forged payment signature', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    const start = await b.call('POST', '/orders', { courseId: dbmsId() });
    const r = await b.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: 'pay_fake',
      signature: 'deadbeef',
    });
    expect(r.json.error.code).toBe('PAYMENT_INVALID');
    expect((await b.call('GET', '/courses/dbms-2025-cse-core')).json.owned).toBe(false);
  });

  it('webhook grants access even if the tab was closed, and a lost dispute revokes it', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    const start = await b.call('POST', '/orders', { courseId: dbmsId() });
    const captured = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_W1', order_id: start.json.gatewayOrderId, amount: 9900 } } },
    });
    const wh = new Browser(app);
    const bad = await wh.call('POST', '/webhooks/razorpay', captured, { 'x-razorpay-signature': 'nope' });
    expect(bad.json.error.code).toBe('PAYMENT_INVALID');
    const ok = await wh.call('POST', '/webhooks/razorpay', captured, {
      'x-razorpay-signature': await env.gateway.signWebhook(captured),
    });
    expect(ok.json.outcome).toBe('granted');
    expect((await b.call('GET', `/orders/${start.json.orderId}`)).json.status).toBe('paid');

    const lost = JSON.stringify({
      event: 'payment.dispute.lost',
      payload: { dispute: { entity: { payment_id: 'pay_W1' } } },
    });
    await wh.call('POST', '/webhooks/razorpay', lost, {
      'x-razorpay-signature': await env.gateway.signWebhook(lost),
    });
    expect((await b.call('GET', '/courses/dbms-2025-cse-core')).json.owned).toBe(false);
  });

  it('cannot read another student’s order', async () => {
    const a = new Browser(app);
    await a.signIn('a@vitbhopal.ac.in');
    const start = await a.call('POST', '/orders', { courseId: dbmsId() });
    const b = new Browser(app);
    await b.signIn('b@vitbhopal.ac.in');
    expect((await b.call('GET', `/orders/${start.json.orderId}`)).status).toBe(404);
  });
});

describe('protected reader', () => {
  it('will not open a file you have not bought', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    const r = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    expect(r.json.error.code).toBe('NOT_PURCHASED');
  });

  it('serves scrambled pages with a seed, never cached, only with a valid viewer token', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const open = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    expect(open.status).toBe(200);
    expect(open.json).toMatchObject({ pageCount: 24, lastPage: 1, unitLabel: 'UNIT 3' });
    expect(open.json.watermark).toContain('rahul@vitbhopal.ac.in');

    const page = await b.call('GET', `/reader/pages/${dbmsFile().id}/1`, undefined, {
      [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
    });
    expect(page.status).toBe(200);
    expect(page.res.headers.get(TILE_SEED_HEADER)).toMatch(/^[0-9a-f]{32}$/);
    expect(page.res.headers.get('cache-control')).toBe('no-store, private');

    const noToken = await b.call('GET', `/reader/pages/${dbmsFile().id}/1`);
    expect(noToken.json.error.code).toBe('VIEWER_TOKEN_INVALID');
    const tampered = await b.call('GET', `/reader/pages/${dbmsFile().id}/1`, undefined, {
      [VIEWER_TOKEN_HEADER]: `${open.json.viewerToken}x`,
    });
    expect(tampered.status).toBe(401);
    const outOfRange = await b.call('GET', `/reader/pages/${dbmsFile().id}/99`, undefined, {
      [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
    });
    expect(outOfRange.status).toBe(404);
  });

  it('viewer tokens expire', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const open = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    clock.advance(121_000);
    const r = await b.call('GET', `/reader/pages/${dbmsFile().id}/1`, undefined, {
      [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
    });
    expect(r.status).toBe(401);
  });

  it('opening the reader elsewhere takes the lease; the old reader is told', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const first = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    await b.call('POST', '/reader/open', { fileId: dbmsFile().id }); // another tab
    const hb = await b.call(
      'POST',
      '/reader/heartbeat',
      { fileId: dbmsFile().id, page: 3, pagesViewed: 3 },
      { [VIEWER_TOKEN_HEADER]: first.json.viewerToken },
    );
    expect(hb.json.error.code).toBe('LEASE_TAKEN');
  });

  it('heartbeat saves the page and the shelf remembers it', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const open = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    const hb = await b.call(
      'POST',
      '/reader/heartbeat',
      { fileId: dbmsFile().id, page: 7, pagesViewed: 7 },
      { [VIEWER_TOKEN_HEADER]: open.json.viewerToken },
    );
    expect(hb.json.viewerToken).toBeTruthy();
    const shelf = await b.call('GET', '/me/shelf');
    expect(shelf.json[0].lastRead).toMatchObject({ page: 7, pageCount: 24 });
    expect((await b.call('POST', '/reader/open', { fileId: dbmsFile().id })).json.lastPage).toBe(7);
  });

  it('rate-limits scripted page grabbing (40 a minute)', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const open = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    const statuses: number[] = [];
    for (let i = 0; i < 42; i++) {
      const r = await b.call('GET', `/reader/pages/${dbmsFile().id}/${(i % 24) + 1}`, undefined, {
        [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('stops at the daily page cap', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    await buy(b, dbmsId());
    const open = await b.call('POST', '/reader/open', { fileId: dbmsFile().id });
    const hb = await b.call(
      'POST',
      '/reader/heartbeat',
      { fileId: dbmsFile().id, page: 1, pagesViewed: 500 },
      { [VIEWER_TOKEN_HEADER]: open.json.viewerToken },
    );
    expect(hb.status).toBe(200);
    const hb2 = await b.call(
      'POST',
      '/reader/heartbeat',
      { fileId: dbmsFile().id, page: 1, pagesViewed: 200 },
      { [VIEWER_TOKEN_HEADER]: hb.json.viewerToken },
    );
    expect(hb2.json.error.code).toBe('RATE_LIMITED');
    expect((await b.call('POST', '/reader/open', { fileId: dbmsFile().id })).json.error.code).toBe(
      'RATE_LIMITED',
    );
  });
});

describe('admin', () => {
  it('students cannot use admin routes', async () => {
    const b = new Browser(app);
    await b.signIn('rahul@vitbhopal.ac.in');
    expect((await b.call('POST', '/admin/sync')).json.error.code).toBe('FORBIDDEN');
  });

  it('walks every R2 page and reports source, folder, page, internal, and database-only objects to admins', async () => {
    const anonymous = new Browser(app);
    expect((await anonymous.call('GET', '/admin/storage-audit/bucket')).status).toBe(401);
    await anonymous.signIn('rahul@vitbhopal.ac.in');
    expect((await anonymous.call('GET', '/admin/storage-audit/bucket')).status).toBe(403);

    const file = [...env.db.files.values()][0]!;
    const missingSourceKey = file.sourceKey;
    env.sources.delete(missingSourceKey);
    env.sources.put(
      'outside-root/independent-note.pdf',
      new Uint8Array([1, 2, 3]),
      'application/pdf',
      'outside-note',
    );
    env.sources.put(
      'outside-root/unknown-format.bin',
      new Uint8Array([4, 5]),
      'application/octet-stream',
      'unknown-format',
    );
    env.sources.put(
      'outside-root/empty-folder/',
      new Uint8Array(),
      'application/x-directory',
      'folder-marker',
    );
    env.sources.put(`pages/${file.id}/1.webp`, new Uint8Array([6, 7]), 'image/webp', 'page-object');
    env.sources.put('pages/no-supabase-row/stray.webp', new Uint8Array([8]), 'image/webp', 'orphan-page');
    env.sources.put(
      '_system/conversion-queues/queue.json',
      new Uint8Array([9]),
      'application/json',
      'system-object',
    );
    for (let index = 0; index < 520; index++) {
      env.sources.put(
        `outside-root/page-${String(index).padStart(4, '0')}.pdf`,
        new Uint8Array([index % 255]),
        'application/pdf',
        `bulk-${index}`,
      );
    }

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const discovered = new Map<string, any>();
    let cursor: string | undefined;
    let firstPage: any;
    let lastPage: any;
    let pagesRead = 0;
    do {
      const path = `/admin/storage-audit/bucket${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await admin.call('GET', path);
      expect(response.status).toBe(200);
      firstPage ??= response.json;
      lastPage = response.json;
      pagesRead++;
      for (const object of response.json.objects) {
        expect(discovered.has(object.key)).toBe(false);
        discovered.set(object.key, object);
      }
      cursor = response.json.nextCursor ?? undefined;
    } while (cursor);

    expect(firstPage.records.some((record: any) => record.sourceKey === missingSourceKey)).toBe(true);
    expect(firstPage.courses.some((course: any) => course.id === file.courseId)).toBe(true);
    expect(discovered.size).toBeGreaterThan(500);
    expect(pagesRead).toBeGreaterThan(1);
    expect(discovered.get('outside-root/independent-note.pdf')).toMatchObject({
      kind: 'source',
      unregisteredStatus: 'unimported',
    });
    expect(discovered.get('outside-root/unknown-format.bin')).toMatchObject({
      kind: 'source',
      unregisteredStatus: 'unsupported',
    });
    expect(discovered.get('outside-root/empty-folder/')).toMatchObject({ kind: 'folder' });
    expect(discovered.get(`pages/${file.id}/1.webp`)).toMatchObject({ kind: 'page' });
    expect(discovered.get('pages/no-supabase-row/stray.webp')).toMatchObject({ kind: 'page' });
    expect(discovered.get('_system/conversion-queues/queue.json')).toMatchObject({ kind: 'system' });
    expect(firstPage.complete).toBe(false);
    expect(lastPage.complete).toBe(true);
  });

  it('scans only the selected course or nested folder prefix across every cursor page', async () => {
    const file = [...env.db.files.values()][0]!;
    const course = env.db.courses.get(file.courseId)!;
    const folderPrefix = `${file.sourceKey.slice(0, file.sourceKey.lastIndexOf('/') + 1)}scope-check/`;
    const siblingKey = `${course.r2Prefix}scope-sibling.pdf`;
    env.sources.put(siblingKey, new Uint8Array([1]), 'application/pdf', 'scope-sibling');
    for (let index = 0; index < 510; index++) {
      env.sources.put(
        `${folderPrefix}scope-${String(index).padStart(4, '0')}.pdf`,
        new Uint8Array([index % 255]),
        'application/pdf',
        `scope-${index}`,
      );
    }

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const courseObjects = new Set<string>();
    let courseRecords: any[] = [];
    let courseCursor: string | undefined;
    let coursePages = 0;
    do {
      const params = new URLSearchParams({ prefix: course.r2Prefix });
      if (courseCursor) params.set('cursor', courseCursor);
      const courseScan = await admin.call('GET', `/admin/storage-audit/bucket?${params.toString()}`);
      expect(courseScan.status).toBe(200);
      expect(courseScan.json.scopePrefix).toBe(course.r2Prefix);
      courseRecords = courseRecords.length ? courseRecords : courseScan.json.records;
      for (const object of courseScan.json.objects) {
        expect(object.key.startsWith(course.r2Prefix)).toBe(true);
        expect(courseObjects.has(object.key)).toBe(false);
        courseObjects.add(object.key);
      }
      coursePages++;
      courseCursor = courseScan.json.nextCursor ?? undefined;
      if (!courseCursor) expect(courseScan.json.complete).toBe(true);
    } while (courseCursor);
    expect(coursePages).toBeGreaterThan(1);
    expect(courseObjects.has(siblingKey)).toBe(true);
    expect(courseRecords.every((record: any) => record.sourceKey.startsWith(course.r2Prefix))).toBe(true);

    const discovered = new Set<string>();
    let cursor: string | undefined;
    let pagesRead = 0;
    do {
      const params = new URLSearchParams({ prefix: folderPrefix });
      if (cursor) params.set('cursor', cursor);
      const response = await admin.call('GET', `/admin/storage-audit/bucket?${params.toString()}`);
      expect(response.status).toBe(200);
      expect(response.json.scopePrefix).toBe(folderPrefix);
      if (response.json.records) {
        expect(response.json.records.every((record: any) => record.sourceKey.startsWith(folderPrefix))).toBe(
          true,
        );
      }
      for (const object of response.json.objects) {
        expect(object.key.startsWith(folderPrefix)).toBe(true);
        expect(discovered.has(object.key)).toBe(false);
        discovered.add(object.key);
      }
      pagesRead++;
      cursor = response.json.nextCursor ?? undefined;
      if (!cursor) expect(response.json.complete).toBe(true);
    } while (cursor);

    expect(pagesRead).toBeGreaterThan(1);
    expect(discovered.size).toBe(510);
  });

  it('blocks unbounded full-catalogue sync and directs admins to bounded file sync', async () => {
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const r = await admin.call('POST', '/admin/sync');
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('NOT_READY');
    expect(r.json.error.message).toContain('file-scoped requests');
  });

  it('lists generated objects under one exact file page prefix without pulling sibling page keys', async () => {
    const file = [...env.db.files.values()][0]!;
    const exactPrefix = `pages/${file.id}/`;
    env.sources.put(`${exactPrefix}1.webp`, new Uint8Array([1]), 'image/webp', 'page-1');
    env.sources.put(`${exactPrefix}preview.webp`, new Uint8Array([1]), 'image/webp', 'preview');
    env.sources.put('pages/unrelated-file/1.webp', new Uint8Array([1]), 'image/webp', 'sibling-page');

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const response = await admin.call(
      'GET',
      `/admin/storage-audit/bucket?prefix=${encodeURIComponent(exactPrefix)}`,
    );

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ scopePrefix: exactPrefix, complete: true, nextCursor: null });
    expect(response.json.objects.map((object: any) => object.key).sort()).toEqual(
      [`${exactPrefix}1.webp`, `${exactPrefix}preview.webp`].sort(),
    );
    expect(response.json.objects.every((object: any) => object.kind === 'page')).toBe(true);
    expect(response.json).not.toHaveProperty('records');
    expect(response.json).not.toHaveProperty('courses');
  });

  it('limits storage reconciliation to one course and reports its source and page gaps', async () => {
    const b = new Browser(app);
    expect((await b.call('GET', '/admin/storage-audit?courseId=bad')).status).toBe(401);
    await b.signIn('rahul@vitbhopal.ac.in');
    expect((await b.call('GET', '/admin/storage-audit?courseId=bad')).status).toBe(403);

    const file = [...env.db.files.values()][0]!;
    env.sources.delete(file.sourceKey);
    file.conversionStatus = 'ready';
    file.pageCount = 2;
    file.previewKey = `pages/${file.id}/preview.webp`;
    env.pages.put(`pages/${file.id}/1.webp`, new Uint8Array([1]), 'image/webp');
    env.pages.put(`pages/${file.id}/3.webp`, new Uint8Array([1]), 'image/webp');
    env.sources.put(`${file.sourceKey}.new.pdf`, new Uint8Array([1, 2, 3]), 'application/pdf');
    env.sources.put('miscellaneous/untracked.txt', new Uint8Array([4, 5]), 'text/plain');

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const audit = await admin.call('GET', `/admin/storage-audit?courseId=${file.courseId}`);
    expect(audit.status).toBe(200);
    expect(audit.json.totals).toMatchObject({
      databaseFiles: [...env.db.files.values()].filter((item) => item.courseId === file.courseId).length,
      missingSource: 1,
      outsideImportRoot: 0,
      orphanPageObjects: 1,
    });
    expect(audit.json.totals.missingPageAssets).toBeGreaterThanOrEqual(1);
    expect(audit.json.totals.missingPreviews).toBeGreaterThanOrEqual(1);
    expect(audit.json.totals.unimported).toBeGreaterThanOrEqual(1);
    expect(audit.json.files.find((item: any) => item.fileId === file.id).status).toBe('missing-source');
    expect(audit.json.files.find((item: any) => item.fileId === file.id).missingPageNumbers).toEqual([2]);
    expect(audit.json.files.find((item: any) => item.key === `${file.sourceKey}.new.pdf`).status).toBe(
      'unimported',
    );
    expect(audit.json.files.find((item: any) => item.key === 'miscellaneous/untracked.txt')).toBeUndefined();
    expect(audit.json.outsideImportRootObjects).toEqual([]);
    expect(audit.json.checkedAt).toBeTruthy();
  });

  it('syncs one selected source file without importing its siblings', async () => {
    const file = [...env.db.files.values()][0]!;
    file.hidden = false;
    file.unitHidden = false;
    const currentBytes = new TextEncoder().encode('%PDF-1.7 changed selected source');
    env.sources.put(file.sourceKey, currentBytes, 'application/pdf', 'selected-file-new-etag');
    const siblingKey = `${env.db.courses.get(file.courseId)!.r2Prefix}Module 9/unselected.pdf`;
    env.sources.put(
      siblingKey,
      new TextEncoder().encode('%PDF-1.7 sibling'),
      'application/pdf',
      'sibling-etag',
    );

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const result = await admin.call('POST', `/admin/courses/${file.courseId}/sync-file`, {
      sourceKey: file.sourceKey,
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ filesAdded: 0, filesChanged: 1, conversionQueued: 1 });
    expect(env.db.files.get(file.id)?.sourceEtag).toBe('selected-file-new-etag');
    expect([...env.db.files.values()].some((item) => item.sourceKey === siblingKey)).toBe(false);
  });

  it('requeues only the selected unchanged file when its conversion is stuck pending', async () => {
    const course = [...env.db.courses.values()][0]!;
    const files = [...env.db.files.values()].filter((item) => item.courseId === course.id);
    const [selected, sibling] = files;
    expect(selected).toBeTruthy();
    expect(sibling).toBeTruthy();
    for (const file of [selected!, sibling!]) {
      const source = (await env.sources.list(file.sourceKey)).find(
        (object) => object.key === file.sourceKey,
      )!;
      file.sourceEtag = source.etag;
      file.sizeBytes = source.size;
      file.hidden = false;
      file.unitHidden = false;
      file.conversionStatus = 'pending';
      file.conversionStage = null;
      file.conversionUpdatedAt = null;
      file.conversionError = null;
    }

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const result = await admin.call('POST', `/admin/courses/${course.id}/sync-file`, {
      sourceKey: selected!.sourceKey,
    });

    expect(result.status).toBe(200);
    expect(result.json.conversionQueued).toBe(1);
    expect(env.db.files.get(selected!.id)?.conversionStatus).toBe('ready');
    expect(env.db.files.get(sibling!.id)?.conversionStatus).toBe('pending');
  });

  it('syncs only the selected folder and its descendants', async () => {
    const course = [...env.db.courses.values()][0]!;
    const chosenKey = `${course.r2Prefix}Module 8/selected.pdf`;
    const otherKey = `${course.r2Prefix}PYQs/unselected.pdf`;
    env.sources.put(
      chosenKey,
      new TextEncoder().encode('%PDF-1.7 selected'),
      'application/pdf',
      'chosen-etag',
    );
    env.sources.put(otherKey, new TextEncoder().encode('%PDF-1.7 other'), 'application/pdf', 'other-etag');

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const result = await admin.call('POST', `/admin/courses/${course.id}/sync-folder`, {
      prefix: `${course.r2Prefix}Module 8/`,
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ filesAdded: 1, conversionQueued: 1 });
    expect([...env.db.files.values()].some((item) => item.sourceKey === chosenKey)).toBe(true);
    expect([...env.db.files.values()].some((item) => item.sourceKey === otherKey)).toBe(false);
  });

  it('retries failed conversions only for the unchanged original document', async () => {
    const file = [...env.db.files.values()][0]!;
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const pdf = new TextEncoder().encode('%PDF-1.7 valid source');
    env.sources.put(file.sourceKey, pdf, 'application/pdf', 'retry-pdf');
    file.sizeBytes = pdf.length;
    file.sourceEtag = 'retry-pdf';
    file.conversionStatus = 'failed';
    file.conversionError = 'Temporary converter error';

    const retried = await admin.call('POST', `/admin/files/${file.id}/retry-conversion`);
    expect(retried.status).toBe(200);
    expect(retried.json).toEqual({ ok: true, queued: 1 });
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('ready');

    const html = new TextEncoder().encode('<!doctype html><html><title>Google sign in</title></html>');
    env.sources.put(file.sourceKey, html, 'application/pdf', 'retry-html');
    const current = env.db.files.get(file.id)!;
    current.sizeBytes = html.length;
    current.sourceEtag = 'retry-html';
    current.conversionStatus = 'failed';
    const rejected = await admin.call('POST', `/admin/files/${file.id}/retry-conversion`);
    expect(rejected.status).toBe(400);
    expect(rejected.json.error.message).toContain('saved web page');
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('failed');
  });

  it('course sync requeues unchanged files stuck in pending conversion', async () => {
    const file = [...env.db.files.values()][0]!;
    const source = (await env.sources.list(file.sourceKey)).find((object) => object.key === file.sourceKey)!;
    file.sourceEtag = source.etag;
    file.sizeBytes = source.size;
    file.conversionStatus = 'pending';
    file.conversionError = null;
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');

    const result = await admin.call('POST', `/admin/courses/${file.courseId}/sync-file`, {
      sourceKey: file.sourceKey,
    });
    expect(result.status).toBe(200);
    expect(result.json.conversionQueued).toBeGreaterThanOrEqual(1);
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('ready');
  });

  it('course sync leaves intentionally hidden pending files offline without dispatching conversion', async () => {
    const file = [...env.db.files.values()][0]!;
    const courseFiles = [...env.db.files.values()].filter(
      (candidate) => candidate.courseId === file.courseId,
    );
    const courseSources = await env.sources.list(
      [...env.db.courses.values()].find((course) => course.id === file.courseId)!.r2Prefix,
    );
    for (const courseFile of courseFiles) {
      const source = courseSources.find((object) => object.key === courseFile.sourceKey)!;
      courseFile.sourceEtag = source.etag;
      courseFile.sizeBytes = source.size;
      if (courseFile.id !== file.id) {
        courseFile.conversionStatus = 'ready';
        courseFile.pageCount = 1;
        courseFile.previewKey = `pages/${courseFile.id}/preview.webp`;
        env.pages.put(`pages/${courseFile.id}/1.webp`, new Uint8Array([1]), 'image/webp');
        env.pages.put(courseFile.previewKey, new Uint8Array([1]), 'image/webp');
      }
    }
    env.db.units.get(`${file.courseId}|${file.unitKey}`)!.hidden = true;
    file.conversionStatus = 'pending';
    file.conversionError = null;
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');

    const result = await admin.call('POST', `/admin/courses/${file.courseId}/sync-file`, {
      sourceKey: file.sourceKey,
    });

    expect(result.status).toBe(200);
    expect(result.json.conversionQueued).toBe(0);
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('pending');
  });

  it('repairs a ready file with missing page objects individually', async () => {
    const file = [...env.db.files.values()][0]!;
    const source = (await env.sources.list(file.sourceKey)).find((object) => object.key === file.sourceKey)!;
    file.sourceEtag = source.etag;
    file.sizeBytes = source.size;
    file.conversionStatus = 'ready';
    file.conversionError = null;
    file.pageCount = 1;
    file.previewKey = `pages/${file.id}/preview.webp`;
    env.pages.delete(`pages/${file.id}/1.webp`);

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const result = await admin.call('POST', `/admin/files/${file.id}/retry-conversion`);

    expect(result.status).toBe(200);
    expect(result.json).toEqual({ ok: true, queued: 1 });
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('ready');
    expect(
      (await env.pages.list(`pages/${file.id}/`)).some((object) => object.key === `pages/${file.id}/1.webp`),
    ).toBe(true);
  });

  it('marks a ready file failed and hidden when its alleged source is a saved sign-in page', async () => {
    const file = [...env.db.files.values()][0]!;
    const html = new TextEncoder().encode('<!doctype html><html><title>Google sign in</title></html>');
    env.sources.put(
      file.sourceKey,
      html,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'html-source',
    );
    file.sourceEtag = 'html-source';
    file.sizeBytes = html.length;
    file.conversionStatus = 'ready';
    file.conversionError = null;
    file.pageCount = 1;
    file.previewKey = `pages/${file.id}/preview.webp`;
    env.pages.delete(`pages/${file.id}/1.webp`);

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const result = await admin.call('POST', `/admin/files/${file.id}/retry-conversion`);

    expect(result.status).toBe(400);
    expect(result.json.error.message).toContain('saved web page');
    expect(env.db.files.get(file.id)).toMatchObject({
      conversionStatus: 'failed',
      hidden: true,
    });
  });

  it('audits every R2 object and syncs a newly uploaded course file before it stays live', async () => {
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const sourceObjects = await env.sources.list(course.r2Prefix);
    for (const file of env.db.files.values()) {
      if (file.courseId !== course.id) continue;
      const source = sourceObjects.find((object) => object.key === file.sourceKey)!;
      file.sizeBytes = source.size;
      file.sourceEtag = source.etag;
      if (file.conversionStatus === 'ready') {
        for (let page = 1; page <= file.pageCount; page++) {
          env.pages.put(`pages/${file.id}/${page}.webp`, new Uint8Array([1, page, 3]), 'image/webp');
        }
        if (file.previewKey) env.pages.put(file.previewKey, new Uint8Array([1, 1, 3]), 'image/webp');
      }
    }
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');

    const initial = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(initial.status).toBe(200);
    expect(initial.json).toMatchObject({
      complete: true,
      totals: {
        files: 14,
        registered: 14,
        unmapped: 0,
        unsupported: 0,
        missingInR2: 0,
        pageAssetsMissing: 0,
      },
    });
    expect(initial.json.objects).toHaveLength(14);

    const repaired = [...env.db.files.values()].find((file) => file.courseId === course.id)!;
    env.pages.delete(`pages/${repaired.id}/1.webp`);
    const incompletePages = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(incompletePages.json).toMatchObject({
      complete: false,
      totals: { pageAssetsMissing: 1 },
    });
    expect(
      incompletePages.json.objects.find((object: any) => object.fileId === repaired.id).pageAssetsComplete,
    ).toBe(false);

    const repairSync = await admin.call('POST', `/admin/courses/${course.id}/sync-file`, {
      sourceKey: repaired.sourceKey,
    });
    expect(repairSync.json.conversionQueued).toBe(1);
    expect(env.db.courses.get(course.id)?.status).toBe('draft');

    const newKey = `${course.r2Prefix}Module 6/new-notes.pdf`;
    env.sources.put(newKey, new Uint8Array([1, 2, 3, 4]), 'application/pdf', 'new-upload');
    const pending = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(pending.json.complete).toBe(false);
    expect(pending.json.totals.unmapped).toBe(1);
    expect(pending.json.objects.find((o: any) => o.key === newKey).status).toBe('unmapped');

    const synced = await admin.call('POST', `/admin/courses/${course.id}/sync-file`, { sourceKey: newKey });
    expect(synced.status).toBe(200);
    expect(env.db.courses.get(course.id)?.status).toBe('draft');
    const afterSync = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(afterSync.json).toMatchObject({
      complete: true,
      totals: {
        files: 15,
        registered: 15,
        unmapped: 0,
        unsupported: 0,
        missingInR2: 0,
        pending: 0,
        failed: 0,
      },
    });
  });

  it('converter callback requires the shared secret', async () => {
    const r = await new Browser(app).call(
      'POST',
      '/internal/conversion',
      { fileId: dbmsFile().id, status: 'failed' },
      { 'x-ss-converter': 'wrong' },
    );
    expect(r.json.error.code).toBe('FORBIDDEN');
  });
});

describe('security headers', () => {
  it('the static-site _headers file matches the Worker list (Cloudflare serves pages without the Worker)', async () => {
    const { readFileSync } = await import('node:fs');
    const { headersFile } = await import('../src/http/security-headers');
    const file = readFileSync(new URL('../../web/public/_headers', import.meta.url), 'utf8');
    expect(file).toBe(headersFile());
    expect(file).toContain("frame-ancestors 'none'");
    expect(file).toContain('strict-transport-security');
  });

  it('API responses refuse framing and sniffing, and are never cached by default', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('claiming a device twice', () => {
  it('does not let a copied auth token reclaim a registered device without its cookie', async () => {
    const { app } = setup();
    const a = new Browser(app);
    await a.signIn('twice@vitbhopal.ac.in');
    const cookie = a.cookie;
    a.cookie = ''; // a second tab / retry that has not received the cookie yet
    const again = await a.call('POST', '/session/claim', { label: 'Laptop' });
    expect(again.status).toBe(401);
    expect(again.json.error.code).toBe('SESSION_REPLACED');
    a.cookie = cookie;
    expect((await a.call('GET', '/me')).status).toBe(200);
  });
});
