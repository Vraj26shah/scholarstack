import { isCollegeEmail } from '@ss/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { fail } from '../../application/errors';
import type { AppEnv } from '../helpers';

/**
 * Demo-only helpers that stand in for Supabase Auth and Razorpay Checkout.
 * They return 404 unless the API was composed in demo mode.
 */
export const demoRoutes = new Hono<AppEnv>();

const users = new Map<string, string>(); // email → stable demo user id

demoRoutes.post('/dev/login', async (c) => {
  const demo = c.get('container').demo;
  if (!demo) throw fail.notFound('That endpoint');
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const normalized = email.toLowerCase();
  if (!isCollegeEmail(normalized, c.get('container').config.allowedDomain)) throw fail.notCollege();
  let userId = users.get(normalized);
  if (!userId) {
    userId = demo.newId();
    users.set(normalized, userId);
  }
  const accessToken = await demo.auth.issue(userId, normalized, demo.newId());
  return c.json({ accessToken, email: normalized });
});

demoRoutes.post('/dev/pay', async (c) => {
  const demo = c.get('container').demo;
  if (!demo) throw fail.notFound('That endpoint');
  const { gatewayOrderId } = z.object({ gatewayOrderId: z.string().min(1) }).parse(await c.req.json());
  return c.json(await demo.gateway.simulatePayment(gatewayOrderId));
});

/** Demo: the emails the in-memory mailer "sent", newest first. */
demoRoutes.get('/dev/outbox', (c) => {
  const demo = c.get('container').demo;
  if (!demo) throw fail.notFound('That endpoint');
  return c.json(
    demo
      .outbox()
      .slice(-30)
      .reverse()
      .map((m) => ({ to: m.to.email, subject: m.subject, html: m.html })),
  );
});
