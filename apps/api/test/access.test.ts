import { beforeEach, describe, expect, it } from 'vitest';
import { accessEnd } from '../src/domain/access-window';
import { MemoryOrders } from '../src/infrastructure/memory';
import { Browser, setup } from './harness';

/** Course access periods and the admin's Students & access controls. */
describe('access periods', () => {
  let env: ReturnType<typeof setup>['env'];
  let app: ReturnType<typeof setup>['app'];
  let admin: Browser;
  const dbms = () => [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
  const file = () => [...env.db.files.values()].find((f) => f.courseId === dbms().id && !f.hidden)!;
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  beforeEach(async () => {
    ({ env, app } = setup());
    admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
  });

  async function student(name: string) {
    const b = new Browser(app);
    await b.signIn(`${name}@vitbhopal.ac.in`);
    return b;
  }
  async function buy(b: Browser) {
    const start = await b.call('POST', '/orders', { courseId: dbms().id });
    expect(start.status).toBe(201);
    const pay = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
    const v = await b.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: pay.json.gatewayPaymentId,
      signature: pay.json.signature,
    });
    expect(v.status).toBe(200);
  }
  const opens = async (b: Browser) =>
    (await b.call('POST', '/reader/open', { fileId: file().id })).status === 200;
  const shelfState = async (b: Browser) =>
    (await b.call('GET', '/me/shelf')).json.find((i: any) => i.course.id === dbms().id)?.access;
  const userId = async (b: Browser) => (await b.call('GET', '/me')).json.id as string;

  it('every purchase lasts 3 months from the day it is bought', async () => {
    const s = await student('buyer');
    expect((await s.call('GET', `/courses/${dbms().slug}`)).json.accessMonths).toBe(3);
    const before = Date.now();
    await buy(s);
    const until = new Date((await shelfState(s)).until).getTime();
    const expected = accessEnd(new Date(before)).getTime();
    expect(Math.abs(until - expected)).toBeLessThan(60_000);
    expect((await s.call('GET', `/courses/${dbms().slug}`)).json.yourAccessUntil).toBe(
      (await shelfState(s)).until,
    );
  });

  it('when access is over the reader stops, the shelf says why, and buying again gives 3 new months', async () => {
    const s = await student('ended');
    await buy(s);
    expect(await opens(s)).toBe(true);
    await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [await userId(s)],
      action: 'until',
      until: iso(-DAY),
    });
    expect(await opens(s)).toBe(false);
    expect((await shelfState(s)).state).toBe('ended');
    expect((await s.call('GET', `/courses/${dbms().slug}`)).json.owned).toBe(false);
    await buy(s);
    expect(await opens(s)).toBe(true);
    const until = new Date((await shelfState(s)).until).getTime();
    expect(until).toBeGreaterThan(Date.now() + 80 * DAY);
  });

  it('the admin can block, restore and extend one student, and sees everyone with their state', async () => {
    const a = await student('alpha');
    const b = await student('beta');
    await buy(a);
    await buy(b);
    const [ida, idb] = [await userId(a), await userId(b)];

    let view = await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [ida],
      action: 'block',
    });
    expect(view.json.changed).toBe(1);
    expect(await opens(a)).toBe(false);
    expect(await opens(b)).toBe(true);
    expect((await shelfState(a)).state).toBe('blocked');
    expect(view.json.students.find((x: any) => x.userId === ida)).toMatchObject({
      email: 'alpha@vitbhopal.ac.in',
      state: 'blocked',
    });

    view = await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [ida],
      action: 'restore',
    });
    expect(await opens(a)).toBe(true);

    await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [ida, idb],
      action: 'until',
      until: iso(-1000),
    });
    expect(await opens(a)).toBe(false);
    expect(await opens(b)).toBe(false);
    view = await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [ida, idb],
      action: 'until',
      until: iso(60 * DAY),
    });
    expect(await opens(a)).toBe(true);
    expect(view.json.students.every((x: any) => x.state === 'active')).toBe(true);
  });

  it('an admin restore never undoes a lost bank dispute', async () => {
    const s = await student('dispute');
    await buy(s);
    const id = await userId(s);
    const order = [...env.db.orders.values()].find((o) => o.userId === id)!;
    await new MemoryOrders(env.db).revokeByPayment(order.gatewayPaymentId!);
    await admin.call('POST', '/admin/access/change', {
      courseId: dbms().id,
      userIds: [id],
      action: 'restore',
    });
    expect(await opens(s)).toBe(false);
    const view = await admin.call('GET', `/admin/access?courseId=${dbms().id}`);
    expect(view.json.students[0].state).toBe('disputed');
  });

  it('the admin can give a course by email, and is told about anyone it could not reach', async () => {
    const s = await student('gifted');
    expect(await opens(s)).toBe(false);
    const r = await admin.call('POST', '/admin/access/grant', {
      courseId: dbms().id,
      emails: [
        ' Gifted@VITBHOPAL.ac.in ',
        'nobody.yet@vitbhopal.ac.in',
        'gifted+2@vitbhopal.ac.in',
        'someone@gmail.com',
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.granted).toEqual(['gifted@vitbhopal.ac.in']);
    expect(r.json.notFound).toEqual(['nobody.yet@vitbhopal.ac.in']);
    expect(r.json.invalid).toEqual(['gifted+2@vitbhopal.ac.in', 'someone@gmail.com']);
    expect(await opens(s)).toBe(true);
    expect((await shelfState(s)).state).toBe('active');
    expect(new Date((await shelfState(s)).until).getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
    const row = r.json.students.find((x: any) => x.email === 'gifted@vitbhopal.ac.in');
    expect(row).toMatchObject({ state: 'active', source: 'admin' });

    // A chosen date (or no end) overrides the 3 months; a past date is refused.
    await admin.call('POST', '/admin/access/grant', {
      courseId: dbms().id,
      emails: ['gifted@vitbhopal.ac.in'],
      until: null,
    });
    expect((await shelfState(s)).until).toBeNull();
    const past = await admin.call('POST', '/admin/access/grant', {
      courseId: dbms().id,
      emails: ['gifted@vitbhopal.ac.in'],
      until: iso(-DAY),
    });
    expect(past.status).toBe(400);
  });

  it('refuses a malformed change', async () => {
    for (const body of [
      { courseId: dbms().id, userIds: [], action: 'block' },
      { courseId: dbms().id, userIds: ['x'], action: 'delete-everything' },
      { courseId: dbms().id, userIds: ['x'], action: 'until', until: 'next tuesday' },
    ]) {
      const r = await admin.call('POST', '/admin/access/change', body);
      expect(r.status).toBe(400);
    }
  });
});
