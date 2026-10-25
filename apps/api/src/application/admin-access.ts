import { type AdminListDto, isListedEmail } from '@ss/contracts';
import type { AdminDirectory } from '../domain/ports';

const TTL_MS = 60_000;
const RETRY_MS = 10_000;

/**
 * Who is an admin. The list lives in the database (synced from GitHub's ADMIN_EMAILS by the
 * "Update admins" workflow), so a change reaches the live site within a minute, with no
 * redeploy. The Worker's own ADMIN_EMAILS secret is only a fallback for when the database list
 * is empty or can't be read, so you can never lock yourself out.
 */
export class AdminAccess {
  private cache: { at: number; ttl: number; emails: string[]; readFrom: AdminListDto['readFrom'] } | null =
    null;

  constructor(
    private readonly directory: AdminDirectory,
    private readonly fallback: readonly string[],
    private readonly now: () => number = Date.now,
  ) {}

  private async load() {
    if (this.cache && this.now() - this.cache.at < this.cache.ttl) return this.cache;
    try {
      const rows = await this.directory.list();
      const emails = rows.map((r) => r.email.toLowerCase());
      this.cache = emails.length
        ? { at: this.now(), ttl: TTL_MS, emails, readFrom: 'database' }
        : { at: this.now(), ttl: TTL_MS, emails: [...this.fallback], readFrom: 'worker-secret' };
    } catch {
      this.cache = { at: this.now(), ttl: RETRY_MS, emails: [...this.fallback], readFrom: 'worker-secret' };
    }
    return this.cache;
  }

  async isAdmin(email: string): Promise<boolean> {
    return isListedEmail(email, (await this.load()).emails);
  }

  async list(): Promise<AdminListDto> {
    const { readFrom } = await this.load();
    if (readFrom === 'worker-secret')
      return {
        readFrom,
        admins: this.fallback.map((email) => ({
          email,
          source: 'github' as const,
          addedAt: new Date(0).toISOString(),
        })),
      };
    const rows = await this.directory.list();
    return {
      readFrom,
      admins: rows.map((r) => ({ email: r.email, source: r.source, addedAt: r.addedAt.toISOString() })),
    };
  }

  /** After a sync, use the new list right away on this instance. */
  forget() {
    this.cache = null;
  }
}
