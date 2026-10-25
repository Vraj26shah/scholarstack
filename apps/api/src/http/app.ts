import { type ApiErrorBody, ErrorCode } from '@ss/contracts';
import { Hono } from 'hono';
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

/** Builds the HTTP app. The factory decides which adapters are behind the use cases. */
export function createApp(factory: ContainerFactory) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.set('container', factory(c.env));
    await next();
    c.header('x-request-id', requestId);
    c.header('x-content-type-options', 'nosniff');
    c.header('x-frame-options', 'DENY');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
  });

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
