/**
 * Security headers for the website. Static files are served by Cloudflare straight from
 * apps/web/dist (the Worker only runs for /api/*), so the same list is also written to
 * apps/web/public/_headers; a test keeps the two in sync.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://cdn.razorpay.com",
    // Sentry Session Replay compresses recordings in a worker it starts from a blob: URL.
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://*.challenges.cloudflare.com data: https://lumberjack.razorpay.com https://api.razorpay.com https://*.google-analytics.com https://*.analytics.google.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
    "object-src 'none'",
  ].join('; '),
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};

/**
 * How long files without a content hash in their name are kept at the edge and in the browser:
 * served at once and refreshed in the background, instead of re-checked on every page load.
 * theme-init.js blocks the first paint, so it matters most. Bump ?v= in index.html to change
 * og-image.png at once.
 */
const STATIC_CACHE: [path: string, cacheControl: string][] = [
  ['/assets/*', 'public, max-age=31536000, immutable'],
  ['/theme-init.js', 'public, max-age=3600, stale-while-revalidate=86400'],
  ['/favicon.svg', 'public, max-age=86400, stale-while-revalidate=604800'],
  ['/apple-touch-icon.png', 'public, max-age=86400, stale-while-revalidate=604800'],
  ['/og-image.png', 'public, max-age=86400, stale-while-revalidate=604800'],
  ['/site.webmanifest', 'public, max-age=3600, stale-while-revalidate=86400'],
  ['/robots.txt', 'public, max-age=3600'],
  ['/sw.js', 'no-cache'],
  ['/version.json', 'no-store'],
];

/** The Cloudflare `_headers` file for the static site assets. */
export function headersFile(): string {
  const security = Object.entries(SECURITY_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  const caching = STATIC_CACHE.map(([path, value]) => `${path}\n  Cache-Control: ${value}`).join('\n\n');
  return `/*\n${security}\n\n${caching}\n`;
}
