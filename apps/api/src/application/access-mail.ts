import type { Course, EndedAccess } from '../domain/entities';
import type {
  Clock,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  Mailer,
  TokenSigner,
} from '../domain/ports';
import type { AppConfig } from './config';
import { renderAnnouncement } from './email-template';

const UNSUBSCRIBE_TTL = 60 * 60 * 24 * 365;
/** Ended-access emails per hourly run, at most (the daily limit applies too). */
const ENDED_PER_RUN = 200;

const day = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/**
 * Emails about a student's own access: "a course was added to your shelf" (when an admin gives
 * one) and "your access has ended" (sent once, by the hourly job, grouped per student). They are
 * about the student's purchases, so they go even to students who turned off news emails.
 */
export class AccessMailService {
  constructor(
    private readonly entitlements: EntitlementRepository,
    private readonly mailer: Mailer,
    private readonly quota: EmailQuota,
    private readonly unsubscribeSigner: TokenSigner,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly features?: FeatureRepository,
  ) {}

  private today() {
    return this.clock.now().toISOString().slice(0, 10);
  }
  private async left() {
    return Math.max(0, this.config.emailDailyLimit - (await this.quota.usedOn(this.today())));
  }
  private async unsubscribeUrl(userId: string) {
    const token = await this.unsubscribeSigner.sign({ u: userId, k: 'unsub' }, UNSUBSCRIBE_TTL);
    return `${this.config.appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
  }
  private async toolNames(): Promise<string[]> {
    try {
      return (await this.features?.list())?.filter((f) => f.status === 'live').map((f) => f.title) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Tell students a course was added to their shelf by the library. Best effort: a mail problem
   * never undoes the grant. Returns the addresses that were emailed.
   */
  async courseGiven(
    students: { id: string; email: string; fullName: string | null }[],
    course: Pick<Course, 'id' | 'title' | 'slug'>,
    until: Date | null,
  ): Promise<string[]> {
    if (this.mailer.provider === 'none' || students.length === 0) return [];
    const room = await this.left();
    const take = students.slice(0, room);
    if (take.length === 0) return [];
    try {
      const messages = await Promise.all(
        take.map(async (s) => ({
          to: { email: s.email, name: s.fullName ?? undefined },
          ...renderAnnouncement(
            {
              subject: `${course.title} is on your shelf`,
              heading: `${course.title} is on your shelf`,
              body: [
                'The Scholars Stack library has added this course to your shelf, free of charge.',
                [
                  '- Every unit, ready to read',
                  '- On your phone and laptop (up to 2 devices)',
                  until ? `- Yours until ${day(until)}` : '- No end date',
                ].join('\n'),
                'Open it any time from My shelf. Happy studying!',
              ].join('\n\n'),
              ctaLabel: 'Start reading',
              ctaUrl: `/c/${course.slug}`,
            },
            {
              appUrl: this.config.appUrl,
              name: s.fullName,
              unsubscribeUrl: await this.unsubscribeUrl(s.id),
              kicker: 'ADDED TO YOUR SHELF',
              reason: 'You are getting this because a course was added to your Scholars Stack account.',
            },
          ),
        })),
      );
      await this.mailer.sendBatch(messages);
      await this.quota.add(this.today(), messages.length);
      return take.map((s) => s.email);
    } catch (e) {
      console.error(
        JSON.stringify({ level: 'warn', event: 'mail.course_given', error: (e as Error).message }),
      );
      return [];
    }
  }

  /**
   * Hourly: email each student whose access has ended (once per ended access), with one email
   * per student listing every course that ended, how to get it back, and what's new.
   */
  async notifyEnded(): Promise<number> {
    if (this.mailer.provider === 'none') return 0;
    const room = await this.left();
    if (room === 0) return 0;
    const ended = await this.entitlements.listEndedUnnotified(ENDED_PER_RUN);
    const byStudent = new Map<string, EndedAccess[]>();
    for (const e of ended) byStudent.set(e.userId, [...(byStudent.get(e.userId) ?? []), e]);
    const students = [...byStudent.values()].slice(0, room);
    if (students.length === 0) return 0;
    const tools = await this.toolNames();
    const messages = await Promise.all(
      students.map(async (items) => {
        const s = items[0]!;
        const one = items.length === 1;
        const latest = items.reduce((d, i) => (i.expiresAt > d ? i.expiresAt : d), items[0]!.expiresAt);
        return {
          to: { email: s.email, name: s.fullName ?? undefined },
          ...renderAnnouncement(
            {
              subject: one
                ? `Your access to ${s.courseTitle} has ended`
                : `Your access to ${items.length} courses has ended`,
              heading: `Thanks for studying with us${firstName(s.fullName) ? `, ${firstName(s.fullName)}` : ''}`,
              body: [
                `Your access to ${one ? 'this course' : 'these courses'} ended on ${day(latest)}:`,
                items.map((i) => `- ${i.courseTitle}`).join('\n'),
                'Your reading progress is saved. Buy a course again any time and you will pick up exactly where you left off.',
                'A new term means a new shelf: notes for your next courses are being filed now, with bundles that cost less than the courses one by one.',
                tools.length
                  ? `And our free tools work without signing in: ${tools.join(', ')}.`
                  : 'Our free student tools are on the home page too, no sign-in needed.',
              ].join('\n\n'),
              ctaLabel: 'See what is new',
              ctaUrl: '/#catalogue',
            },
            {
              appUrl: this.config.appUrl,
              name: s.fullName,
              unsubscribeUrl: await this.unsubscribeUrl(s.userId),
              kicker: 'ACCESS ENDED',
              reason:
                'You are getting this because a course on your Scholars Stack shelf reached the end of its term.',
            },
          ),
        };
      }),
    );
    try {
      await this.mailer.sendBatch(messages);
    } catch (e) {
      console.error(
        JSON.stringify({ level: 'warn', event: 'mail.access_ended', error: (e as Error).message }),
      );
      return 0;
    }
    await this.quota.add(this.today(), messages.length);
    await this.entitlements.markEndNotified(
      students.flat().map((i) => ({ userId: i.userId, courseId: i.courseId })),
    );
    return messages.length;
  }
}
