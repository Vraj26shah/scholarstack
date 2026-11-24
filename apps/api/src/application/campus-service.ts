import {
  type AdminPushDeviceDto,
  type AdminPushStatsDto,
  type DuePush,
  MEAL_NAMES,
  type MessDto,
  type MessInput,
  type MessReportDto,
  type MessReportInput,
  type MessReportStatus,
  type MessSummaryDto,
  type PushAccountInput,
  type PushDeviceDto,
  type PushRenewInput,
  type PushRunDto,
  type PushStatusDto,
  type PushSubscribeInput,
  type PushTestKind,
  type ReminderPrefs,
  ReminderPrefs as ReminderPrefsSchema,
  campusClock,
  dishesOn,
  duePushes,
  formatClock,
  formatSpan,
  isTiffinItem,
  normaliseEmail,
  toMinutes,
} from '@ss/contracts';
import type {
  MessRecord,
  MessReportRepository,
  MessRepository,
  PushMessage,
  PushRepository,
  PushSender,
  PushSubscriptionRecord,
} from '../domain/campus-ports';
import type { Clock, FeatureRepository, ProfileRepository } from '../domain/ports';
import { fail } from './errors';

/**
 * The toolbox key that switches these on for students. Until then only admins can use them.
 * Reminders live inside the Mess menu and the Timetable maker, so they launch with the Mess menu.
 */
export const MESS_FEATURE = 'mess-menu';
export const REMINDERS_FEATURE = MESS_FEATURE;

const isLive = async (features: FeatureRepository, key: string) =>
  (await features.find(key))?.status === 'live';

/**
 * Menus saved before photos and "sold out" existed have neither field: fill them in, so every
 * reader (student page, dashboard, ordering) sees the same complete shape.
 */
export const withItemDefaults = (order: MessRecord['order']): MessRecord['order'] =>
  (order ?? []).map((s) => ({
    ...s,
    items: s.items.map((i) => ({
      ...i,
      note: i.note ?? '',
      photo: i.photo ?? '',
      available: i.available !== false,
      tiffin: isTiffinItem(i),
    })),
  }));

export const toDto = ({ updatedAt, ...m }: MessRecord): MessDto => ({
  ...m,
  order: withItemDefaults(m.order),
  updatedAt: updatedAt.toISOString(),
});
const toSummary = (m: MessRecord): MessSummaryDto => ({
  slug: m.slug,
  name: m.name,
  kind: m.kind,
  place: m.place,
  published: m.published,
});

/**
 * Mess menus: hostel messes (four meals) and restaurants for day scholars (lunch and dinner).
 * Students see published menus once the mess-menu tool is live; admins see everything, always,
 * so a menu can be checked on the real site before anyone else sees it.
 */
export class MessService {
  constructor(
    private readonly messes: MessRepository,
    private readonly reports: MessReportRepository,
    private readonly features: FeatureRepository,
  ) {}

  /** Refuses students while the tool is still "coming soon". */
  async assertOpen(admin: boolean) {
    if (!admin && !(await isLive(this.features, MESS_FEATURE))) throw fail.notFound('The mess menu');
  }

  async list(admin: boolean): Promise<MessSummaryDto[]> {
    await this.assertOpen(admin);
    return (await this.messes.list()).filter((m) => admin || m.published).map(toSummary);
  }

  async get(slug: string, admin: boolean): Promise<MessDto> {
    await this.assertOpen(admin);
    const mess = await this.messes.find(slug);
    if (!mess || (!mess.published && !admin)) throw fail.notFound('That mess');
    // Who runs it is private: only admins see the owners' addresses.
    return admin ? toDto(mess) : { ...toDto(mess), ownerEmails: [] };
  }

  async report(input: MessReportInput, ipHash: string, admin: boolean) {
    await this.get(input.slug, admin);
    await this.reports.add({
      slug: input.slug,
      day: input.day ?? null,
      meal: input.meal ?? null,
      message: input.message,
      contact: input.contact,
      ipHash,
    });
  }

  // ── Admin ──

