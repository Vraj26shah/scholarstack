import { HANDOVER, campusClock } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';
const MIN = 60_000;

beforeEach(() => {
  ({ clock, env, app } = setup());
});
const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const today = () => campusClock(new Date(clock.t)).date;
const device = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/handover-${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  label: 'Android · Chrome',
});
const sentTo = (n: number) => env.campus.pushSender.sent.filter((s) => s.endpoint === device(n).endpoint);

async function scene() {
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
  const item = (
    input.order as { items: { name: string; price: number; available: boolean; tiffin?: boolean }[] }[]
  )
    .flatMap((x) => x.items)
    .find((i) => i.available && !i.tiffin && i.price > 0)!;
  const owner = await signedIn(OWNER);
  const student = await signedIn('student1@vitbhopal.ac.in');
  const order = async () => {
    const placed = await student.call('POST', `/mess/${SLUG}/orders`, {
      lines: [{ name: item.name, qty: 1, detail: '' }],
      mode: 'pickup',
      name: 'Ravi',
      phone: '9123456789',
      phoneConfirmed: true,
    });
    expect(placed.status).toBe(200);
    clock.advance(2 * MIN); // past the double-tap gap
    return placed.json as { id: string; code: string; handoverCode: string };
  };
  const accept = (id: string) => owner.call('PUT', `/owner/orders/${id}`, { status: 'accepted', note: '' });
  return { admin, owner, student, order, accept };
}

