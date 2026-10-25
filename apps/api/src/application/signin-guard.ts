import { ErrorCode, isCollegeEmail, isWellFormedEmail, normaliseEmail } from '@ss/contracts';
import type { SignInStrikes } from '../domain/ports';
import type { AdminAccess } from './admin-access';
import type { AppConfig } from './config';
import { AppError, fail } from './errors';

/** Refused addresses allowed per network before it is blocked, and for how long. */
export const STRIKE_LIMIT = 5;
export const BLOCK_HOURS = 24;

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
    if (isWellFormedEmail(email) && isCollegeEmail(email, this.config.allowedDomain))
      return { ok: true, admin: await this.admins.isAdmin(email) };
    if (isWellFormedEmail(email) && (await this.admins.isAdmin(email))) return { ok: true, admin: true };
    const until = await this.strikes.strike(ipHash, STRIKE_LIMIT, BLOCK_HOURS);
    if (until) throw blocked(until);
    throw fail.notCollege();
  }
}

function blocked(until: Date) {
  const time = until.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
  return new AppError(
    ErrorCode.RateLimited,
    `Too many sign-in attempts with addresses that can't sign in. This network can try again after ${time}.`,
  );
}
