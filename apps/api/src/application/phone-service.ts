import { PHONE_OTP, type PhoneStatusDto, campusClock, normaliseMobile } from '@ss/contracts';
import type { PhoneRecord, PhoneRepository, SmsVerifier } from '../domain/campus-ports';
import type { Clock, ProfileRepository } from '../domain/ports';
import { fail } from './errors';

const blank = (userId: string): PhoneRecord => ({
  userId,
  phone: '',
  verifiedAt: null,
  pendingPhone: '',
  pendingRef: '',
  pendingAt: null,
  attempts: 0,
  sendsDay: '',
  sends: 0,
});

/**
 * A student's mobile number, checked once with a code sent by SMS. Restaurants call that number
 * about orders, so a made-up one wastes a kitchen's food: once checked, it is kept on the account,
 * can't be changed from the order form, and every order carries it.
 */
export class PhoneService {
  constructor(
    private readonly repo: PhoneRepository,
    private readonly sms: SmsVerifier,
    private readonly clock: Clock,
    private readonly profiles?: Pick<ProfileRepository, 'findByEmails'>,
    /** The site's WhatsApp Business number (country code + number, digits only), or '' when off. */
    private readonly whatsappNumber = '',
    private readonly makeCode: () => string = () =>
      String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0'),
  ) {}

  /** Free checks through WhatsApp are set up. */
  get whatsapp() {
    return /^\d{11,15}$/.test(this.whatsappNumber);
  }

  /** Codes can be sent (an SMS service is set up). Without one, ordering falls back to a tick box. */
  get available() {
    return this.sms.configured || this.whatsapp;
  }

  async status(userId: string): Promise<PhoneStatusDto> {
    const r = await this.repo.find(userId);
    const now = this.clock.now().getTime();
    const age = r?.pendingAt ? (now - r.pendingAt.getTime()) / 1000 : Number.POSITIVE_INFINITY;
    const wa =
      r && !r.phone && r.pendingRef.startsWith('wa:') && age < PHONE_OTP.ttlSeconds
        ? r.pendingRef.slice(3)
        : null;
    return {
      available: this.available,
      phone: r?.phone || null,
      whatsapp: this.whatsapp
        ? {
            waiting: wa
              ? {
                  code: wa,
                  link: `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(`VERIFY ${wa}`)}`,
                  expiresInSeconds: Math.max(0, Math.floor(PHONE_OTP.ttlSeconds - age)),
                }
              : null,
          }
        : null,
      pending:
        r && !r.phone && r.pendingPhone && !r.pendingRef.startsWith('wa:') && age < PHONE_OTP.ttlSeconds
          ? {
              phone: r.pendingPhone,
              resendInSeconds: Math.max(0, Math.ceil(PHONE_OTP.resendSeconds - age)),
              expiresInSeconds: Math.max(0, Math.floor(PHONE_OTP.ttlSeconds - age)),
            }
          : null,
    };
  }

  /** The account's checked number, or null. */
  async verified(userId: string): Promise<string | null> {
    return (await this.repo.find(userId))?.phone || null;
  }

  /** Sends a code to this number. */
  async start(userId: string, raw: string): Promise<PhoneStatusDto> {
    if (!this.available) throw fail.badRequest("Phone checks aren't set up yet. Try again later.");
    const phone = normaliseMobile(raw);
    if (!phone) throw fail.badRequest('Use a 10-digit Indian mobile number.');
    const r = (await this.repo.find(userId)) ?? blank(userId);
    if (r.phone) throw fail.badRequest('Your number is already checked.');
    const now = this.clock.now();
    const day = campusClock(now).date;
    const sends = r.sendsDay === day ? r.sends : 0;
    if (r.pendingAt && now.getTime() - r.pendingAt.getTime() < PHONE_OTP.resendSeconds * 1000)
      throw fail.badRequest('A code is on its way. Wait a few seconds before asking for another.');
    if (sends >= PHONE_OTP.perDay)
      throw fail.badRequest("That's the most codes for today. Try again tomorrow.");
    if ((await this.repo.sendsTo(phone, day)) >= PHONE_OTP.perDay)
      throw fail.badRequest('That number has had too many codes today. Try again tomorrow.');

    let ref: string;
    try {
      ref = await this.sms.start(phone);
    } catch {
      throw fail.badRequest("Couldn't send the SMS. Check the number and try again in a minute.");
    }
    await this.repo.save({
      ...r,
      pendingPhone: phone,
      pendingRef: ref,
      pendingAt: now,
      attempts: 0,
      sendsDay: day,
      sends: sends + 1,
    });
    return this.status(userId);
  }

