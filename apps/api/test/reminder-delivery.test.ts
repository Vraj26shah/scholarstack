import { MAX_CLASS_NUDGES_PER_DAY, ReminderPrefs } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLASS_REMINDERS_FEATURE, MESS_FEATURE, ReminderService } from '../src/application/campus-service';
import type {
  PushJob,
  PushMessage,
  PushQueue,
  PushResult,
  PushSender,
  PushTarget,
} from '../src/domain/campus-ports';
import type { Feature } from '../src/domain/entities';
import type { FeatureRepository } from '../src/domain/ports';
import { MemoryMesses, MemoryPush } from '../src/infrastructure/campus-memory';

/** Monday 23 Nov 2026, hh:mm on campus (IST). */
const ist = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 23, h!, m!) - 330 * 60_000);
};

class Sender implements PushSender {
  readonly publicKey = 'BTestKey';
  readonly sent: { endpoint: string; message: PushMessage }[] = [];
  readonly fail = new Set<string>();
  readonly gone = new Set<string>();
  async send(t: PushTarget, message: PushMessage): Promise<PushResult> {
    if (this.gone.has(t.endpoint)) return 'gone';
    if (this.fail.has(t.endpoint)) return 'failed';
    this.sent.push({ endpoint: t.endpoint, message });
    return 'ok';
  }
}

class Features implements FeatureRepository {
  readonly rows = new Map<string, Feature>();
  constructor(live: string[] = []) {
    for (const [i, key] of [CLASS_REMINDERS_FEATURE, MESS_FEATURE].entries())
      this.rows.set(key, {
        key,
        title: key,
        blurb: '',
        status: live.includes(key) ? 'live' : 'soon',
        sort: i,
      });
  }
  async list() {
    return [...this.rows.values()];
  }
  async find(key: string) {
    return this.rows.get(key) ?? null;
  }
  async save(f: Feature) {
    this.rows.set(f.key, f);
    return f;
  }
  async remove(key: string) {
    this.rows.delete(key);
  }
}

/** Keeps every batch; `deliverAll` plays the queue consumer. */
class Queue implements PushQueue {
  batches: PushJob[][] = [];
  refuse = false;
  async send(batches: PushJob[][]) {
    if (this.refuse) throw new Error('daily allowance used up');
    // What the real queue does: the body is sent as JSON.
    this.batches.push(...JSON.parse(JSON.stringify(batches)));
  }
}

