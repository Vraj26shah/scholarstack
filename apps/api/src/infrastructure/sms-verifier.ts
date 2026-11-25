import type { SmsVerifier } from '../domain/campus-ports';

/**
 * 2Factor.in (an Indian SMS service): it makes the code, sends it over its own registered (DLT)
 * route, and checks it. `template` is the optional name of an approved OTP template.
 * Send: GET /API/V1/{key}/SMS/{number}/AUTOGEN[/{template}] → { Status, Details: sessionId }
 * Check: GET /API/V1/{key}/SMS/VERIFY/{sessionId}/{code} → { Status: 'Success' } on a match.
 */
export class TwoFactorSms implements SmsVerifier {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly template = '',
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private url(path: string) {
    return `https://2factor.in/API/V1/${encodeURIComponent(this.apiKey)}/SMS/${path}`;
  }

  async start(phone: string) {
    const tail = this.template ? `/${encodeURIComponent(this.template)}` : '';
    const res = await this.fetcher(this.url(`91${phone}/AUTOGEN${tail}`));
    const body = (await res.json().catch(() => null)) as { Status?: string; Details?: string } | null;
    if (!res.ok || body?.Status !== 'Success' || !body.Details)
      throw new Error(`2Factor send failed: ${res.status} ${body?.Details ?? ''}`.trim());
    return body.Details;
  }

  async check(_phone: string, ref: string, code: string) {
    if (!ref) return false;
    const res = await this.fetcher(this.url(`VERIFY/${encodeURIComponent(ref)}/${encodeURIComponent(code)}`));
    const body = (await res.json().catch(() => null)) as { Status?: string; Details?: string } | null;
    return res.ok && body?.Status === 'Success' && /match/i.test(body.Details ?? '');
  }
}

/**
 * Twilio Verify: works worldwide (pricier per SMS in India). The service makes, sends and checks
 * the code; the handle is the verification's sid.
 */
export class TwilioVerifySms implements SmsVerifier {
  readonly configured = true;
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly serviceSid: string,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private post(path: string, form: Record<string, string>) {
    return this.fetcher(`https://verify.twilio.com/v2/Services/${this.serviceSid}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
  }

  async start(phone: string) {
    const res = await this.post('Verifications', { To: `+91${phone}`, Channel: 'sms' });
    const body = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
    if (!res.ok || !body?.sid) throw new Error(`Twilio send failed: ${res.status} ${body?.message ?? ''}`);
    return body.sid;
  }

  async check(phone: string, _ref: string, code: string) {
    const res = await this.post('VerificationCheck', { To: `+91${phone}`, Code: code });
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return res.ok && body?.status === 'approved';
  }
}

/** No SMS service set up: codes can't be sent (ordering falls back to the old tick box). */
export class NoSms implements SmsVerifier {
  readonly configured = false;
  async start(): Promise<string> {
    throw new Error('No SMS service is set up.');
  }
  async check() {
    return false;
  }
}

/** The demo site and tests: nothing is sent, and the code is always DEMO_OTP_CODE. */
export const DEMO_OTP_CODE = '123456';
export class DemoSms implements SmsVerifier {
  readonly configured = true;
  readonly sent: string[] = [];
  async start(phone: string) {
    this.sent.push(phone);
    return `demo-${phone}`;
  }
  async check(phone: string, ref: string, code: string) {
    return ref === `demo-${phone}` && code === DEMO_OTP_CODE;
  }
}
