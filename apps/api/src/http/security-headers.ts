/**
 * Security headers for the website. Static files are served by Cloudflare straight from
 * apps/web/dist (the Worker only runs for /api/*), so the same list is also written to
 * apps/web/public/_headers; a test keeps the two in sync.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://*.challenges.cloudflare.com data: https://lumberjack.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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

/** The Cloudflare `_headers` file for the static site assets. */
export function headersFile(): string {
  return `/*\n${Object.entries(SECURITY_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
}
