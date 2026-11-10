import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';
import type { AuthGateway } from './gateway';

/** True when the current page is part of the admin area. */
function isAdminContext(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location?.pathname.startsWith('/admin') || window.location?.search.includes('admin=1'))
  );
}

/**
 * Real sign-in: Supabase Auth with Google (college accounts) or an email sign-in link.
 * The SDK is loaded on first use, so the catalogue renders without waiting for it.
 */
export class SupabaseAuthGateway implements AuthGateway {
  readonly supportsGoogle = true;
  private loading: Promise<SupabaseClient> | null = null;
  private completingRedirect: Promise<boolean> | null = null;

  private sdk(): Promise<SupabaseClient> {
    if (!this.loading) {
      if (!env.supabaseUrl || !env.supabaseKey)
        throw new Error(
          isAdminContext()
            ? 'Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
            : 'Sign-in is temporarily unavailable. Please try again later or contact support.',
        );
      this.loading = import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(env.supabaseUrl, env.supabaseKey, {
          // We exchange the ?code= ourselves on /auth/callback, so don't let the SDK do it too.
          auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        }),
      );
    }
    return this.loading;
  }

  private get client(): Promise<SupabaseClient> {
    return this.sdk();
  }

  private get configured() {
    return !!env.supabaseUrl && !!env.supabaseKey;
  }

  async token() {
    if (!this.configured) return null;
    const { data } = await (await this.client).auth.getSession();
    return data.session?.access_token ?? null;
  }

  async email() {
    if (!this.configured) return null;
    const { data } = await (await this.client).auth.getSession();
    return data.session?.user.email ?? null;
  }

  async startEmail(email: string, captchaToken?: string, adminOverride?: boolean) {
    const { error } = await (await this.client).auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        captchaToken,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
      const message = error.message.toLowerCase();
      const admin = adminOverride ?? isAdminContext();
      if (code.includes('captcha') || message.includes('captcha'))
        throw new Error(
          admin
            ? 'Security check failed. Check that this site is allowed in the Turnstile widget and that its secret is configured in Supabase Auth.'
            : 'The security check could not be completed. Please refresh the page and try again, or use "Continue with Google" instead.',
        );
      if (code.includes('rate') || message.includes('rate limit'))
        throw new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
      if (code.includes('email_address_not_authorized') || message.includes('only authorized'))
        throw new Error(
          admin
            ? 'Supabase is using its test email service, which only sends to authorized team addresses. Configure custom SMTP in Supabase Auth.'
            : 'We could not send the sign-in email right now. Please try again later or use "Continue with Google" instead.',
        );
      if (message.includes('redirect') && (message.includes('allow') || message.includes('url')))
        throw new Error(
          admin
            ? "Supabase rejected the callback URL. Add this site's /auth/callback URL to Auth → URL Configuration."
            : 'Sign-in is temporarily misconfigured. Please try again later or contact support.',
        );
      if (message.includes('vitbhopal')) throw new Error(error.message);
      // Admin gets the full diagnostic; students get a calm, actionable message.
      if (admin) {
        const status = 'status' in error && typeof error.status === 'number' ? `HTTP ${error.status}` : '';
        const detail = error.message
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/\b(password|secret|token|authorization)\b\s*[:=]\s*\S+/gi, '$1=[redacted]')
          .replace(/https?:\/\/\S+/gi, '[URL]')
          .slice(0, 200);
        throw new Error(
          `Could not send the sign-in link (${code || status || 'email delivery error'}): ${detail || 'Check Supabase Auth email/SMTP settings and logs.'}`,
        );
      }
      throw new Error(
        'We couldn\'t send your sign-in link. Please try again in a moment, or use "Continue with Google" instead.',
      );
    }
  }

  async startGoogle(admin = false) {
    // No hosted-domain lock: an admin may sign in with a Gmail. Students still need their college
    // account; any other address is refused by the sign-up check unless it is on the admin list.
    void admin;
    const queryParams: Record<string, string> = { prompt: 'select_account' };
    const { error } = await (await this.client).auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams,
      },
    });
    if (error)
      throw new Error(
        'Google sign-in could not start. Please try again or use the email sign-in link instead.',
      );
  }

  completeRedirect() {
    this.completingRedirect ??= (async () => {
      const callbackUrl = new URL(window.location.href);
      const code = callbackUrl.searchParams.get('code');
      if (code) {
        const { error } = await (await this.client).auth.exchangeCodeForSession(code);
        // A callback can be refreshed after Supabase has already consumed its code.
        // If this browser still has a valid saved session, resume that session instead.
        if (error && !(await this.token())) return false;
        callbackUrl.searchParams.delete('code');
        callbackUrl.searchParams.delete('error');
        callbackUrl.searchParams.delete('error_description');
        window.history.replaceState(
          window.history.state,
          '',
          `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`,
        );
      }
      return (await this.token()) !== null;
    })().finally(() => {
      this.completingRedirect = null;
    });
    return this.completingRedirect;
  }

  async signOut() {
    if (!this.configured) return;
    await (await this.client).auth.signOut({ scope: 'local' });
  }

  subscribe(listener: (signedIn: boolean) => void) {
    let stop = () => {};
    if (!this.configured) return stop;
    void this.client.then((c) => {
      const { data } = c.auth.onAuthStateChange((_event, session) => listener(!!session));
      stop = () => data.subscription.unsubscribe();
    });
    return () => stop();
  }
}
