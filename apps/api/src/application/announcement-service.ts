import {
  type AnnouncementDto,
  type DeliveryDto,
  type EmailStatusDto,
  type FeatureDto,
  MAX_CLASS_NUDGES_PER_DAY,
  MAX_CLASS_REMINDERS_PER_DAY,
} from '@ss/contracts';
import type { Announcement, Feature } from '../domain/entities';
import type {
  AnnouncementRepository,
  CatalogueReader,
  Clock,
  CourseUpdateSource,
  DeliveryLog,
  EmailQuota,
  FeatureRepository,
  Mailer,
  ProfileRepository,
  RecipientSource,
  TokenSigner,
} from '../domain/ports';
import type { AppConfig } from './config';
import { renderAnnouncement } from './email-template';
import { fail } from './errors';

const BATCH = 50;
/** Batches per run, so one request or cron tick stays well inside Worker limits. */
const MAX_BATCHES_PER_RUN = 20;
const UNSUBSCRIBE_TTL = 400 * 24 * 3600;

const toDto = (
  a: Announcement,
  extra: { waiting: number; finishesOn: string | null; course: { id: string; title: string } | null } = {
    waiting: 0,
    finishesOn: null,
    course: null,
  },
): AnnouncementDto => ({
  ...extra,
  id: a.id,
  subject: a.subject,
  heading: a.heading,
  body: a.body,
  ctaLabel: a.ctaLabel,
  ctaUrl: a.ctaUrl,
  featureKey: a.featureKey,
  offerId: a.offerId ?? null,
  batchYears: a.batchYears ?? null,
  status: a.status,
  recipients: a.recipients,
  sent: a.sent,
  error: a.error,
  createdAt: a.createdAt.toISOString(),
  sentAt: a.sentAt?.toISOString() ?? null,
});

export const featurePath = (key: string) => `/tools/${key}`;

/**
 * Hand-written launch emails for tools that deserve more than the generic one. Launching the tool
 * drafts this text (and refreshes its one-line description on the home page); the admin still
 * reads, tests and sends it from Emails.
 */
const LAUNCH_COPY: Record<
  string,
  { blurb: string; subject: string; heading: string; body: string; ctaLabel: string; ctaUrl?: string }
> = {
  timetable: {
    blurb: 'Tap your slots, get a clash-free week, and a reminder before every class.',
    subject: 'You asked for it: class reminders are live',
    heading: 'Never walk into the wrong class (or miss one) again.',
    body: [
      'A lot of you told us the same thing: "I forget which class is next", "I only check the room when I\'m already late", "I missed a lab because I didn\'t look at my timetable." So we built what you asked for.',
      'The Timetable maker on Scholars Stack is now live, and it reminds you before every class.',
      `- Tomorrow's classes the night before, at the time you choose\n- A nudge 5, 10, 15 or 30 minutes before each class, with the course and room\n- Only for the days and subjects you pick\n- Never spammy: at most ${MAX_CLASS_REMINDERS_PER_DAY} a day (tomorrow's list + up to ${MAX_CLASS_NUDGES_PER_DAY} class nudges)\n- Works on your phone even when the site is closed\n- Free for every student, no app to install`,
      'Set it up in 2 minutes:',
      '- Sign in to Scholars Stack with your college email (reminders are for signed-in students)\n- Open the Timetable maker and tap your slots (A1, B2, TA1…), or type them\n- Tap "Class reminders" at the top and allow notifications\n- Tap "Send a test" to see one arrive on your phone',
      'On an iPhone? Open the site in Safari, tap Share › Add to Home Screen, open Scholars Stack from your home screen, and turn reminders on there.',
      'You can also download your timetable as a PDF, add it to your calendar, or share it with friends in your section.',
      'This is built from your suggestions, so keep them coming: just reply to this email and tell us what would help next.',
    ].join('\n\n'),
    ctaLabel: 'Set up my class reminders',
    ctaUrl: '/tools/timetable',
  },
};

const toFeatureDto = (f: Feature): FeatureDto => ({
  key: f.key,
  title: f.title,
  blurb: f.blurb,
  status: f.status,
  path: featurePath(f.key),
});

/**
 * The free toolbox and the emails that announce what's new.
 *
 * Sending is resumable: every announcement keeps a cursor (the last student mailed), so a
 * provider error or the daily cap just pauses it; the hourly cron picks it up again.
 * Only students who signed in and haven't opted out get mail, and every email carries a
 * personal one-click unsubscribe link.
 */
export class AnnouncementService {
  constructor(
    private readonly announcements: AnnouncementRepository,
    private readonly features: FeatureRepository,
    private readonly recipients: RecipientSource,
    private readonly profiles: ProfileRepository,
    private readonly mailer: Mailer,
    private readonly quota: EmailQuota,
    private readonly unsubscribeSigner: TokenSigner,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly deliveries: DeliveryLog,
    private readonly courses?: Pick<CatalogueReader, 'coursesByIds'>,
  ) {}

