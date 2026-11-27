import { createClient } from '@supabase/supabase-js';
import type { SessionMinter } from '../domain/campus-ports';
import type { DemoAuth } from './auth';

/**
 * A real Supabase session for an owner who just proved their PIN. The server makes a magic-link
 * token for the account (never emailed) and redeems it at once, so the owner gets exactly the
 * session an emailed link would give: same tokens, same refresh, same device checks. The account
 * is created first if it doesn't exist yet (confirmed, since the admin checked the number).
 */
export class SupabaseSessionMinter implements SessionMinter {
  constructor(
    private readonly url: string,
    private readonly secretKey: string,
  ) {}

  /** A fresh client per sign-in, so no session ever lingers in a shared one. */
  private client() {
    return createClient(this.url, this.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async mint(email: string) {
    const admin = this.client();
    let link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) {
      // No account yet: make one (no password, already confirmed), then try again.
      const created = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (created.error && !/already/i.test(created.error.message)) throw new Error(created.error.message);
      link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (link.error) throw new Error(link.error.message);
    }
    const tokenHash = link.data.properties?.hashed_token;
    if (!tokenHash) throw new Error('Supabase gave no sign-in token.');
    const { data, error } = await this.client().auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (error || !data.session) throw new Error(error?.message ?? 'Supabase made no session.');
    return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  }
}

/** Demo: the same HS256 tokens the demo sign-in issues; one stable account id per address. */
export class DemoSessionMinter implements SessionMinter {
  private readonly ids = new Map<string, string>();
  constructor(
    private readonly auth: DemoAuth,
    private readonly newId: () => string,
  ) {}
  async mint(email: string) {
    let id = this.ids.get(email);
    if (!id) {
      id = this.newId();
      this.ids.set(email, id);
    }
    return { accessToken: await this.auth.issue(id, email, this.newId()), refreshToken: null };
  }
}
