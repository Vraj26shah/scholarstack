import { campusClock } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../src/application/owner-insights';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';
const DAY = 86_400_000;

beforeEach(() => {
  ({ clock, env, app } = setup());
});
const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const today = () => campusClock(new Date(clock.t)).date;

async function runningPlan() {
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
  const owner = await signedIn(OWNER);
  const s = await signedIn('student1@vitbhopal.ac.in');
  const placed = (
    await s.call('POST', `/mess/${SLUG}/orders`, {
      lines: [{ name: 'Monthly tiffin', qty: 1, detail: '' }],
      mode: 'delivery',
      address: 'Block C, room 9',
      name: 'Ravi',
      phone: '9123456789',
      phoneConfirmed: true,
      tiffin: { plan: 'both', startsOn: today() },
    })
  ).json;
  await owner.call('PUT', `/owner/orders/${placed.id}`, { status: 'accepted' });
  return { owner, s, id: placed.id as string };
}

describe('tiffin deliveries', () => {
  it("each row carries the student's whole record: delivered, missed, made up, lapsed, left", async () => {
    const { owner, id } = await runningPlan();
    const day1 = today();
    const mark = (body: Record<string, unknown>) =>
      owner.call('PUT', '/owner/tiffin/marks', { orderId: id, ...body });
    const fresh = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.lunch[0].record;
    expect(fresh).toEqual({
      total: 60,
      delivered: 0,
      missed: 0,
      madeUp: 0,
      lapsed: 0,
      unmarked: 2,
      left: 58,
    });

    await mark({ day: day1, meal: 'lunch', status: 'delivered' });
    await mark({ day: day1, meal: 'dinner', status: 'missed' });
    clock.advance(DAY);
    await mark({ day: addDays(day1, 1), meal: 'lunch', status: 'missed' });
    await mark({ day: addDays(day1, 1), meal: 'dinner', status: 'delivered', makeupFor: day1 });
    let rec = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.lunch[0].record;
    // Day 2's own dinner isn't marked yet.
    expect(rec).toMatchObject({ delivered: 1, missed: 2, madeUp: 1, lapsed: 0, unmarked: 1, left: 56 });

    // Six days later nobody made up day 2's lunch: it lapsed. Days 3–8 were never marked.
    clock.advance(6 * DAY);
    rec = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.lunch[0].record;
    expect(rec).toMatchObject({ delivered: 1, missed: 2, madeUp: 1, lapsed: 1, unmarked: 13, left: 44 });
  });

  it('marks meals, carries a missed meal for 4 days, then it lapses', async () => {
    const { owner, s, id } = await runningPlan();
    const day1 = today();
    let sheet = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json;
    expect(sheet.lunch).toHaveLength(1);
    expect(sheet.counts).toEqual({ delivered: 0, missed: 0, pending: 2 });

    const mark = (body: Record<string, unknown>) =>
      owner.call('PUT', '/owner/tiffin/marks', { orderId: id, ...body });
    expect((await mark({ day: day1, meal: 'lunch', status: 'delivered' })).json.counts).toMatchObject({
      delivered: 1,
    });
    sheet = (await mark({ day: day1, meal: 'dinner', status: 'missed' })).json;
    expect(sheet.counts).toEqual({ delivered: 1, missed: 1, pending: 0 });
    // Not a day in the future; not a meal outside the plan's days.
    expect((await mark({ day: addDays(day1, 1), meal: 'lunch', status: 'delivered' })).status).toBe(400);

    // Next day: the missed dinner shows as a make-up, until day 1 + 4.
    clock.advance(DAY);
    sheet = (await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json;
    expect(sheet.makeups).toEqual([
      expect.objectContaining({ meal: 'dinner', makeupFor: day1, makeupUntil: addDays(day1, 4), mark: null }),
    ]);
    // The student sees it too.
    const mine = (await s.call('GET', '/me/mess-orders')).json.find((o: { id: string }) => o.id === id);
    expect(mine.tiffin).toMatchObject({ delivered: 1, missed: 1, makeups: [{ day: day1, meal: 'dinner' }] });

    // Given today as an extra: gone from later sheets.
    const given = await mark({ day: addDays(day1, 1), meal: 'dinner', status: 'delivered', makeupFor: day1 });
    expect(given.json.makeups[0].mark).toBe('delivered');
    clock.advance(DAY);
    expect((await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.makeups).toEqual([]);

    // Another miss, never made up: after 4 days it lapses.
    await mark({ day: addDays(day1, 2), meal: 'lunch', status: 'missed' });
    clock.advance(4 * DAY);
    expect((await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.makeups).toHaveLength(1);
    expect(
      (await mark({ day: addDays(day1, 7), meal: 'lunch', status: 'delivered', makeupFor: addDays(day1, 2) }))
        .status,
    ).toBe(400);
    clock.advance(DAY);
    expect((await owner.call('GET', `/owner/messes/${SLUG}/tiffin`)).json.makeups).toEqual([]);

    // Only the owner marks.
    expect(
      (await s.call('PUT', '/owner/tiffin/marks', { orderId: id, day: day1, meal: 'lunch', status: 'clear' }))
        .status,
    ).toBe(403);
  });
});
