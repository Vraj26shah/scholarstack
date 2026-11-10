import { type ApiErrorBody, ErrorCode } from '@ss/contracts';
import { Hono } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { AppError } from '../application/errors';
import type { Container } from './container';
import type { AppEnv } from './helpers';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { catalogueRoutes } from './routes/catalogue';
import { checkoutRoutes } from './routes/checkout';
import { contributionRoutes } from './routes/contributions';
import { demoRoutes } from './routes/demo';
import { meRoutes } from './routes/me';
import { readerRoutes } from './routes/reader';
import { supportRoutes } from './routes/support';

export type { AppEnv } from './helpers';

export type ContainerFactory = (env: unknown) => Container;

const JSON_LIMIT = 512 * 1024;
/** Only JSON bodies are capped here; multipart uploads are checked by their own routes. */
const bodyLimit = (opts: Parameters<typeof honoBodyLimit>[0]) => {
  const limit = honoBodyLimit(opts);
  return async (c: Parameters<typeof limit>[0], next: () => Promise<void>) => {
    if (!(c.req.header('content-type') ?? '').includes('application/json')) return next();
    return limit(c, next);
  };
};

const SOFT = new Set<string>([
  ErrorCode.Unauthenticated,
  ErrorCode.SessionReplaced,
  ErrorCode.DeviceUnclaimed,
  ErrorCode.DeviceLimit,
  ErrorCode.DeviceCooldown,
  ErrorCode.NotPurchased,
  ErrorCode.AlreadyOwned,
  ErrorCode.LeaseTaken,
  ErrorCode.NotFound,
]);

/** Builds the HTTP app. The factory decides which adapters are behind the use cases. */
export function createApp(factory: ContainerFactory) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.set('container', factory(c.env));
    await next();
    // An admin change (anything but a read) shows on the public pages straight away.
    const path = new URL(c.req.url).pathname;
    if (c.req.method !== 'GET' && c.res.status < 400 && path.startsWith('/api/admin')) {
      c.get('container').catalogue.forget();
      c.get('container').storageIndex?.forget();
    }
    // A finished (or failed) conversion changes which page tiles exist. Progress pings and claims
    // ("/internal/conversion-progress", "-claim") arrive every few seconds while pages are made and
    // change nothing in storage, so they must not throw the listing away.
    if (c.req.method === 'POST' && path === '/api/internal/conversion')
      c.get('container').storageIndex?.forgetPages();
    c.header('x-request-id', requestId);
    c.header('x-content-type-options', 'nosniff');
    c.header('x-frame-options', 'DENY');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
  });

  // JSON bodies are small (forms, ids, settings). Capping them stops an oversized payload from
  // tying up the Worker while it is parsed and validated; file uploads (multipart) have their
  // own limits in their routes.
  app.use(
    '*',
    bodyLimit({
      maxSize: JSON_LIMIT,
      onError: (c) =>
        c.json(
          {
            error: {
              code: ErrorCode.BadRequest,
              message: 'That request was too large.',
              requestId: c.get('requestId') ?? 'unknown',
            },
          },
          413,
        ),
    }),
  );

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    let status = 500;
    let body: ApiErrorBody = {
      error: { code: ErrorCode.Internal, message: 'Something went wrong on our side.', requestId },
    };
    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, requestId } };
      if (err.details !== undefined) (body.error as Record<string, unknown>).details = err.details;
    } else if (err instanceof ZodError || err instanceof SyntaxError) {
      status = 400;
      body = { error: { code: ErrorCode.BadRequest, message: 'That request was not valid.', requestId } };
    } else {
      console.error(JSON.stringify({ level: 'error', requestId, message: err.message, stack: err.stack }));
      // Unexpected server errors go to the admin's Problems log too (never to the student).
      try {
        void c
          .get('container')
          ?.problems.fromServer(err, c.req.method, new URL(c.req.url).pathname)
          .catch(() => {});
      } catch {
        // the log must never cause a second error
      }
    }
    // The site's own pages ask for "soft" answers: session states that are part of normal use
    // (device not registered yet, two devices already, signed in elsewhere, signed out) come back
    // as 200 with the real status in a header, so a working site doesn't fill the browser console
    // with red lines. Anything else (and every other caller) gets the real HTTP status.
    if (status < 500 && c.req.header('x-ss-soft-errors') === '1' && SOFT.has(body.error.code)) {
      c.header('x-ss-status', String(status));
      return c.json(body, 200);
    }
    return c.json(body, status as 400);
  });

  app.notFound((c) =>
    c.json(
      { error: { code: ErrorCode.NotFound, message: 'No such endpoint.', requestId: c.get('requestId') } },
      404,
    ),
  );

  app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  app.route('/', catalogueRoutes);
  app.route('/', meRoutes);
  app.route('/', checkoutRoutes);
  app.route('/', contributionRoutes);
  app.route('/', supportRoutes);
  app.route('/', authRoutes);
  app.route('/', readerRoutes);
  app.route('/', adminRoutes);
  app.route('/', demoRoutes);

  return app;
}
