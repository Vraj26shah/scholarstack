import type { Clock, EmailQuota, Mailer, TokenSigner } from '../../domain/ports';
import type { AppConfig } from '../config';
import { renderAnnouncement } from '../email-template';

const UNSUBSCRIBE_TTL = 60 * 60 * 24 * 365;

export interface StudentEmail {
  subject: string;
  heading: string;
  /** Paragraphs; empty ones are dropped. */
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  kicker: string;
  reason: string;
}

/**
 * One email to one student, in the house template, within the daily email limit.
 * Best effort by design: callers never fail because an email couldn't go out.
 */
export class StudentMailer {
  constructor(
    private readonly mailer: Mailer,
    private readonly quota: EmailQuota,
    private readonly unsubscribeSigner: TokenSigner,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  async send(
    to: { userId: string; email: string; name: string | null },
    mail: StudentEmail,
  ): Promise<boolean> {
    try {
      if (this.mailer.provider === 'none' || !to.email) return false;
      const day = this.clock.now().toISOString().slice(0, 10);
      if ((await this.quota.usedOn(day)) >= this.config.emailDailyLimit) return false;
      const token = await this.unsubscribeSigner.sign({ u: to.userId, k: 'unsub' }, UNSUBSCRIBE_TTL);
      const message = renderAnnouncement(
        {
          subject: mail.subject,
          heading: mail.heading,
          body: mail.paragraphs.filter(Boolean).join('\n\n'),
          ctaLabel: mail.ctaLabel,
          ctaUrl: mail.ctaUrl,
        },
        {
          appUrl: this.config.appUrl,
          name: to.name,
          unsubscribeUrl: `${this.config.appUrl}/unsubscribe?t=${encodeURIComponent(token)}`,
          kicker: mail.kicker,
          reason: mail.reason,
        },
      );
      await this.mailer.sendBatch([{ to: { email: to.email, name: to.name ?? undefined }, ...message }]);
      await this.quota.add(day, 1);
      return true;
    } catch {
      return false;
    }
  }
}
