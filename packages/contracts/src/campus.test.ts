import { describe, expect, it } from 'vitest';
import {
  type MessInput,
  ReminderPrefs,
  SaveMessBody,
  campusClock,
  chatTextProblem,
  dishesOn,
  duePushes,
  favouritesIn,
  formatClock,
  formatSpan,
  weekIndex,
} from './campus';

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

const mess: Pick<MessInput, 'weeks' | 'cycleStart' | 'meals'> & { name: string; slug: string } = {
  name: 'Test mess',
  slug: 'test-mess',
  cycleStart: '2026-10-12',
  meals: [
    { key: 'lunch', start: '12:15', end: '14:30', extras: '' },
    { key: 'dinner', start: '19:30', end: '21:30', extras: '' },
  ],
  weeks: [
    {
      label: 'Week 1',
      days: {
        mon: { lunch: [{ name: 'Dal fry', unsure: false }] },
        tue: {},
        wed: {},
        thu: {},
        fri: {},
        sat: {},
        sun: {},
      },
    },
    {
      label: 'Week 2',
      days: {
        mon: { lunch: [{ name: 'Rajma', unsure: false }] },
        tue: {},
        wed: {},
        thu: {},
        fri: {},
        sat: {},
        sun: {},
      },
    },
  ],
};

describe('campus time', () => {
  it('is India time whatever the server clock', () => {
    expect(campusClock(new Date('2026-11-22T20:00:00Z'))).toEqual({
      date: '2026-11-23',
      day: 0,
      minutes: 90,
    });
    expect(campusClock(ist('2026-11-29', '23:59'))).toMatchObject({ day: 6, minutes: 1439 });
  });
  it('formats times as students read them', () => {
    expect(formatClock(450)).toBe('7:30 am');
    expect(formatClock(735)).toBe('12:15 pm');
    expect(formatClock(0)).toBe('12:00 am');
    expect(formatSpan('12:15', '14:30')).toBe('12:15 – 2:30 pm');
    expect(formatSpan('11:30', '13:00')).toBe('11:30 am – 1:00 pm');
  });
});

describe('rotating menus', () => {
  it('turns the week over on Mondays, counted from the cycle start', () => {
    expect(weekIndex('2026-10-12', '2026-10-12', 2)).toBe(0);
    expect(weekIndex('2026-10-12', '2026-10-18', 2)).toBe(0); // Sunday, same week
    expect(weekIndex('2026-10-12', '2026-10-19', 2)).toBe(1);
    expect(weekIndex('2026-10-12', '2026-10-26', 2)).toBe(0);
    expect(weekIndex('2026-10-14', '2026-10-19', 2)).toBe(1); // a mid-week start still flips on Monday
    expect(weekIndex('2026-10-12', '2026-10-05', 2)).toBe(1); // before the start: counts back
    expect(weekIndex('2026-10-12', '2027-03-01', 1)).toBe(0);
  });
  it('serves the right week and nothing for a meal the mess does not have', () => {
    expect(dishesOn(mess, '2026-11-16', 'lunch').map((d) => d.name)).toEqual(['Rajma']);
    expect(dishesOn(mess, '2026-11-23', 'lunch').map((d) => d.name)).toEqual(['Dal fry']);
    expect(dishesOn(mess, '2026-11-23', 'breakfast')).toEqual([]);
  });
  it('finds favourites in any case', () => {
    expect(favouritesIn([{ name: 'Palak Paneer (veg)', unsure: false }], ['paneer', 'biryani'])).toEqual([
      'paneer',
    ]);
  });
});

describe('due reminders', () => {
  const prefs = ReminderPrefs.parse({ mess: { slug: 'test-mess' } });

  it('meal: from 30 min before until it starts, never for a meal with no menu', () => {
    expect(duePushes(prefs, mess, ist('2026-11-23', '11:44'))).toEqual([]);
    const due = duePushes(prefs, mess, ist('2026-11-23', '11:45'));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      key: 'mess:2026-11-23:lunch',
      title: 'Lunch in 30 min 🍛',
      body: 'Dal fry · Test mess',
    });
    expect(duePushes(prefs, mess, ist('2026-11-23', '12:15'))).toEqual([]);
    // Monday dinner has no menu: skipped.
    expect(duePushes(prefs, mess, ist('2026-11-23', '19:10'))).toEqual([]);
  });

  it('never twice, and not on a muted day', () => {
    expect(duePushes(prefs, mess, ist('2026-11-23', '11:50'), new Set(['mess:2026-11-23:lunch']))).toEqual(
      [],
    );
    expect(duePushes({ ...prefs, mutedOn: '2026-11-23' }, mess, ist('2026-11-23', '11:50'))).toEqual([]);
    expect(duePushes({ ...prefs, mutedOn: '2026-11-22' }, mess, ist('2026-11-23', '11:50'))).toHaveLength(1);
  });

  it('no class summary for a day off', () => {
    const p = ReminderPrefs.parse({
      classes: { nightly: true, courses: [{ name: 'DSA', times: [{ day: 0, start: 510 }] }] },
    });
    // Sunday 9 pm: Monday has DSA.
    expect(duePushes(p, null, ist('2026-11-22', '21:00'))[0]).toMatchObject({
      title: 'Tomorrow · 1 class',
      key: 'nightly:2026-11-23',
    });
    // Monday 9 pm: Tuesday has nothing.
    expect(duePushes(p, null, ist('2026-11-23', '21:00'))).toEqual([]);
  });
});

describe('restaurant ordering', () => {
  const base = {
    slug: 'dhaba',
    name: 'Dhaba',
    kind: 'restaurant',
    source: 'owner',
    meals: [{ key: 'lunch', start: '12:00', end: '15:00' }],
    weeks: [{ days: {} }],
    cycleStart: '2026-11-23',
  };
  it('a hostel mess needs no phone or order list', () => {
    expect(SaveMessBody.parse(base)).toMatchObject({ phone: '', orderNote: '', order: [] });
  });
  it("keeps the owner's items and whole-rupee prices", () => {
    const m = SaveMessBody.parse({
      ...base,
      phone: '+91 85179 03810',
      order: [{ title: 'Thali', items: [{ name: 'Mess thali', price: 80 }] }],
    });
    // No photo yet, and on sale unless the owner marks it sold out.
    expect(m.order[0]!.items[0]).toEqual({
      name: 'Mess thali',
      price: 80,
      note: '',
      photo: '',
      available: true,
    });
    expect(SaveMessBody.safeParse({ ...base, phone: 'call me' }).success).toBe(false);
    expect(
      SaveMessBody.safeParse({ ...base, order: [{ title: 'T', items: [{ name: 'X', price: 9.5 }] }] })
        .success,
    ).toBe(false);
  });
});

describe('chat text rules', () => {
  it('lets prices, codes and times through, stops numbers, links and emails', () => {
    for (const ok of ['₹120 x 2', 'Order K7Q2 at 7:30', 'Room 214, block B', 'Ready in 15 min'])
      expect(chatTextProblem(ok)).toBeNull();
    expect(chatTextProblem('+91-98765-43210')).toMatch(/Phone/);
    expect(chatTextProblem('insta.com/me')).toMatch(/Links/);
    expect(chatTextProblem('me@x.in')).toMatch(/Email/);
  });
});
