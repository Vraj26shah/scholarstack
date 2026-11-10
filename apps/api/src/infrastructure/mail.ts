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

  async check() {
    try {
      const res = await this.doFetch('https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1', {
        headers: { accept: 'application/json', 'api-key': this.apiKey },
      });
      const problem = brevoProblem(res.status, await res.text());
      return problem
        ? { ok: false, message: problem }
        : { ok: true, message: `Brevo accepts the key; emails go out from ${this.from.email}.` };
    } catch (e) {
      return { ok: false, message: `Brevo could not be reached: ${(e as Error).message.slice(0, 120)}` };
    }
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
      if (!res.ok) {
        const body = await res.text();
        throw new Error(brevoProblem(res.status, body) ?? `Brevo ${res.status}: ${body.slice(0, 200)}`);
      }
    }
  }
}

/** What Brevo's answer to a harmless read means, in plain words. */
export function brevoProblem(status: number, body: string): string | null {
  if (status >= 200 && status < 300) return null;
  if (/unrecognised IP|unrecognized IP|authorised_ips|authorized_ips/i.test(body))
    return 'Brevo is blocking the website because its address keeps changing (Cloudflare and Supabase send from many addresses). In Brevo: Settings → Security → Authorized IPs → "Deactivate for API" and "Deactivate for SMTP". Until then no email goes out.';
  if (status === 401)
    return 'Brevo refused the key. Make a new API key in Brevo (SMTP & API → API keys) and set BREVO_API_KEY.';
  // A restricted key may not read statistics; that's fine for sending.
  if (status === 403 && /permission_denied|not authorized for resource/i.test(body)) return null;
  return `Brevo answered ${status}: ${body.slice(0, 160)}`;
}

/** Used when no email provider is configured: sending is refused with a clear message. */
export class NoMailer implements Mailer {
  readonly provider = 'none' as const;
  async sendBatch(): Promise<void> {
    throw new Error('Email is not set up. Add BREVO_API_KEY.');
  }
  async check() {
    return {
      ok: false,
      message: 'Email is not set up: add BREVO_API_KEY (and EMAIL_FROM) to the Worker secrets.',
    };
  }
}
