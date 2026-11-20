import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, networkKey, throttle } from '../helpers';

/** Checks an address before the sign-in link is sent (see SignInGuard). */
export const authRoutes = new Hono<AppEnv>();

const Body = z.object({ email: z.string().trim().min(3).max(200) });

authRoutes.post('/auth/check-email', async (c) => {
  const key = await networkKey(c);
  await throttle(c, 'signin-check', key);
  const { email } = Body.parse(await c.req.json());
  await c.get('container').signInGuard.check(email, key);
  // Only ever "yes, a link may be sent": never which addresses are special, so nobody can
  // probe the site for privileged inboxes.
  return c.json({ ok: true });
});
