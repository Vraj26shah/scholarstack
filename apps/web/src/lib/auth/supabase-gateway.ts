import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';
import type { AuthGateway } from './gateway';

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
          'Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
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

  async startEmail(email: string, captchaToken?: string) {
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
      if (code.includes('captcha') || message.includes('captcha'))
        throw new Error(
          'Security check failed. Check that this site is allowed in the Turnstile widget and that its secret is configured in Supabase Auth.',
        );
      if (code.includes('rate') || message.includes('rate limit'))
        throw new Error('Sign-in email limit reached. Wait a few minutes and try again.');
      if (code.includes('email_address_not_authorized') || message.includes('only authorized'))
        throw new Error(
          'Supabase is using its test email service, which only sends to authorized team addresses. Configure custom SMTP in Supabase Auth.',
        );
      if (message.includes('redirect') && (message.includes('allow') || message.includes('url')))
        throw new Error(
          'Supabase rejected the callback URL. Add this site’s /auth/callback URL to Auth → URL Configuration.',
        );
      if (message.includes('vitbhopal')) throw new Error(error.message);
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
  }

  async startGoogle() {
    const { error } = await (await this.client).auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: env.domain, prompt: 'select_account' },
      },
    });
    if (error) throw new Error('Google sign-in could not start. Try the email code instead.');
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
