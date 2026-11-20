import { ErrorCode, isCollegeEmail, isWellFormedEmail, normaliseEmail } from '@ss/contracts';
import type { SignInStrikes } from '../domain/ports';
import { sha256Hex } from '../infrastructure/crypto';
import type { AdminAccess } from './admin-access';
import type { AppConfig } from './config';
import { AppError, fail } from './errors';

/** Refused addresses allowed per network before it is blocked, and for how long. */
export const STRIKE_LIMIT = 5;
export const BLOCK_HOURS = 24;

/** Sign-in links one address may ask for in a day; a re-request or two is normal, more is not. */
export const ADDRESS_LINKS_PER_DAY = 5;
/** Sign-in links one network may ask for: a burst limit and a daily limit. Together they stop
 *  one person cycling many addresses to drain the day's emails. Left loose enough for a big
 *  campus NAT (a blocked network is always told to use Google, which needs no email). */
export const NETWORK_LINKS_PER_HOUR = 15;
export const NETWORK_LINKS_PER_DAY = 40;

/**
 * Says whether a sign-in link may be sent to an address: an exact college address, or an
 * address on the admin list (any domain, Gmail included). Every refusal counts against the
 * network it came from; too many in a day block that network for a day. The database's
 * sign-up hook enforces the same rule again, so this can't be skipped by calling Supabase.
 */
export class SignInGuard {
  constructor(
    private readonly strikes: SignInStrikes,
    private readonly admins: Pick<AdminAccess, 'isAdmin'>,
    private readonly config: AppConfig,
  ) {}

  async check(rawEmail: string, ipHash: string): Promise<{ ok: true; admin: boolean }> {
    const blockedUntil = await this.strikes.blockedUntil(ipHash);
    if (blockedUntil) throw blocked(blockedUntil);
    const email = normaliseEmail(rawEmail);
    const admin = isWellFormedEmail(email) ? await this.admins.isAdmin(email) : false;
    if (isWellFormedEmail(email) && isCollegeEmail(email, this.config.allowedDomain))
      await this.budgetLink(email, ipHash);
    else if (admin) await this.budgetLink(email, ipHash);
    else {
      const until = await this.strikes.strike(ipHash, STRIKE_LIMIT, BLOCK_HOURS);
      if (until) throw blocked(until);
      throw fail.notCollege();
    }
    return { ok: true, admin };
  }

  /**
   * A link is about to be sent, so it is spent against the day's mail. Four budgets, cheapest
   * target first, all sharing the strike store: one address (a few re-requests a day), one
   * network per hour and per day (the anti-drain brake — the same person with many addresses),
   * and the whole site per day (what the mail provider actually allows). Nothing here can keep
   * a student out: the answer is always "Continue with Google, which needs no email".
   */
  private async budgetLink(email: string, ipHash: string): Promise<void> {
    if (!this.config.signinLinkBudgets) return; // the demo server: no email is ever sent
    const addressKey = (await sha256Hex(`mailto|${email}`)).slice(0, 32);
    const budgets: [key: string, limit: number, hours: number, message: string][] = [
      [
        `links:addr:${addressKey}`,
        ADDRESS_LINKS_PER_DAY,
        24,
        'This email address has already asked for several sign-in links today. Please use Continue with Google on the sign-in page, or try again tomorrow',
      ],
      [
        `links:net-hour:${ipHash}`,
        NETWORK_LINKS_PER_HOUR,
        1,
        'Too many sign-in links have been sent from this network this hour. Please use Continue with Google — it needs no email',
      ],
      [
        `links:net-day:${ipHash}`,
        NETWORK_LINKS_PER_DAY,
        24,
        'Too many sign-in links have been sent from this network today. Please use Continue with Google — it needs no email',
      ],
      [
        'links:site-day',
        this.config.signinEmailDailyLimit,
        24,
        'The site has sent all the sign-in emails it can today. Please use Continue with Google — it needs no email',
      ],
    ];
    for (const [key, limit, hours, message] of budgets) {
      // The strike store blocks when a count reaches its limit, so pass one more than the
      // intended allowance: `limit` sends go out, send `limit + 1` is refused.
      const until = await this.strikes.strike(key, limit + 1, hours);
      if (until) throw spent(until, message);
    }
  }
}

function atIst(until: Date): string {
  return until.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function blocked(until: Date) {
  return new AppError(
    ErrorCode.RateLimited,
    `Too many sign-in attempts with addresses that can't sign in. This network can try again after ${atIst(until)}.`,
  );
}

/** A mail budget ran out; the way in without mail is always offered in the same breath. */
function spent(until: Date, message: string) {
  return new AppError(ErrorCode.RateLimited, `${message} (links are available again after ${atIst(until)}.)`);
}