describe('handing an order over with the student’s code', () => {
  it('only the student sees the code; the right code finishes the order', async () => {
    const { owner, student, order, accept } = await scene();
    const o = await order();
    expect(o.handoverCode).toMatch(/^\d{4}$/);
    await accept(o.id);
    const board = (await owner.call('GET', `/owner/messes/${SLUG}/orders`)).json;
    expect(board[0].handoverCode).toBe('');
    // The chat the restaurant sees doesn't carry it either.
    const ownerChat = await owner.call('GET', `/chats/${o.id}`, undefined, { 'x-chat-side': 'owner' });
    expect(JSON.stringify(ownerChat.json)).not.toContain(`"handoverCode":"${o.handoverCode}"`);

    const wrong = String((Number(o.handoverCode) + 1) % 10000).padStart(4, '0');
    const bad = await owner.call('POST', `/owner/orders/${o.id}/handover`, { code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/4 tries left/);

    const good = await owner.call('POST', `/owner/orders/${o.id}/handover`, { code: o.handoverCode });
    expect(good.status).toBe(200);
    expect(good.json).toMatchObject({ status: 'done', handoverHow: 'code' });
    const mine = (await student.call('GET', '/me/mess-orders')).json[0];
    expect(mine).toMatchObject({ status: 'done', handoverCode: '', canConfirm: false, canDispute: '' });
    // The header learns about My orders and My restaurant from the account answer itself.
    expect((await student.call('GET', '/me')).json.nav).toEqual({ owner: false, orders: true });
    expect((await owner.call('GET', '/me')).json.nav).toMatchObject({ owner: true });
  });

  it('five wrong codes a day, then only "without code" is left', async () => {
    const { owner, order, accept } = await scene();
    const o = await order();
    await accept(o.id);
    const wrong = String((Number(o.handoverCode) + 7) % 10000).padStart(4, '0');
    for (let i = 0; i < HANDOVER.triesPerDay; i++)
      expect((await owner.call('POST', `/owner/orders/${o.id}/handover`, { code: wrong })).status).toBe(400);
    const locked = await owner.call('POST', `/owner/orders/${o.id}/handover`, { code: o.handoverCode });
    expect(locked.json.error.message).toMatch(/Too many wrong codes/);
    const without = await owner.call('POST', `/owner/orders/${o.id}/handover`, { withoutCode: true });
    expect(without.json).toMatchObject({ status: 'done', handoverHow: 'owner' });
  });
});

describe('handed over without a code', () => {
  it('the student confirms, or says it never came and the admin decides', async () => {
    const { admin, owner, student, order, accept } = await scene();
    const a = await order();
    await accept(a.id);
    await owner.call('POST', `/owner/orders/${a.id}/handover`, { withoutCode: true });
    let mine = (await student.call('GET', '/me/mess-orders')).json.find((x: { id: string }) => x.id === a.id);
    expect(mine).toMatchObject({ handoverHow: 'owner', canConfirm: true, canDispute: 'not_received' });
    const ok = await student.call('POST', `/me/mess-orders/${a.id}/received`);
    expect(ok.json).toMatchObject({ handoverHow: 'student', canConfirm: false, canDispute: '' });

    const b = await order();
    await accept(b.id);
    // The old "Ready" then "Done" buttons work too: "Done" is a handover without a code.
    await owner.call('PUT', `/owner/orders/${b.id}`, { status: 'ready', note: '' });
    const done = await owner.call('PUT', `/owner/orders/${b.id}`, { status: 'done', note: '' });
    expect(done.json).toMatchObject({ status: 'done', handoverHow: 'owner' });
    const contested = await student.call('POST', `/me/mess-orders/${b.id}/dispute`, {
      kind: 'not_received',
      note: 'Nobody came',
    });
    expect(contested.json.error?.message ?? '').toBe('');
    expect(contested.json.dispute).toMatchObject({
      kind: 'not_received',
      state: 'open',
      note: 'Nobody came',
    });
    const list = (await admin.call('GET', '/admin/disputes')).json;
    expect(list[0]).toMatchObject({ orderId: b.id, kind: 'not_received', state: 'open', studentDisputes: 1 });
    const decided = (await admin.call('POST', `/admin/disputes/orders/${b.id}`, { decision: 'owner' })).json;
    expect(decided[0].state).toBe('owner');
    mine = (await student.call('GET', '/me/mess-orders')).json.find((x: { id: string }) => x.id === b.id);
    expect(mine.dispute.state).toBe('owner');
  });

  it("the student can say “I got it” on an accepted order, and “it didn't come” only when very late", async () => {
    const { student, order, accept } = await scene();
    const o = await order();
    await accept(o.id);
    let mine = (await student.call('GET', '/me/mess-orders')).json[0];
    expect(mine).toMatchObject({ canConfirm: true, canDispute: '' });
    expect(
      (await student.call('POST', `/me/mess-orders/${o.id}/dispute`, { kind: 'not_received' })).status,
    ).toBe(400);
    clock.advance(HANDOVER.lateAfterMinutes * MIN);
    mine = (await student.call('GET', '/me/mess-orders')).json[0];
    expect(mine.canDispute).toBe('not_received');
    const got = await student.call('POST', `/me/mess-orders/${o.id}/received`);
    expect(got.json).toMatchObject({ status: 'done', handoverHow: 'student' });
  });
});

describe('a contested "didn\'t collect"', () => {
  it('waits a while before it can be marked, and does not count while contested', async () => {
    const { admin, owner, student, order, accept } = await scene();
    const o = await order();
    await accept(o.id);
    const early = await owner.call('POST', `/owner/orders/${o.id}/no-show`);
    expect(early.json.error.message).toMatch(/Give the student time/);
    clock.advance(HANDOVER.noShowAfterMinutes * MIN);
    expect((await owner.call('POST', `/owner/orders/${o.id}/no-show`)).status).toBe(200);
    expect((await student.call('GET', '/me/order-standing')).json.noShows).toBe(1);
    await student.call('POST', `/me/mess-orders/${o.id}/dispute`, { kind: 'no_show', note: 'I was there' });
    expect((await student.call('GET', '/me/order-standing')).json.noShows).toBe(0);
    await admin.call('POST', `/admin/disputes/orders/${o.id}`, { decision: 'owner' });
    expect((await student.call('GET', '/me/order-standing')).json.noShows).toBe(1);
    await admin.call('POST', `/admin/disputes/orders/${o.id}`, { decision: 'student' });
    expect((await student.call('GET', '/me/order-standing')).json.noShows).toBe(0);
  });
});

describe('tiffin meals', () => {
  async function plan() {
    const s = await scene();
    const placed = (
      await s.student.call('POST', `/mess/${SLUG}/orders`, {
        lines: [{ name: 'Monthly tiffin', qty: 1, detail: '' }],
        mode: 'delivery',
        address: 'Block C, room 9',
        name: 'Ravi',
        phone: '9123456789',
        phoneConfirmed: true,
        tiffin: { plan: 'lunch', startsOn: today() },
      })
    ).json;
    await s.accept(placed.id);
    return { ...s, id: placed.id as string };
  }
  const lunchOf = async (student: Browser, id: string) =>
    (await student.call('GET', '/me/mess-orders')).json.find((x: { id: string }) => x.id === id).tiffin
      .meals[0];

  it('each meal has its own code; the owner types it to mark the meal delivered', async () => {
    const { owner, student, id } = await plan();
    const meal = await lunchOf(student, id);
    expect(meal).toMatchObject({ day: today(), meal: 'lunch', mark: null, canAnswer: true });
    expect(meal.code).toMatch(/^\d{4}$/);
    const sheet = (
      await owner.call('PUT', '/owner/tiffin/marks', {
        orderId: id,
        day: today(),
        meal: 'lunch',
        status: 'delivered',
        code: meal.code,
      })
    ).json;
    expect(sheet.lunch[0]).toMatchObject({ mark: 'delivered', how: 'code' });
    expect(await lunchOf(student, id)).toMatchObject({
      code: '',
      mark: 'delivered',
      how: 'code',
      canAnswer: false,
    });
  });

  it('without a code the student is asked; a "no" goes to the admin', async () => {
    const { admin, owner, student, id } = await plan();
    await student.call('POST', '/push/account', device(9));
    await owner.call('PUT', '/owner/tiffin/marks', {
      orderId: id,
      day: today(),
      meal: 'lunch',
      status: 'delivered',
    });
    expect(sentTo(9).at(-1)!.message.body).toMatch(/without your code/);
    expect(await lunchOf(student, id)).toMatchObject({ how: 'owner', confirm: '', canAnswer: true });
    const after = (
      await student.call('POST', '/me/tiffin/confirm', {
        orderId: id,
        day: today(),
        meal: 'lunch',
        answer: 'no',
      })
    ).json;
    expect(after.find((x: { id: string }) => x.id === id).tiffin.meals[0].confirm).toBe('no');
    // The owner can't quietly mark it again without the code.
    const again = await owner.call('PUT', '/owner/tiffin/marks', {
      orderId: id,
      day: today(),
      meal: 'lunch',
      status: 'delivered',
    });
    expect(again.status).toBe(400);
    const list = (await admin.call('GET', '/admin/disputes')).json;
    expect(list[0]).toMatchObject({ kind: 'tiffin', state: 'open', meal: { day: today(), meal: 'lunch' } });
    const dec = await admin.call('POST', '/admin/disputes/tiffin', {
      orderId: id,
      day: today(),
      meal: 'lunch',
      decision: 'student',
    });
    expect(dec.json.error?.message ?? '').toBe('');
    const sheet = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json;
    expect(sheet.lunch[0].mark).toBe('missed');
  });
});

describe('no notification for what is already on screen', () => {
  it("skips the student's phone while their orders page is open, and sends once they leave", async () => {
    const { owner, student, order, accept } = await scene();
    await student.call('POST', '/push/account', device(5));
    const a = await order();
    await student.call('GET', '/me/mess-orders'); // looking at it
    const before = sentTo(5).length;
    await accept(a.id);
    expect(sentTo(5).length).toBe(before);
    await student.call('POST', '/me/presence/leave', { scopes: ['orders'] });
    await owner.call('PUT', `/owner/orders/${a.id}`, { status: 'ready', note: '' });
    expect(sentTo(5).length).toBe(before + 1);
  });
});
