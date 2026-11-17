import { afterEach, describe, expect, it } from 'vitest';
import { type ErrorContext, setErrorReporter } from '../src/application/error-reporter';
import { Browser, setup } from './harness';

/** What the Worker's Sentry hook would receive. */
function capture() {
  const seen: { error: unknown; context: ErrorContext }[] = [];
  setErrorReporter((error, context) => seen.push({ error, context }));
  return seen;
}

describe('server errors reach Sentry', () => {
  afterEach(() => setErrorReporter(() => {}));

  it('an unexpected 500 is reported with where it happened and its request id', async () => {
    const seen = capture();
    const { env, app } = setup();
    env.container.promoCodes.list = async () => {
      throw new Error('database went away');
    };
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const r = await admin.call('GET', '/admin/promo-codes');
    expect(r.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect((seen[0]!.error as Error).message).toBe('database went away');
    expect(seen[0]!.context.where).toBe('GET /api/admin/promo-codes');
    expect(seen[0]!.context.requestId).toBe(r.json.error.requestId);
  });

  it('Razorpay refusing an order is reported, though the student only sees "nothing was charged"', async () => {
    const seen = capture();
    const { env, app } = setup();
    env.gateway.createOrder = async () => {
      throw new Error('Razorpay order failed: 401');
    };
    const s = new Browser(app);
    await s.signIn('buyer@vitbhopal.ac.in');
    const course = [...env.db.courses.values()].find((c) => c.status === 'live')!;
    expect((await s.call('POST', '/orders', { courseId: course.id })).status).toBe(503);
    expect(seen.map((x) => x.context.where)).toEqual(['checkout: Razorpay order']);
  });

  it('expected answers (signed out, not found, bad input) are not reported', async () => {
    const seen = capture();
    const { app } = setup();
    const visitor = new Browser(app);
    await visitor.call('GET', '/me');
    await visitor.call('GET', '/courses/no-such-course');
    await visitor.call('POST', '/promo/check', { nonsense: true });
    expect(seen).toHaveLength(0);
  });

  it('a broken reporter never turns one error into two', async () => {
    setErrorReporter(() => {
      throw new Error('sentry is down');
    });
    const { env, app } = setup();
    env.container.promoCodes.list = async () => {
      throw new Error('database went away');
    };
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const r = await admin.call('GET', '/admin/promo-codes');
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('INTERNAL');
  });
});