  /**
   * When notes are added to a live course, its students get one email listing them. It is an
   * ordinary announcement aimed at that course, so it shares the daily limit and its delivery
   * is tracked like any other. Returns how many courses were announced.
   */
  async announceCourseUpdates(source: CourseUpdateSource): Promise<number> {
    let made = 0;
    for (const u of await source.coursesWithNewFiles()) {
      const names = u.fileNames.slice(0, 12);
      const a = await this.announcements.create({
        subject: `New notes in ${u.title}`,
        heading: `${u.fileNames.length === 1 ? 'A new file is' : `${u.fileNames.length} new files are`} on your shelf`,
        body: [
          `We just added to ${u.title}, which you have:`,
          names.map((n) => `- ${n}`).join('\n'),
          u.fileNames.length > names.length ? `…and ${u.fileNames.length - names.length} more.` : '',
          'They are already in your course, no extra cost.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        ctaLabel: 'Open the course',
        ctaUrl: `/c/${u.slug}`,
        featureKey: null,
        courseId: u.courseId,
      });
      await source.markFilesNotified(u.courseId);
      const { waiting } = await this.deliveries.progress(a.id);
      if (waiting === 0) {
        await this.announcements.update(a.id, { status: 'sent', sentAt: this.clock.now() });
        continue;
      }
      await this.announcements.update(a.id, { status: 'sending', recipients: waiting });
      made++;
    }
    if (made) await this.processPending();
    return made;
  }

  // ── Toolbox ──

  async publicFeatures(): Promise<FeatureDto[]> {
    return (await this.features.list())
      .filter((f) => f.status !== 'hidden')
      .sort((a, b) => a.sort - b.sort)
      .map(toFeatureDto);
  }

  async allFeatures(): Promise<FeatureDto[]> {
    return (await this.features.list()).sort((a, b) => a.sort - b.sort).map(toFeatureDto);
  }

  /** Delete a tool from the home page and the admin list (its page in the site stays, unlisted). */
  async deleteFeature(key: string) {
    if (!(await this.features.find(key))) throw fail.notFound('That tool');
    await this.features.remove(key);
    return { ok: true as const };
  }

  /** Delete a draft, or a finished email with its delivery records. Not while it is going out. */
  async deleteAnnouncement(id: string) {
    const a = await this.mustFind(id);
    if (a.status === 'sending')
      throw fail.badRequest('This email is going out right now. Wait until it finishes, then delete it.');
    await this.announcements.remove(id);
    return { ok: true as const };
  }

  async saveFeature(key: string, patch: Pick<Feature, 'title' | 'blurb' | 'status'>): Promise<FeatureDto> {
    const current = await this.features.find(key);
    if (!current) throw fail.notFound('That tool');
    return toFeatureDto(await this.features.save({ ...current, ...patch }));
  }

  /** Adds a new tool to the toolbox (normally as "coming soon"), listed after the existing ones. */
  async createFeature(input: Pick<Feature, 'key' | 'title' | 'blurb' | 'status'>): Promise<FeatureDto> {
    if (await this.features.find(input.key)) throw fail.badRequest('A tool with that key already exists.');
    const all = await this.features.list();
    const sort = all.reduce((m, f) => Math.max(m, f.sort), 0) + 1;
    return toFeatureDto(await this.features.save({ ...input, sort }));
  }

  /** Marks a tool live and drafts its announcement for the admin to review and send. */
  async launchFeature(key: string): Promise<AnnouncementDto> {
    const feature = await this.features.find(key);
    if (!feature) throw fail.notFound('That tool');
    const copy = LAUNCH_COPY[key];
    await this.features.save({ ...feature, status: 'live', blurb: copy?.blurb ?? feature.blurb });
    const draft = await this.announcements.create(
      copy
        ? {
            subject: copy.subject,
            heading: copy.heading,
            body: copy.body,
            ctaLabel: copy.ctaLabel,
            ctaUrl: copy.ctaUrl ?? featurePath(feature.key),
            featureKey: feature.key,
          }
        : {
            subject: `New on Scholars Stack: ${feature.title}`,
            heading: `${feature.title} is here.`,
            body: `${feature.blurb}\n\nIt's free, and it works without signing in.`,
            ctaLabel: `Open the ${feature.title.toLowerCase()}`,
            ctaUrl: featurePath(feature.key),
            featureKey: feature.key,
          },
    );
    return toDto(draft);
  }

  // ── Announcements ──

  /**
   * The email about an offer, as a draft for the admin to read, test and send from Emails. An
   * unsent draft for the same offer is reused (and refreshed), so clicking twice never makes two.
   */
  async draftOfferInvite(input: {
    offerId: string;
    subject: string;
    heading: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    batchYears: number[] | null;
  }): Promise<AnnouncementDto> {
    const draft = (await this.announcements.list()).find(
      (a) => a.offerId === input.offerId && a.status === 'draft',
    );
    const { offerId, batchYears, ...text } = input;
    if (draft) {
      await this.announcements.update(draft.id, text);
      return (await this.list()).find((a) => a.id === draft.id)!;
    }
    const created = await this.announcements.create({ ...text, featureKey: null, offerId, batchYears });
    return (await this.list()).find((a) => a.id === created.id)!;
  }

  /** Emails about each offer, for the Offers screen. */
  async byOffer(): Promise<Map<string, AnnouncementDto[]>> {
    const out = new Map<string, AnnouncementDto[]>();
    for (const a of await this.list()) if (a.offerId) out.set(a.offerId, [...(out.get(a.offerId) ?? []), a]);
    return out;
  }

  async list(): Promise<AnnouncementDto[]> {
    const all = (await this.announcements.list()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const { finishes } = await this.schedule();
    const courseIds = [...new Set(all.map((a) => a.courseId).filter((x): x is string => !!x))];
    const titles = new Map(
      (courseIds.length && this.courses ? await this.courses.coursesByIds(courseIds) : []).map((c) => [
        c.id,
        c.title,
      ]),
    );
    return Promise.all(
      all.map(async (a) =>
        toDto(a, {
          waiting: a.status === 'draft' ? 0 : (await this.deliveries.progress(a.id)).waiting,
          finishesOn: finishes.get(a.id) ?? null,
          course: a.courseId ? { id: a.courseId, title: titles.get(a.courseId) ?? 'A course' } : null,
        }),
      ),
    );
  }

  /** Who has this announcement and who is still waiting, with the day the last of them gets it. */
  async delivery(id: string): Promise<DeliveryDto> {
    await this.mustFind(id);
    const [{ sent, waiting }, list, { finishes }, byBatch] = await Promise.all([
      this.deliveries.progress(id),
      this.deliveries.recipients(id, 5000),
      this.schedule(),
      this.deliveries.batches(id),
    ]);
    return {
      announcementId: id,
      sent,
      waiting,
      byBatch,
      finishesOn: finishes.get(id) ?? null,
      recipients: list.map((r) => ({
        email: r.email,
        name: r.fullName,
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * The days ahead: today's room for announcements, then the full allowance each following day,
   * shared by every announcement still going out, oldest first.
   */
  private async schedule() {
    const perDay = this.newsPerDay();
    let room = Math.max(0, perDay - (await this.quota.usedOn(this.day())));
    const sending = (await this.announcements.listSending()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const plan = new Map<string, number>();
    const finishes = new Map<string, string>();
    let dayIndex = 0;
    const dateOf = (i: number) =>
      new Date(this.clock.now().getTime() + i * 86_400_000).toISOString().slice(0, 10);
    for (const a of sending) {
      let left = (await this.deliveries.progress(a.id)).waiting;
      while (left > 0 && dayIndex < 400 && perDay > 0) {
        if (room === 0) {
          dayIndex++;
          room = perDay;
          continue;
        }
        const take = Math.min(left, room);
        plan.set(dateOf(dayIndex), (plan.get(dateOf(dayIndex)) ?? 0) + take);
        left -= take;
        room -= take;
        if (left === 0) finishes.set(a.id, dateOf(dayIndex));
      }
    }
    return { plan, finishes };
  }

  /** Announcements may use the daily limit minus what is kept back for personal emails. */
  private newsPerDay() {
    return Math.max(0, this.config.emailDailyLimit - this.reserved());
  }

  private reserved() {
    return Math.min(this.config.emailReserve, Math.floor(this.config.emailDailyLimit / 2));
  }

  async save(
    input: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'> & {
      id?: string;
      courseId?: string | null;
    },
  ): Promise<AnnouncementDto> {
    if (input.featureKey && !(await this.features.find(input.featureKey)))
      throw fail.badRequest('Unknown tool.');
    if (input.courseId && !(await this.courses?.coursesByIds([input.courseId]))?.length)
      throw fail.badRequest('Unknown course.');
    if (!input.id) return toDto(await this.announcements.create(input));
    const current = await this.announcements.find(input.id);
    if (!current) throw fail.notFound('That announcement');
    if (current.status !== 'draft') throw fail.badRequest('Only drafts can be edited.');
    const { id, ...patch } = input;
    return toDto(await this.announcements.update(id, patch));
  }

  /** Renders the email as a student would see it (for the admin preview pane). */
  async preview(id: string): Promise<{ subject: string; html: string }> {
    const a = await this.mustFind(id);
    const { subject, html } = renderAnnouncement(a, {
      appUrl: this.config.appUrl,
      name: 'Aarav Sharma',
      unsubscribeUrl: `${this.config.appUrl}/unsubscribe`,
    });
    return { subject, html };
  }

  /** One copy to the admin's own inbox. */
  async sendTest(id: string, to: string): Promise<void> {
    const a = await this.mustFind(id);
    await this.assertQuota(1);
    const msg = renderAnnouncement(a, {
      appUrl: this.config.appUrl,
      name: null,
      unsubscribeUrl: `${this.config.appUrl}/unsubscribe`,
    });
    await this.mailer.sendBatch([{ to: { email: to }, ...msg, subject: `[Test] ${msg.subject}` }]);
    await this.quota.add(this.day(), 1);
  }

  /** Starts (or resumes) sending to every opted-in student. */
  async send(id: string): Promise<AnnouncementDto> {
    if (this.mailer.provider === 'none')
      throw fail.badRequest('Email is not set up. Add BREVO_API_KEY first.');
    const a = await this.mustFind(id);
    const { sent, waiting } = await this.deliveries.progress(id);
    if (a.status === 'sent' && waiting === 0)
      throw fail.badRequest('Everyone who opted in already has this email.');
    // A sent email can go again to students who opted in after it went out: only they get it.
    await this.announcements.update(id, { status: 'sending', recipients: sent + waiting, error: null });
    await this.processOne(id);
    return (await this.list()).find((x) => x.id === id)!;
  }

  /** Cron: continue every announcement that is still going out. */
  async processPending(): Promise<number> {
    let sent = 0;
    for (const a of await this.announcements.listSending()) sent += await this.processOne(a.id);
    return sent;
  }

  async status(): Promise<EmailStatusDto> {
    const usedToday = await this.quota.usedOn(this.day());
    const { plan } = await this.schedule();
    return {
      provider: this.mailer.provider,
      dailyLimit: this.config.emailDailyLimit,
      usedToday,
      optedIn: await this.recipients.count(),
      reserved: this.reserved(),
      leftToday: Math.max(0, this.newsPerDay() - usedToday),
      plan: [...plan.entries()].map(([date, count]) => ({ date, count })).slice(0, 30),
    };
  }

  async unsubscribe(token: string): Promise<void> {
    const claims = await this.unsubscribeSigner.verify<{ u: string; k: string }>(token);
    if (!claims || claims.k !== 'unsub' || typeof claims.u !== 'string')
      throw fail.badRequest('That link is not valid.');
    await this.profiles.setEmailOptIn(claims.u, false);
  }

  unsubscribeToken(userId: string): Promise<string> {
    return this.unsubscribeSigner.sign({ u: userId, k: 'unsub' }, UNSUBSCRIBE_TTL);
  }

  private async processOne(id: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const a = await this.mustFind(id);
      if (a.status !== 'sending') break;
      const left = this.newsPerDay() - (await this.quota.usedOn(this.day()));
      const take = Math.min(BATCH, Math.max(left, 0));
      // Everyone opted in who hasn't had it yet: students who opt in mid-way are included.
      const batch = await this.deliveries.pending(id, Math.max(take, 1));
      if (batch.length === 0) {
        const p = await this.deliveries.progress(id);
        await this.announcements.update(id, {
          status: 'sent',
          sentAt: this.clock.now(),
          sent: p.sent,
          recipients: p.sent,
        });
        break;
      }
      if (take === 0) break; // today's allowance is used; the hourly job continues tomorrow
      const send = batch.slice(0, take);
      try {
        const messages = await Promise.all(
          send.map(async (r) => {
            const token = await this.unsubscribeToken(r.id);
            return {
              to: { email: r.email, name: r.fullName ?? undefined },
              ...renderAnnouncement(a, {
                appUrl: this.config.appUrl,
                name: r.fullName,
                unsubscribeUrl: `${this.config.appUrl}/unsubscribe?t=${encodeURIComponent(token)}`,
              }),
            };
          }),
        );
        await this.mailer.sendBatch(messages);
      } catch (e) {
        await this.announcements.update(id, { status: 'failed', error: (e as Error).message.slice(0, 300) });
        break;
      }
      await this.quota.add(this.day(), send.length);
      await this.deliveries.record(
        id,
        send.map((r) => r.id),
      );
      const p = await this.deliveries.progress(id);
      await this.announcements.update(id, { sent: p.sent, recipients: p.sent + p.waiting });
      total += send.length;
    }
    return total;
  }

  private async assertQuota(n: number) {
    if ((await this.quota.usedOn(this.day())) + n > this.config.emailDailyLimit) {
      throw fail.badRequest("Today's email limit is used up. Try again tomorrow.");
    }
  }

  private async mustFind(id: string) {
    const a = await this.announcements.find(id);
    if (!a) throw fail.notFound('That announcement');
    return a;
  }

  private day() {
    return this.clock.now().toISOString().slice(0, 10);
  }
}
