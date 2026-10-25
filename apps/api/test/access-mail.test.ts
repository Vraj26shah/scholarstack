import { describe, expect, it } from 'vitest';
import { buildConfig } from '../src/composition/config';
import { SupabaseJwtVerifier } from '../src/infrastructure/auth';
import { MemoryOrders } from '../src/infrastructure/memory';
import { Browser, setup } from './harness';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function world() {
  const { env, app } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
  const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
  const student = async (name: string) => {
    const b = new Browser(app);
    await b.signIn(`${name}@vitbhopal.ac.in`);
    return b;
  };
  const buy = async (b: Browser, courseId: string) => {
    const start = await b.call('POST', '/orders', { courseId });
    const pay = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
    await b.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: pay.json.gatewayPaymentId,
      signature: pay.json.signature,
    });
  };
  const sent = () => env.db.outbox;
  return { env, app, admin, dbms, os, student, buy, sent };
}

describe('access emails', () => {
  it('a student given a course by an admin is emailed about it', async () => {
    const w = await world();
    await w.student('given');
    const r = await w.admin.call('POST', '/admin/access/grant', {
      courseId: w.dbms.id,
      emails: ['given@vitbhopal.ac.in'],
      until: iso(30 * DAY),
    });
    expect(r.json.emailed).toEqual(['given@vitbhopal.ac.in']);
    const mail = w.sent().find((m) => m.to.email === 'given@vitbhopal.ac.in')!;
    expect(mail.subject).toBe(`${w.dbms.title} is on your shelf`);
    expect(mail.html).toContain('ADDED TO YOUR SHELF');
    expect(mail.html).toContain(`/c/${w.dbms.slug}`);
    expect(mail.text).toContain('Yours until');
  });

  it('when access ends the student gets one email listing every ended course, once', async () => {
    const w = await world();
    const s = await w.student('ending');
    await w.buy(s, w.dbms.id);
    await w.buy(s, w.os.id);
    const me = (await s.call('GET', '/me')).json.id as string;
    for (const c of [w.dbms, w.os])
      await w.admin.call('POST', '/admin/access/change', {
        courseId: c.id,
        userIds: [me],
        action: 'until',
        until: iso(-DAY),
      });
    expect(await w.env.container.accessMail.notifyEnded()).toBe(1);
    const mail = w
      .sent()
      .filter((m) => m.to.email === 'ending@vitbhopal.ac.in')
      .at(-1)!;
    expect(mail.subject).toBe('Your access to 2 courses has ended');
    expect(mail.text).toContain(w.dbms.title);
    expect(mail.text).toContain(w.os.title);
    expect(mail.text).toContain('reading progress is saved');
    expect(mail.html).toContain('ACCESS ENDED');
    // Never twice for the same ending.
    expect(await w.env.container.accessMail.notifyEnded()).toBe(0);

    // Buy again, end again: a new email.
    await w.buy(s, w.dbms.id);
    await w.admin.call('POST', '/admin/access/change', {
      courseId: w.dbms.id,
      userIds: [me],
      action: 'until',
      until: iso(-DAY),
    });
    expect(await w.env.container.accessMail.notifyEnded()).toBe(1);
    expect(
      w
        .sent()
        .filter((m) => m.to.email === 'ending@vitbhopal.ac.in')
        .at(-1)!.subject,
    ).toBe(`Your access to ${w.dbms.title} has ended`);
  });

  it('a blocked student or a lost dispute gets no "come back" email', async () => {
    const w = await world();
    const s = await w.student('blocked');
    await w.buy(s, w.dbms.id);
    const id = (await s.call('GET', '/me')).json.id;
    await w.admin.call('POST', '/admin/access/change', {
      courseId: w.dbms.id,
      userIds: [id],
      action: 'until',
      until: iso(-1000),
    });
    await w.admin.call('POST', '/admin/access/change', {
      courseId: w.dbms.id,
      userIds: [id],
      action: 'block',
    });
    const d = await w.student('disputed');
    await w.buy(d, w.dbms.id);
    const order = [...w.env.db.orders.values()].find((o) => o.gatewayPaymentId && o.userId !== id)!;
    await new MemoryOrders(w.env.db).revokeByPayment(order.gatewayPaymentId!);
    expect(await w.env.container.accessMail.notifyEnded()).toBe(0);
  });
});

describe('several admins', () => {
  it('ADMIN_EMAILS can list several addresses, separated by commas', () => {
    const c = buildConfig({
      ADMIN_EMAILS: 'vitbsmashers@gmail.com, Second.Admin@vitbhopal.ac.in,third@gmail.com ;  ',
    });
    expect(c.adminEmails).toEqual([
      'vitbsmashers@gmail.com',
      'second.admin@vitbhopal.ac.in',
      'third@gmail.com',
    ]);
  });

  it('each listed admin can sign in, and only they', async () => {
    const { SignJWT } = await import('jose');
    const secret = 'test-legacy-jwt-secret-that-is-long-enough-123';
    const v = new SupabaseJwtVerifier('https://x.supabase.co', secret, 'vitbhopal.ac.in', async (e) =>
      ['vitbsmashers@gmail.com', 'third@gmail.com'].includes(e),
    );
    const token = (email: string) =>
      new SignJWT({ email, session_id: 's', amr: [{ method: 'otp' }] })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('u')
        .setIssuer('https://x.supabase.co/auth/v1')
        .setAudience('authenticated')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(secret));
    expect((await v.verify(await token('third@gmail.com'))).email).toBe('third@gmail.com');
    await expect(v.verify(await token('fourth@gmail.com'))).rejects.toMatchObject({
      code: 'NOT_COLLEGE_EMAIL',
    });
  });
});