/** A device with one class at `start` (minutes) on Monday and a 10-minute nudge. */
const classDevice = (n: number, start: number, name = 'DSA') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/d${n}`,
  p256dh: 'B'.repeat(87),
  auth: 'a'.repeat(22),
  userId: `user-${n}`,
  email: '',
  label: 'Android · Chrome',
  prefs: ReminderPrefs.parse({
    mess: { slug: null },
    classes: {
      nightly: false,
      before: true,
      lead: 10,
      days: [0],
      courses: [{ code: 'CSE2001', name, room: 'AB1', times: [{ day: 0, start }] }],
    },
  }),
});

let now: Date;
let push: MemoryPush;
let sender: Sender;
let queue: Queue;
let svc: (opts?: { queue?: PushQueue | null; live?: string[] }) => ReminderService;

beforeEach(() => {
  now = ist('08:50');
  push = new MemoryPush(() => now);
  sender = new Sender();
  queue = new Queue();
  svc = (opts = {}) =>
    new ReminderService(
      push,
      new MemoryMesses(() => now),
      sender,
      new Features(opts.live ?? []),
      { now: () => now },
      35,
      undefined,
      opts.queue === null ? undefined : (opts.queue ?? queue),
      10,
    );
});

const subscribe = async (count: number, start = 540) => {
  for (let i = 0; i < count; i++) await push.upsert(classDevice(i, start));
};

describe('class reminders for a whole campus', () => {
  it('300 students with a 9:00 class: the run sends 10 itself and queues the rest, each exactly once', async () => {
    await subscribe(300);
    const s = svc();
    const run = await s.run();
    expect(run).toMatchObject({ checked: 300, sent: 10, queued: 290, deferred: 0, failed: 0 });
    expect(queue.batches).toHaveLength(29);
    expect(queue.batches.every((b) => b.length === 10)).toBe(true);

    // The next run (5 minutes later, still before 9:00) doesn't queue them again.
    now = ist('08:55');
    expect(await s.run()).toMatchObject({ sent: 0, queued: 0 });

    for (const b of queue.batches) await s.deliver(b);
    expect(sender.sent).toHaveLength(300);
    expect(new Set(sender.sent.map((x) => x.endpoint)).size).toBe(300);
    expect(sender.sent[0]!.message).toMatchObject({ title: 'DSA in 10 min', tag: 'class' });
  });

  it('the soonest class goes first when there are more than one run can send', async () => {
    const s = svc({ queue: null });
    for (let i = 0; i < 40; i++) await push.upsert(classDevice(i, 545, 'Later')); // 9:05
    for (let i = 40; i < 45; i++) await push.upsert(classDevice(i, 540, 'Sooner')); // 9:00
    now = ist('08:55');
    const run = await s.run();
    expect(run).toMatchObject({ sent: 35, deferred: 10 });
    expect(sender.sent.slice(0, 5).every((x) => x.message.title.startsWith('Sooner'))).toBe(true);
  });

  it('a failed send in a batch is taken back, and the next run tries it again before class', async () => {
    await subscribe(25);
    const s = svc();
    await s.run();
    sender.fail.add(classDevice(15, 540).endpoint);
    for (const b of queue.batches) await s.deliver(b);
    expect(sender.sent).toHaveLength(24);

    sender.fail.clear();
    queue.batches = [];
    now = ist('08:55');
    const again = await s.run();
    expect(again.sent).toBe(1);
    expect(sender.sent.at(-1)!.endpoint).toBe(classDevice(15, 540).endpoint);
  });

  it('when the queue refuses (allowance used up), nothing is lost: the next run picks them up', async () => {
    await subscribe(30);
    queue.refuse = true;
    const s = svc();
    const run = await s.run();
    expect(run).toMatchObject({ sent: 10, queued: 0, deferred: 20 });
    queue.refuse = false;
    now = ist('08:55');
    expect(await s.run()).toMatchObject({ sent: 10, queued: 10 });
  });

  it('a device that switched notifications off is forgotten; counts land per kind and day', async () => {
    await subscribe(12);
    sender.gone.add(classDevice(11, 540).endpoint);
    const s = svc();
    await s.run();
    for (const b of queue.batches) await s.deliver(b);
    expect((await push.listAll()).length).toBe(11);
    const [row] = await push.daily('2026-11-23');
    expect(row).toMatchObject({ day: '2026-11-23', kind: 'class', sent: 11, gone: 1, failed: 0 });

    await s.receipt(classDevice(0, 540).endpoint, 'class', 'shown');
    await s.receipt(classDevice(0, 540).endpoint, 'class', 'opened');
    await s.receipt('https://fcm.googleapis.com/fcm/send/unknown', 'class', 'shown');
    expect((await push.daily('2026-11-23'))[0]).toMatchObject({ seen: 1, opened: 1 });
  });
});

describe('who can turn them on', () => {
  it('class reminders open with the Timetable maker, meal reminders with the Mess menu', async () => {
    expect(await svc().status(false)).toMatchObject({ open: false, classes: false, meals: false });
    expect(await svc().status(true)).toMatchObject({ open: true, classes: true, meals: true });
    const timetableOnly = await svc({ live: [CLASS_REMINDERS_FEATURE] }).status(false);
    expect(timetableOnly).toMatchObject({ open: true, classes: true, meals: false });
    const input = {
      endpoint: classDevice(1, 540).endpoint,
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
    };
    await expect(
      svc().subscribe({ ...input, prefs: classDevice(1, 540).prefs, label: '' }, 'user-1', false),
    ).rejects.toThrow();
    // Signed out: refused even after launch.
    await expect(
      svc({ live: [CLASS_REMINDERS_FEATURE] }).subscribe(
        { ...input, prefs: classDevice(1, 540).prefs, label: '' },
        null,
        false,
      ),
    ).rejects.toThrow('Please sign in.');
    await svc({ live: [CLASS_REMINDERS_FEATURE] }).subscribe(
      { ...input, prefs: classDevice(1, 540).prefs, label: '' },
      'user-1',
      false,
    );
    expect((await push.listAll()).length).toBe(1);
  });
});

describe('the daily cap', () => {
  it(`never more than ${MAX_CLASS_NUDGES_PER_DAY} class nudges a day, even with a class every half hour`, async () => {
    const prefs = ReminderPrefs.parse({
      mess: { slug: null },
      classes: {
        nightly: false,
        before: true,
        lead: 10,
        days: [0],
        courses: Array.from({ length: 12 }, (_, i) => ({
          code: `C${i}`,
          name: `Course ${i}`,
          room: '',
          times: [{ day: 0, start: 480 + i * 30 }],
        })),
      },
    });
    await push.upsert({ ...classDevice(1, 540), prefs });
    const s = svc({ queue: null });
    for (let m = 470; m < 480 + 12 * 30; m += 5) {
      now = ist(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      await s.run();
    }
    expect(sender.sent).toHaveLength(MAX_CLASS_NUDGES_PER_DAY);
    expect(sender.sent[0]!.message.title).toBe('Course 0 in 10 min');
  });
});
