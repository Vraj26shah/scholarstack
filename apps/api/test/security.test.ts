import { VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, setup } from './harness';

/**
 * Attacks an intruder would try: every admin route without rights, other people's data,
 * forged callbacks and webhooks, oversized or malformed input, unpublished content.
 */
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

beforeEach(() => {
  ({ env, app } = setup());
});

const dbms = () => [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
const dbmsFile = () => [...env.db.files.values()].find((f) => f.courseId === dbms().id && !f.hidden)!;

async function student(email = `s${Math.random().toString(36).slice(2, 8)}@vitbhopal.ac.in`) {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
}

async function buy(b: Browser, courseId: string) {
  const start = await b.call('POST', '/orders', { courseId });
  const pay = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
  await b.call('POST', '/orders/verify', {
    orderId: start.json.orderId,
    gatewayOrderId: start.json.gatewayOrderId,
    gatewayPaymentId: pay.json.gatewayPaymentId,
    signature: pay.json.signature,
  });
  return start.json.orderId as string;
}

const ID = '00000000-0000-4000-8000-000000000000';
const ADMIN_ROUTES: [string, string, unknown?][] = [
  ['GET', '/admin/courses'],
  ['GET', '/admin/sync-health'],
  ['GET', `/admin/storage-audit?courseId=${ID}`],
  ['GET', '/admin/storage-audit/bucket'],
  ['POST', '/admin/storage-audit/sync-scope', { prefix: '' }],
  ['PATCH', `/admin/courses/${ID}`, { title: 'x' }],
  ['POST', `/admin/courses/${ID}/publish`, { pricePaise: 100 }],
  ['GET', `/admin/courses/${ID}/units`],
  ['GET', `/admin/courses/${ID}/inventory`],
  ['POST', `/admin/courses/${ID}/sync`],
  ['POST', `/admin/courses/${ID}/sync-file`, { sourceKey: 'x' }],
  ['POST', `/admin/courses/${ID}/sync-folder`, { prefix: 'x/' }],
  ['PUT', `/admin/courses/${ID}/units/unit-1`, { hidden: true }],
  ['PUT', `/admin/files/${ID}`, { hidden: true }],
  ['POST', `/admin/files/${ID}/retry-conversion`],
  ['GET', '/admin/overview'],
  ['GET', '/admin/today'],
  ['POST', '/admin/contributions/x/file'],
  ['POST', '/admin/contributions/x/check'],
  ['POST', '/admin/contributions/x/complete'],
  ['GET', '/admin/contributors'],
  ['POST', '/admin/storage-tree/move'],
  ['POST', '/admin/storage-tree/rename'],
  ['GET', '/admin/storage-unused'],
  ['GET', '/admin/storage-compare'],
  ['POST', '/admin/storage-compare', { scopes: [''] }],
  ['POST', '/admin/conversions/query', { scopes: [''] }],
  ['POST', '/admin/convert-selection', { scopes: [''] }],
  ['GET', '/admin/conversions'],
  ['GET', `/admin/access?courseId=${ID}`],
  ['POST', '/admin/access/change', { courseId: ID, userIds: [ID], action: 'block' }],
  ['POST', '/admin/access/grant', { courseId: ID, emails: ['x@vitbhopal.ac.in'] }],
  ['POST', '/admin/convert', { courseId: ID }],
  ['GET', '/admin/import'],
  ['POST', '/admin/import', { courses: [] }],
  ['POST', '/admin/sync'],
  ['GET', '/admin/bundles'],
  ['POST', '/admin/bundles', {}],
  ['POST', '/admin/bundles/suggest-price', { courseIds: [] }],
  ['GET', '/admin/features'],
  ['POST', '/admin/features', {}],
  ['PUT', '/admin/features/cgpa', {}],
  ['POST', '/admin/features/cgpa/launch'],
  ['GET', '/admin/email'],
  ['GET', '/admin/announcements'],
  ['POST', '/admin/announcements', {}],
  ['GET', `/admin/announcements/${ID}/preview`],
  ['POST', `/admin/announcements/${ID}/test`],
  ['POST', `/admin/announcements/${ID}/send`],
  ['POST', `/admin/courses/${ID}/delete`, { deleteNotes: false }],
  ['GET', '/admin/problems'],
  ['POST', '/admin/problems/clear', {}],
  ['GET', '/admin/storage-map'],
  ['POST', '/admin/storage-map/clean', { what: 'pages' }],
  ['POST', '/admin/storage-map/move-course', { courseId: ID, newFolder: 'x/y' }],
  ['GET', '/admin/contributions'],
  ['GET', `/admin/contributions/${ID}/files/1`],
  ['POST', `/admin/contributions/${ID}/review`, { decision: 'approved' }],
  ['POST', `/admin/contributions/${ID}/copy`, { folder: 'x/y/' }],
  ['DELETE', `/admin/contributions/${ID}`],
  ['POST', '/admin/contributions-settings', { open: false }],
  ['POST', '/admin/contributors/block', { userId: ID, blocked: true }],
  ['GET', '/admin/earnings'],
  ['POST', `/admin/contributions/${ID}/reward-paid`, {}],
  ['POST', '/admin/royalties/bonus', { userId: ID, year: 2026, amountRupees: 1 }],
  ['GET', '/admin/storage-tree'],
  ['POST', '/admin/storage-tree/preview', { path: 'drive-imports/x/' }],
  ['POST', '/admin/storage-tree/delete', { path: 'drive-imports/x/', confirm: 'DELETE' }],
  ['POST', '/admin/royalties', { courseId: ID, email: 'x@vitbhopal.ac.in' }],
  ['DELETE', `/admin/royalties/${ID}`],
  ['POST', '/admin/royalties/payouts', { courseId: ID, amountRupees: 1 }],
  ['GET', '/admin/support'],
  ['GET', `/admin/support/${ID}/files/1`],
  ['POST', `/admin/support/${ID}/reply`, { body: 'x' }],
  ['POST', `/admin/support/${ID}/status`, { status: 'closed' }],
  ['DELETE', `/admin/support/${ID}`],
  ['GET', '/admin/storage-tree'],
  ['POST', '/admin/storage-tree/preview', { path: 'drive-imports/x/' }],
  ['POST', '/admin/storage-tree/delete', { path: 'drive-imports/x/', confirm: 'DELETE' }],
  ['GET', '/admin/academic'],
  ['GET', `/admin/announcements/${ID}/deliveries`],
  ['GET', '/admin/admins'],
  ['POST', '/admin/academic/years', { year: 2030 }],
  ['PUT', '/admin/academic/years/2030', { visible: false }],
  ['DELETE', '/admin/academic/years/2030'],
  ['POST', '/admin/academic/branches', { code: 'XYZ', name: 'Xyz' }],
  ['POST', '/admin/academic/move-year', { fromYear: 2025, toYear: 2026 }],
];

describe('admin routes', () => {
  it.each(ADMIN_ROUTES)('%s %s refuses visitors and students', async (method, path, body) => {
    const visitor = new Browser(app);
    const anon = await visitor.call(method, path, body ?? (method === 'GET' ? undefined : {}));
    expect(anon.status).toBe(401);
    const s = await student();
    const denied = await s.call(method, path, body ?? (method === 'GET' ? undefined : {}));
    expect(denied.status).toBe(403);
  });

  it('a student cannot make themselves an admin by editing their profile', async () => {
    const s = await student();
    const r = await s.call('PATCH', '/me', { fullName: 'Admin', isAdmin: true, role: 'admin' });
    expect([200, 400]).toContain(r.status);
    expect((await s.call('GET', '/me')).json.isAdmin).toBe(false);
    expect((await s.call('GET', '/admin/courses')).status).toBe(403);
  });
});

describe('converter callbacks', () => {
  const report = () => ({ fileId: dbmsFile().id, status: 'ready', pages: [], previewKey: null });
  it.each([
    ['no secret', {}],
    ['empty secret', { 'x-ss-converter': '' }],
    ['wrong secret', { 'x-ss-converter': 'guess-guess-guess-guess-guess-guess' }],
  ])('rejects a callback with %s', async (_label, headers) => {
    const b = new Browser(app);
    for (const path of ['/internal/conversion', '/internal/conversion-progress']) {
      const r = await b.call('POST', path, report(), headers as Record<string, string>);
      expect(r.status).toBe(403);
    }
    expect(env.db.files.get(dbmsFile().id)?.conversionStatus).toBe('ready');
  });
});

describe('other people’s data', () => {
  it('cannot read another student’s order', async () => {
    const owner = await student();
    const orderId = await buy(owner, dbms().id);
    const intruder = await student();
    const r = await intruder.call('GET', `/orders/${orderId}`);
    expect(r.status).toBe(404);
  });

  it('cannot remove another student’s device', async () => {
    const owner = await student();
    const deviceId = (await owner.call('GET', '/me')).json.devices[0].id;
    const intruder = await student();
    const r = await intruder.call('DELETE', `/me/devices/${deviceId}`);
    expect([403, 404]).toContain(r.status);
    expect((await owner.call('GET', '/me')).status).toBe(200);
  });

  it('cannot read pages with someone else’s viewer token', async () => {
    const owner = await student();
    await buy(owner, dbms().id);
    const open = await owner.call('POST', '/reader/open', { fileId: dbmsFile().id });
    const intruder = await student();
    const r = await intruder.call('GET', `/reader/pages/${dbmsFile().id}/1`, undefined, {
      [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
    });
    expect([401, 403]).toContain(r.status);
  });

  it('a viewer token for one file does not open another file', async () => {
    const owner = await student();
    await buy(owner, dbms().id);
    const files = [...env.db.files.values()].filter((f) => f.courseId === dbms().id && !f.hidden);
    const open = await owner.call('POST', '/reader/open', { fileId: files[0]!.id });
    const r = await owner.call('GET', `/reader/pages/${files[1]!.id}/1`, undefined, {
      [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
    });
    expect([401, 403]).toContain(r.status);
  });

  it('cannot read pages past the end of a file or with silly page numbers', async () => {
    const owner = await student();
    await buy(owner, dbms().id);
    const open = await owner.call('POST', '/reader/open', { fileId: dbmsFile().id });
    for (const page of ['0', '-1', '99999', 'abc', '1.5', '%2e%2e']) {
      const r = await owner.call('GET', `/reader/pages/${dbmsFile().id}/${page}`, undefined, {
        [VIEWER_TOKEN_HEADER]: open.json.viewerToken,
      });
      expect(r.status, `page ${page}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `page ${page}`).toBeLessThan(500);
    }
  });
});

describe('payments', () => {
  it('a forged webhook grants nothing', async () => {
    const s = await student();
    const start = await s.call('POST', '/orders', { courseId: dbms().id });
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_fake', order_id: start.json.gatewayOrderId, amount: 1 } } },
    });
    const r = await new Browser(app).call('POST', '/webhooks/razorpay', body, {
      'content-type': 'application/json',
      'x-razorpay-signature': 'forged',
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await s.call('GET', `/orders/${start.json.orderId}`)).json.status).not.toBe('paid');
    expect((await s.call('POST', '/reader/open', { fileId: dbmsFile().id })).json.error.code).toBe(
      'NOT_PURCHASED',
    );
  });

  it('a made-up payment signature does not mark an order paid', async () => {
    const s = await student();
    const start = await s.call('POST', '/orders', { courseId: dbms().id });
    const r = await s.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: 'pay_fake',
      signature: 'f'.repeat(64),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await s.call('GET', `/orders/${start.json.orderId}`)).json.status).not.toBe('paid');
  });
});

describe('bursts', () => {
  it('a script hammering checkout is slowed down', async () => {
    const s = await student();
    const codes: number[] = [];
    for (let i = 0; i < 45; i++)
      codes.push((await s.call('POST', '/orders', { courseId: dbms().id })).status);
    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 10).every((code) => code === 201)).toBe(true);
  });
});

describe('unpublished and hidden content', () => {
  it('a draft course is invisible to the public and cannot be bought', async () => {
    const course = dbms();
    course.status = 'draft';
    expect((await new Browser(app).call('GET', `/courses/${course.slug}`)).status).toBe(404);
    const s = await student();
    const r = await s.call('POST', '/orders', { courseId: course.id });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('a hidden file has no public preview and cannot be opened even by an owner', async () => {
    const s = await student();
    await buy(s, dbms().id);
    const file = dbmsFile();
    file.hidden = true;
    expect((await new Browser(app).call('GET', `/previews/${file.id}`)).status).toBe(404);
    expect((await s.call('POST', '/reader/open', { fileId: file.id })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('malformed input', () => {
  it('answers garbage with a 4xx, never a 500', async () => {
    const s = await student();
    const cases: [string, string, unknown][] = [
      ['POST', '/orders', 'not json'],
      ['POST', '/orders', { courseId: { $ne: null } }],
      ['POST', '/orders', { courseId: "' OR 1=1 --" }],
      ['PATCH', '/me', { fullName: 'x'.repeat(10_000) }],
      ['POST', '/reader/open', { fileId: '../../etc/passwd' }],
      ['POST', '/reader/heartbeat', { fileId: 1, page: 'x' }],
      ['GET', '/courses/%00', undefined],
      ['GET', `/courses/${'a'.repeat(5000)}`, undefined],
    ];
    for (const [method, path, body] of cases) {
      const r = await s.call(method, path, body);
      expect(r.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `${method} ${path}`).toBeLessThan(500);
    }
  });

  it('demo-only endpoints do not exist outside demo mode', async () => {
    // The demo container wires them; production containers leave `demo` unset (see composition/).
    const containerSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/composition/supabase-container.ts', import.meta.url), 'utf8'),
    );
    expect(containerSource).not.toMatch(/\bdemo\s*:/);
  });
});

describe('response headers', () => {
  it('every API response carries the protective headers', async () => {
    const r = await new Browser(app).call('GET', '/catalogue');
    const h = r.res.headers;
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('referrer-policy')).toBeTruthy();
    expect(h.get('strict-transport-security')).toMatch(/max-age=\d+/);
  });
});
