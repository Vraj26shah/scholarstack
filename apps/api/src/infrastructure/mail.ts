import type { OutgoingEmail } from '../domain/entities';
import type { Mailer } from '../domain/ports';

/**
 * Brevo transactional API. One request carries up to 1000 personalised versions
 * (each version here is one student with their own unsubscribe link).
 */
export class BrevoMailer implements Mailer {
  readonly provider = 'brevo' as const;
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly from: { email: string; name: string },
    fetcher: typeof fetch = fetch,
  ) {
    this.doFetch = (url, init) => fetcher(url, init);
  }

  async sendBatch(messages: OutgoingEmail[]): Promise<void> {
    for (let i = 0; i < messages.length; i += 500) {
      const chunk = messages.slice(i, i + 500);
      const first = chunk[0]!;
      const res = await this.doFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': this.apiKey },
        body: JSON.stringify({
          sender: this.from,
          subject: first.subject,
          htmlContent: first.html,
          textContent: first.text,
          tags: ['announcement'],
          messageVersions: chunk.map((m) => ({
            to: [{ email: m.to.email, ...(m.to.name ? { name: m.to.name } : {}) }],
            subject: m.subject,
            htmlContent: m.html,
            textContent: m.text,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

/** Used when no email provider is configured: sending is refused with a clear message. */
export class NoMailer implements Mailer {
  readonly provider = 'none' as const;
  async sendBatch(): Promise<void> {
    throw new Error('Email is not set up. Add BREVO_API_KEY.');
  }
}
