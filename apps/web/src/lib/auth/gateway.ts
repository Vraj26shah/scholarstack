/** How the app signs people in. Two implementations: Supabase (real) and Demo. */
export interface AuthGateway {
  readonly supportsGoogle: boolean;
  /** Current access token, refreshed if needed. */
  token(): Promise<string | null>;
  email(): Promise<string | null>;
  startEmail(email: string, captchaToken?: string, admin?: boolean): Promise<void>;
  startGoogle(admin?: boolean): Promise<void>;
  /** Called on /auth/callback after Supabase redirects back. */
  completeRedirect(): Promise<boolean>;
  signOut(): Promise<void>;
  /** Fires when the session appears or disappears (e.g. token refresh fails). */
  subscribe(listener: (signedIn: boolean) => void): () => void;
}
