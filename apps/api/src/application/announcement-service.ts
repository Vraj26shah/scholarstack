import type { AnnouncementDto, EmailStatusDto, FeatureDto } from '@ss/contracts';
import type { Announcement, Feature } from '../domain/entities';
import type {
  AnnouncementRepository,
  Clock,
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

const toDto = (a: Announcement): AnnouncementDto => ({
  id: a.id,
  subject: a.subject,
  heading: a.heading,
  body: a.body,
  ctaLabel: a.ctaLabel,
  ctaUrl: a.ctaUrl,
  featureKey: a.featureKey,
  status: a.status,
  recipients: a.recipients,
  sent: a.sent,
  error: a.error,
  createdAt: a.createdAt.toISOString(),
  sentAt: a.sentAt?.toISOString() ?? null,
});

export const featurePath = (key: string) => `/tools/${key}`;

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
  ) {}

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
    await this.features.save({ ...feature, status: 'live' });
    const draft = await this.announcements.create({
      subject: `New on Scholars Stack: ${feature.title}`,
      heading: `${feature.title} is here.`,
      body: `${feature.blurb}\n\nIt's free, and it works without signing in.`,
      ctaLabel: `Open the ${feature.title.toLowerCase()}`,
      ctaUrl: featurePath(feature.key),
      featureKey: feature.key,
    });
    return toDto(draft);
  }

  // ── Announcements ──

  async list(): Promise<AnnouncementDto[]> {
    return (await this.announcements.list())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toDto);
  }

  async save(
    input: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'> & {
      id?: string;
    },
  ): Promise<AnnouncementDto> {
    if (input.featureKey && !(await this.features.find(input.featureKey)))
      throw fail.badRequest('Unknown tool.');
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
    if (a.status === 'sent') throw fail.badRequest('This announcement was already sent.');
    if (a.status === 'draft') {
      await this.announcements.update(id, {
        status: 'sending',
        recipients: await this.recipients.count(),
        error: null,
      });
    } else {
      await this.announcements.update(id, { status: 'sending', error: null });
    }
    await this.processOne(id);
    return toDto(await this.mustFind(id));
  }

  /** Cron: continue every announcement that is still going out. */
  async processPending(): Promise<number> {
    let sent = 0;
    for (const a of await this.announcements.listSending()) sent += await this.processOne(a.id);
    return sent;
  }

  async status(): Promise<EmailStatusDto> {
    return {
      provider: this.mailer.provider,
      dailyLimit: this.config.emailDailyLimit,
      usedToday: await this.quota.usedOn(this.day()),
      optedIn: await this.recipients.count(),
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
      const left = this.config.emailDailyLimit - (await this.quota.usedOn(this.day()));
      const take = Math.min(BATCH, Math.max(left, 0));
      const batch = await this.recipients.after(a.cursorId, Math.max(take, 1));
      if (batch.length === 0) {
        await this.announcements.update(id, { status: 'sent', sentAt: this.clock.now() });
        break;
      }
      if (take === 0) break; // daily cap reached; the hourly cron resumes tomorrow
      try {
        const messages = await Promise.all(
          batch.map(async (r) => {
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
      await this.quota.add(this.day(), batch.length);
      await this.announcements.update(id, {
        sent: a.sent + batch.length,
        cursorId: batch[batch.length - 1]!.id,
      });
      total += batch.length;
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
