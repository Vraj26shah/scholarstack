/** Public, build-time settings. Only VITE_* values ever reach the browser. */
const e = import.meta.env;

export const env = {
  mode: (e.VITE_APP_MODE ?? (e.MODE === 'demo' ? 'demo' : 'live')) as 'live' | 'demo',
  appName: (e.VITE_APP_NAME as string) || 'Scholars Stack',
  apiBase: (e.VITE_API_BASE_URL as string) || '/api',
  domain: (e.VITE_ALLOWED_EMAIL_DOMAIN as string) || 'vitbhopal.ac.in',
  supabaseUrl: (e.VITE_SUPABASE_URL as string) || '',
  supabaseKey: (e.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '',
  razorpayKeyId: (e.VITE_RAZORPAY_KEY_ID as string) || '',
  turnstileSiteKey: (e.VITE_TURNSTILE_SITE_KEY as string) || '',
  /** GA4 measurement id (G-…). Empty: no analytics is loaded at all. */
  gaId: (e.VITE_GA_ID as string) || '',
  sentryDsn: (e.VITE_SENTRY_DSN as string) || '',
};

export const isDemo = env.mode === 'demo';
