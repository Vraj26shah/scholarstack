import * as Sentry from '@sentry/cloudflare';
import { reportServerError, setErrorReporter } from './application/error-reporter';
import type { WorkerEnv } from './composition/config';
import { workerContainer } from './composition/worker';
import { createApp } from './http/app';
import { withEdgeCache } from './http/edge-cache';
import { SECURITY_HEADERS } from './http/security-headers';

const app = createApp((env) => workerContainer(env as WorkerEnv));

// Unexpected server errors (a 500, Razorpay refusing an order, a failed hourly job) go to Sentry
// with where they happened. Expected answers (signed out, not found, bad input) are not errors.
setErrorReporter((error, { where, requestId }) => {
  Sentry.withScope((scope) => {
    scope.setTag('where', where);
    if (requestId) scope.setTag('request_id', requestId);
    Sentry.captureException(error);
  });
});

const handler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/'))
      return withEdgeCache(request, ctx, () => Promise.resolve(app.fetch(request, env, ctx)));
    // Everything else is the static website (single-page app).
    const res = await env.ASSETS!.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },

  /** Hourly: keeps the free Supabase project awake, continues announcement emails and sends
   *  "your access has ended" emails. */
  async scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const container = workerContainer(env);
    // Each job runs on its own: one failing never stops the others, and failures land in the
    // admin's Problems log instead of disappearing.
    const job = (name: string, run: () => Promise<unknown>) =>
      ctx.waitUntil(
        run().catch((error: Error) => {
          console.error(JSON.stringify({ level: 'error', event: `cron.${name}`, message: error.message }));
          reportServerError(error, { where: `cron ${name}` });
          return container.problems.fromServer(error, 'CRON', `/${name}`).catch(() => {});
        }),
      );
    if (_event.cron === '*/5 * * * *') {
      job('conversion-wake', async () => {
        const queued = await container.conversionQueue.wakeIfQueued?.();
        if (queued) console.log(JSON.stringify({ level: 'info', event: 'conversion.wake.cron', queued }));
      });
      return;
    }
    // A real database read every hour keeps the free Supabase project from pausing.
    job('keep-alive', () => container.catalogue.index());
    job('announcements', () =>
      container.announcements.processPending().then((sent) => {
        if (sent > 0) console.log(JSON.stringify({ level: 'info', event: 'announcements.cron', sent }));
      }),
    );
    // Students whose access ended since the last run get one "your access has ended" email.
    job('access-ended', () =>
      container.accessMail.notifyEnded().then((sent) => {
        if (sent > 0) console.log(JSON.stringify({ level: 'info', event: 'access_ended.cron', sent }));
      }),
    );
    // Notes added to a live course: its students get one email listing them (tracked like any email).
    job('course-updates', () =>
      container.announcements.announceCourseUpdates(container.courseUpdates).then((n) => {
        if (n > 0) console.log(JSON.stringify({ level: 'info', event: 'course_updates.cron', courses: n }));
      }),
    );
    job('signin-strikes', () => container.signInStrikes.prune());
    // Drawer packs follow their drawers: a course going live (or leaving) updates its packs.
    job('drawer-packs', () =>
      container.packs.sync().then((r) => {
        if (r && r.totals.create + r.totals.update + r.totals.retire > 0)
          console.log(JSON.stringify({ level: 'info', event: 'packs.cron', ...r.totals }));
      }),
    );
    // Once a day (the 03:00 UTC run): trim history past its keep period so the database stays small.
    if (new Date(_event.scheduledTime).getUTCHours() === 3)
      job('housekeeping', () =>
        container.housekeeping.pruneHistory().then((n) => {
          console.log(JSON.stringify({ level: 'info', event: 'housekeeping.cron', ...n }));
        }),
      );
  },
} satisfies ExportedHandler<WorkerEnv>;

/**
 * Sentry for the Worker, in the same project as the site (tag `runtime:worker`). Off when
 * SENTRY_DSN isn't set. Errors only (no tracing, so the span quota stays with the site's RUM).
 * The release is SENTRY_RELEASE, which the deploy sets to the commit.
 */
export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.APP_ENV ?? 'production',
    initialScope: { tags: { runtime: 'worker' } },
    // Request headers can hold sign-in tokens and cookies; the URL and method are enough.
    beforeSend(event) {
      if (event.request) {
        const { headers: _h, cookies: _c, data: _d, ...safe } = event.request;
        event.request = safe;
      }
      return event;
    },
  }),
  handler,
);