  async all(): Promise<MessDto[]> {
    return (await this.messes.list()).map(toDto);
  }

  async create(input: MessInput): Promise<MessDto> {
    if (await this.messes.find(input.slug))
      throw fail.badRequest('A mess with that short name already exists.');
    const all = await this.messes.list();
    return toDto(
      await this.messes.save({ ...input, sort: all.length ? Math.max(...all.map((m) => m.sort)) + 1 : 0 }),
    );
  }

  async update(slug: string, input: MessInput): Promise<MessDto> {
    const current = await this.messes.find(slug);
    if (!current) throw fail.notFound('That mess');
    if (input.slug !== slug) throw fail.badRequest("A mess's short name can't be changed.");
    return toDto(await this.messes.save({ ...input, sort: current.sort }));
  }

  async remove(slug: string) {
    if (!(await this.messes.find(slug))) throw fail.notFound('That mess');
    await this.messes.remove(slug);
  }

  async listReports(): Promise<MessReportDto[]> {
    const [reports, messes] = await Promise.all([this.reports.list(200), this.messes.list()]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    return reports.map((r) => ({
      ...r,
      messName: names.get(r.slug) ?? r.slug,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async setReportStatus(id: string, status: MessReportStatus) {
    if (!(await this.reports.setStatus(id, status))) throw fail.notFound('That report');
  }

  /** Demo and first run: the starting menus, only where none exists yet. */
  async seed(menus: MessInput[]) {
    const have = new Set((await this.messes.list()).map((m) => m.slug));
    let sort = have.size;
    for (const m of menus) if (!have.has(m.slug)) await this.messes.save({ ...m, sort: sort++ });
  }
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Lunch, dinner · Tomorrow's classes · 3 subjects before class". */
export function prefsSummary(p: ReminderPrefs): string {
  const parts: string[] = [];
  if (p.mess.slug && (p.mess.meals.length || p.mess.favourites.length))
    parts.push(p.mess.meals.map((m) => MEAL_NAMES[m]).join(', ') || 'Favourites only');
  if (p.classes.nightly) parts.push("Tomorrow's classes");
  if (p.classes.before && p.classes.courses.length)
    parts.push(
      `${p.classes.courses.length} subject${p.classes.courses.length === 1 ? '' : 's'} before class`,
    );
  return parts.join(' · ') || 'Nothing chosen yet';
}

const ACTIONS: Record<DuePush['tag'], PushMessage['actions']> = {
  mess: [
    { action: 'open', title: 'Full menu' },
    { action: 'mute', title: 'Mute today' },
  ],
  class: [{ action: 'mute', title: 'Mute today' }],
  nightly: [{ action: 'open', title: 'Open timetable' }],
};
const TTL: Record<DuePush['tag'], number> = { mess: 30 * 60, class: 15 * 60, nightly: 3 * 3600 };

/**
 * Push reminders: what a device asked for, and sending what is due every five minutes. A device
 * is known by its push address only; it is linked to an account when the student was signed in,
 * so they can see and switch off their devices from anywhere.
 */
export class ReminderService {
  constructor(
    private readonly push: PushRepository,
    private readonly messes: MessRepository,
    private readonly sender: PushSender,
    private readonly features: FeatureRepository,
    private readonly clock: Clock,
    /** Notifications per run: each one is a request, and a Worker run may make only so many. */
    private readonly perRun = 35,
    /** To find a person's account by email (admin tests). */
    private readonly profiles?: Pick<ProfileRepository, 'findByEmails'>,
  ) {}

  get configured() {
    return !!this.sender.publicKey;
  }

  async status(admin: boolean): Promise<PushStatusDto> {
    return {
      configured: this.configured,
      publicKey: this.sender.publicKey,
      open: admin || (await isLive(this.features, REMINDERS_FEATURE)),
    };
  }

  async subscribe(input: PushSubscribeInput, userId: string | null, admin: boolean) {
    if (!this.configured) throw fail.badRequest("Reminders aren't set up on the server yet.");
    if (!admin && !(await isLive(this.features, REMINDERS_FEATURE))) throw fail.notFound('Reminders');
    await this.push.upsert({
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      prefs: input.prefs,
      userId,
      email: '',
      label: input.label,
    });
  }

  /**
   * This device gets order alerts and chat messages for the signed-in account (students and
   * restaurant owners alike). A device that already has reminders keeps them.
   */
  async subscribeAccount(input: PushAccountInput, p: { userId: string; email: string }) {
    if (!this.configured) throw fail.badRequest("Notifications aren't set up on the server yet.");
    const current = await this.push.findByEndpoint(input.endpoint);
    await this.push.upsert({
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      prefs: current?.prefs ?? ReminderPrefsSchema.parse({ mess: { meals: [] } }),
      userId: p.userId,
      email: normaliseEmail(p.email),
      label: input.label || current?.label || '',
    });
  }

  async setPrefs(endpoint: string, prefs: ReminderPrefs) {
    if (!(await this.push.setPrefs(endpoint, prefs))) throw fail.notFound('Reminders for this device');
  }

  /** The device's service worker showed a notification: remember when (for "did it arrive?"). */
  async receipt(endpoint: string) {
    await this.push.markSeen(endpoint);
  }

  /** Every device of these accounts (by order-alert address and by account), for admin testing. */
  async devicesOf(emails: string[]): Promise<AdminPushDeviceDto[]> {
    const want = [...new Set(emails.map((e) => normaliseEmail(e)).filter(Boolean))];
    if (!want.length) return [];
    const accounts = this.profiles ? await this.profiles.findByEmails(want) : [];
    const lists = await Promise.all([
      this.push.listForEmails(want),
      ...accounts.map((a) => this.push.listForUser(a.id)),
    ]);
    const byId = new Map<string, PushSubscriptionRecord>();
    for (const s of lists.flat()) byId.set(s.id, s);
    return [...byId.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((s) => ({
        id: s.id,
        label: s.label || 'A device',
        email: s.email,
        createdAt: s.createdAt.toISOString(),
        seenAt: s.seenAt?.toISOString() ?? null,
        summary:
          [prefsSummary(s.prefs), s.email ? 'Order alerts and chat' : '']
            .filter((x) => x && x !== 'Nothing chosen yet')
            .join(' · ') || 'Nothing chosen yet',
      }));
  }

  /** Admin: a test notification to every device of this person, with what each push service said. */
  async testPerson(email: string): Promise<AdminPushDeviceDto[]> {
    if (!this.configured) throw fail.badRequest("Notifications aren't set up on the server yet.");
    const devices = await this.devicesOf([email]);
    if (!devices.length)
      throw fail.badRequest(
        'No device has notifications on for that address. Ask them to turn on reminders or alerts first.',
      );
    const all = await this.push.listAll();
    const byId = new Map(all.map((s) => [s.id, s]));
    const gone: string[] = [];
    const out = await Promise.all(
      devices.slice(0, 30).map(async (d) => {
        const sub = byId.get(d.id);
        if (!sub) return { ...d, result: 'failed' as const };
        const result = await this.sender
          .send(
            sub,
            {
              title: 'Test from Scholars Stack ✓',
              body: 'Notifications work on this device. You can ignore this one.',
              tag: 'test',
              url: '/',
            },
            300,
          )
          .catch(() => 'failed' as const);
        if (result === 'gone') gone.push(d.id);
        return { ...d, result };
      }),
    );
    if (gone.length) await this.push.removeIds(gone);
    return out;
  }

  async unsubscribe(endpoint: string) {
    await this.push.removeByEndpoint(endpoint);
  }

  /** The same device under a new push address: keep its settings and account link. */
  async renew(input: PushRenewInput) {
    const old = await this.push.findByEndpoint(input.oldEndpoint);
    if (!old) return;
    await this.push.upsert({
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      prefs: old.prefs,
      userId: old.userId,
      email: old.email,
      label: old.label,
    });
    if (input.subscription.endpoint !== old.endpoint) await this.push.removeIds([old.id]);
  }

  /** "Mute today" from the notification: nothing more until tomorrow (campus time). */
  async mute(endpoint: string) {
    const sub = await this.push.findByEndpoint(endpoint);
    if (!sub) return;
    await this.push.setPrefs(endpoint, { ...sub.prefs, mutedOn: campusClock(this.clock.now()).date });
  }

  /** A sample right away, built from this device's real choices where it can be. */
  async test(endpoint: string, kind?: PushTestKind) {
    const sub = await this.push.findByEndpoint(endpoint);
    if (!sub) throw fail.notFound('Reminders for this device');
    const message = kind === 'class' ? this.classSample(sub) : await this.sample(sub);
    const result = await this.sender.send(sub, message, 300);
    if (result === 'gone') {
      await this.push.removeIds([sub.id]);
      throw fail.badRequest('This device stopped accepting notifications. Turn reminders on again.');
    }
    if (result === 'failed') throw fail.badRequest("The test didn't go through. Try again in a minute.");
  }

  /**
   * A class reminder as it will really read: the student's next chosen class (today or later this
   * week), else a plain "they're on" with what was chosen. Opens the timetable.
   */
  private classSample(sub: PushSubscriptionRecord): PushMessage {
    const { day, minutes } = campusClock(this.clock.now());
    const c = sub.prefs.classes;
    const next = c.courses
      .flatMap((course) =>
        course.times.map((t) => ({ course, t, ahead: ((t.day - day + 7) % 7) * 1440 + t.start - minutes })),
      )
      .map((x) => ({ ...x, ahead: x.ahead < 0 ? x.ahead + 7 * 1440 : x.ahead }))
      .sort((a, b) => a.ahead - b.ahead)[0];
    if (next) {
      const when =
        next.ahead < 1440 && next.t.day === day
          ? `today ${formatClock(next.t.start)}`
          : `${WEEKDAY[next.t.day]} ${formatClock(next.t.start)}`;
      return {
        title: `Test · ${next.course.name.slice(0, 40)} ${when}`,
        body: [
          next.course.code,
          next.course.room,
          c.before ? `nudge ${c.lead} min before` : '',
          c.nightly ? `tomorrow's list at ${formatClock(toMinutes(c.nightlyAt))}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        tag: 'test',
        url: '/tools/timetable',
      };
    }
    return {
      title: 'Class reminders are on ✓',
      body:
        c.nightly || c.before
          ? `This is how they'll look. ${prefsSummary({ ...sub.prefs, mess: { ...sub.prefs.mess, slug: null } })}.`
          : 'Add your courses in the Timetable maker to get reminders before them.',
      tag: 'test',
      url: '/tools/timetable',
    };
  }

  private async sample(sub: PushSubscriptionRecord): Promise<PushMessage> {
    const { date } = campusClock(this.clock.now());
    const mess = sub.prefs.mess.slug ? await this.messes.find(sub.prefs.mess.slug) : null;
    const meal = mess?.meals.find(
      (m) => sub.prefs.mess.meals.includes(m.key) && dishesOn(mess, date, m.key).length,
    );
    if (mess && meal)
      return {
        title: `Test · ${MEAL_NAMES[meal.key]} ${formatSpan(meal.start, meal.end)}`,
        body: `${dishesOn(mess, date, meal.key)
          .map((d) => d.name)
          .join(', ')
          .slice(0, 150)} · ${mess.name}`,
        tag: 'test',
        url: `/tools/mess-menu?mess=${encodeURIComponent(mess.slug)}`,
      };
    return {
      title: 'Meal reminders are on ✓',
      body: mess
        ? `This is how they'll look: ${mess.name}, before each meal you picked.`
        : 'Pick your mess in the Mess menu to get meal reminders.',
      tag: 'test',
      url: mess ? `/tools/mess-menu?mess=${encodeURIComponent(mess.slug)}` : '/tools/mess-menu',
    };
  }

  async devices(userId: string): Promise<PushDeviceDto[]> {
    return (await this.push.listForUser(userId)).map((s) => ({
      id: s.id,
      label: s.label || 'A device',
      createdAt: s.createdAt.toISOString(),
      summary: prefsSummary(s.prefs),
    }));
  }

  async removeDevice(userId: string, id: string) {
    const mine = await this.push.listForUser(userId);
    if (!mine.some((s) => s.id === id)) throw fail.notFound('That device');
    await this.push.removeIds([id]);
  }

  /** Sends whatever is due now. Called by the five-minute cron (and Admin › Reminders › Run now). */
  async run(): Promise<PushRunDto> {
    const out: PushRunDto = { checked: 0, sent: 0, gone: 0, failed: 0, deferred: 0 };
    if (!this.configured) return out;
    const now = this.clock.now();
    const { date, minutes } = campusClock(now);
    const subs = await this.push.listAll();
    out.checked = subs.length;
    if (!subs.length) return out;
    const [messes, sent] = await Promise.all([this.messes.list(), this.push.sentSince(date)]);
    const bySlug = new Map(messes.map((m) => [m.slug, m]));
    const done = new Map<string, Set<string>>();
    for (const s of sent) {
      if (!done.has(s.subscriptionId)) done.set(s.subscriptionId, new Set());
      done.get(s.subscriptionId)!.add(s.key);
    }

    const jobs: { sub: PushSubscriptionRecord; due: DuePush }[] = [];
    for (const sub of subs) {
      const mess = sub.prefs.mess.slug ? (bySlug.get(sub.prefs.mess.slug) ?? null) : null;
      for (const due of duePushes(sub.prefs, mess, now, done.get(sub.id))) jobs.push({ sub, due });
    }
    // The soonest events first; the rest wait for the next run (still before the event starts).
    const now5 = jobs.slice(0, this.perRun);
    out.deferred = jobs.length - now5.length;

    const delivered: { subscriptionId: string; key: string; day: string }[] = [];
    const gone = new Set<string>();
    for (let i = 0; i < now5.length; i += 10) {
      const results = await Promise.all(
        now5.slice(i, i + 10).map(async ({ sub, due }) => {
          if (gone.has(sub.id)) return 'gone' as const;
          const result = await this.sender
            .send(
              sub,
              { title: due.title, body: due.body, tag: due.tag, url: due.url, actions: ACTIONS[due.tag] },
              TTL[due.tag],
            )
            .catch(() => 'failed' as const);
          if (result === 'ok') delivered.push({ subscriptionId: sub.id, key: due.key, day: date });
          if (result === 'gone') gone.add(sub.id);
          return result;
        }),
      );
      for (const r of results) {
        if (r === 'ok') out.sent++;
        else if (r === 'failed') out.failed++;
      }
    }
    out.gone = gone.size;
    await Promise.all([
      delivered.length ? this.push.recordSent(delivered) : null,
      gone.size ? this.push.removeIds([...gone]) : null,
      // Once a day, just after midnight on campus: forget sends from before yesterday.
      minutes < 5
        ? this.push.pruneSent(new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10))
        : null,
    ]);
    return out;
  }

  async adminStats(): Promise<AdminPushStatsDto> {
    const { date } = campusClock(this.clock.now());
    const [subs, messes, sent] = await Promise.all([
      this.push.listAll(),
      this.messes.list(),
      this.push.sentSince(date),
    ]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    const counts = new Map<string, number>();
    for (const s of subs)
      if (s.prefs.mess.slug) counts.set(s.prefs.mess.slug, (counts.get(s.prefs.mess.slug) ?? 0) + 1);
    return {
      configured: this.configured,
      devices: subs.length,
      withMeals: subs.filter(
        (s) => s.prefs.mess.slug && (s.prefs.mess.meals.length || s.prefs.mess.favourites.length),
      ).length,
      withClasses: subs.filter(
        (s) => s.prefs.classes.nightly || (s.prefs.classes.before && s.prefs.classes.courses.length),
      ).length,
      byMess: [...counts].map(([slug, devices]) => ({ slug, name: names.get(slug) ?? slug, devices })),
      sentToday: sent.length,
    };
  }
}