  /**
   * Free check through WhatsApp: a one-time code for this account. The student sends
   * "VERIFY <code>" from their WhatsApp; the number it comes from is the one kept.
   */
  async startWhatsApp(userId: string): Promise<PhoneStatusDto> {
    if (!this.whatsapp) throw fail.badRequest("WhatsApp checks aren't set up yet. Try again later.");
    const r = (await this.repo.find(userId)) ?? blank(userId);
    if (r.phone) throw fail.badRequest('Your number is already checked.');
    const now = this.clock.now();
    const day = campusClock(now).date;
    const sends = r.sendsDay === day ? r.sends : 0;
    // A code still running is shown again, not replaced (the student may be switching apps).
    if (
      r.pendingRef.startsWith('wa:') &&
      r.pendingAt &&
      now.getTime() - r.pendingAt.getTime() < PHONE_OTP.ttlSeconds * 1000 - 60_000
    )
      return this.status(userId);
    if (sends >= PHONE_OTP.perDay * 2)
      throw fail.badRequest("That's the most tries for today. Try again tomorrow.");
    let code = this.makeCode();
    for (let i = 0; i < 5 && (await this.repo.findByRef(`wa:${code}`)); i++) code = this.makeCode();
    await this.repo.save({
      ...r,
      pendingPhone: '',
      pendingRef: `wa:${code}`,
      pendingAt: now,
      attempts: 0,
      sendsDay: day,
      sends: sends + 1,
    });
    return this.status(userId);
  }

  /**
   * A message reached the site's WhatsApp number. "VERIFY 123456" from a sender whose code is still
   * running keeps the sender's number on that account. Anything else is ignored (never answered).
   */
  async receiveWhatsApp(from: string, body: string): Promise<boolean> {
    const code = /\bVERIFY\s*(\d{6})\b/i.exec(body)?.[1];
    const phone = normaliseMobile(from);
    if (!code || !phone) return false;
    const r = await this.repo.findByRef(`wa:${code}`);
    if (!r || r.phone || !r.pendingAt) return false;
    if (this.clock.now().getTime() - r.pendingAt.getTime() > PHONE_OTP.ttlSeconds * 1000) return false;
    await this.repo.save({
      ...r,
      phone,
      verifiedAt: this.clock.now(),
      pendingPhone: '',
      pendingRef: '',
      pendingAt: null,
      attempts: 0,
    });
    return true;
  }

  /** Checks the code; on a match the number is kept on the account for good. */
  async check(userId: string, raw: string, code: string): Promise<PhoneStatusDto> {
    const phone = normaliseMobile(raw);
    const r = await this.repo.find(userId);
    if (r?.phone) return this.status(userId);
    if (!r || !phone || !r.pendingAt || r.pendingPhone !== phone)
      throw fail.badRequest('Send a code to this number first.');
    if (this.clock.now().getTime() - r.pendingAt.getTime() > PHONE_OTP.ttlSeconds * 1000)
      throw fail.badRequest('That code has expired. Send a new one.');
    if (r.attempts >= PHONE_OTP.attempts) throw fail.badRequest('Too many wrong tries. Send a new code.');
    // Counted before asking, so guesses fired at once can't get past the limit.
    await this.repo.save({ ...r, attempts: r.attempts + 1 });
    const ok = await this.sms.check(phone, r.pendingRef, code.trim()).catch(() => false);
    if (!ok) {
      const left = PHONE_OTP.attempts - r.attempts - 1;
      throw fail.badRequest(
        left > 0
          ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'Too many wrong tries. Send a new code.',
      );
    }
    await this.repo.save({
      ...r,
      phone,
      verifiedAt: this.clock.now(),
      pendingPhone: '',
      pendingRef: '',
      pendingAt: null,
      attempts: 0,
    });
    return this.status(userId);
  }

  /** Admin: forget a student's number (they changed SIMs), so they can check a new one. */
  async resetByEmail(email: string): Promise<{ found: boolean; phone: string | null }> {
    const [account] = (await this.profiles?.findByEmails([email.trim().toLowerCase()])) ?? [];
    if (!account) return { found: false, phone: null };
    const r = await this.repo.find(account.id);
    if (r)
      await this.repo.save({
        ...r,
        phone: '',
        verifiedAt: null,
        pendingPhone: '',
        pendingRef: '',
        pendingAt: null,
        attempts: 0,
      });
    return { found: true, phone: r?.phone || null };
  }
}
