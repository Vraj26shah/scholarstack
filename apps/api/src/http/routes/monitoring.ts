import { Hono } from 'hono';
import { type AppEnv, networkKey } from '../helpers';
import { MAX_ENVELOPE_BYTES, envelopeHeaderLine, tunnelTarget } from '../monitoring-tunnel';

export const monitoringRoutes = new Hono<AppEnv>();

/**
 * The site's Sentry tunnel (see monitoring-tunnel.ts). No sign-in: visitors who aren't signed in
 * report errors and page speed too. It never reads cookies or tokens, and a refusal is a plain
 * status the SDK understands (it backs off on 429).
 */
monitoringRoutes.post('/monitoring', async (c) => {
  const container = c.get('container');
  if (!(await container.limiter.allow(`monitoring:${await networkKey(c)}`)))
    return c.body(null, 429, { 'Retry-After': '60' });
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > MAX_ENVELOPE_BYTES) return c.body(null, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ENVELOPE_BYTES) return c.body(null, 413);

  const target = tunnelTarget(envelopeHeaderLine(bytes), container.config.sentryDsn);
  if (!target.ok) return c.json({ error: target.reason }, 400);

  try {
    const ip = c.req.header('cf-connecting-ip');
    const res = await fetch(target.target.url, {
      method: 'POST',
      // The bytes exactly as the browser sent them (replays are compressed binary).
      body: bytes,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        // Sentry's own per-visitor rate limits and location work from the visitor's address.
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
      },
    });
    // Pass Sentry's answer back (including its rate-limit headers), without the body.
    const headers: Record<string, string> = {};
    for (const h of ['retry-after', 'x-sentry-rate-limits'])
      if (res.headers.get(h)) headers[h] = res.headers.get(h)!;
    return c.body(null, res.status as 200, headers);
  } catch (error) {
    console.error('[monitoring] Sentry unreachable:', error instanceof Error ? error.message : error);
    return c.body(null, 502);
  }
});
