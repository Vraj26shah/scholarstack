import * as Sentry from '@sentry/cloudflare';
import { reportServerError, setErrorReporter } from './application/error-reporter';
import type { WorkerEnv } from './composition/config';
import { workerContainer } from './composition/worker';
import type { PushJob } from './domain/campus-ports';
import { createApp } from './http/app';
import { withEdgeCache } from './http/edge-cache';
import { SECURITY_HEADERS } from './http/security-headers';
import {
  type SharedKind,
  bundleMeta,
  courseMeta,
  isShareBot,
  messMeta,
  sharedApiPath,
  sharedItem,
  sharedPagePath,
  withShareMeta,
} from './http/share-preview';

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

/** index.html with a course's (or bundle's) title and description in its preview tags. */
async function sharePage(
  request: Request,
  url: URL,
  item: { kind: SharedKind; slug: string },
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const api = new URL(sharedApiPath(item), url);
  const [shell, data] = await Promise.all([
    env.ASSETS!.fetch(new Request(new URL('/', url), request)),
    app.fetch(new Request(api, { headers: { accept: 'application/json' } }), env, ctx),
  ]);
  if (!shell.ok || !data.ok) return null;
  const pageUrl = `${url.origin}${sharedPagePath(item)}`;
  const json = await data.json();
  const meta =
    item.kind === 'course'
      ? courseMeta(json as Parameters<typeof courseMeta>[0], pageUrl)
      : item.kind === 'bundle'
        ? bundleMeta(json as Parameters<typeof bundleMeta>[0], pageUrl)
        : messMeta(json as Parameters<typeof messMeta>[0], pageUrl);
  const out = new Response(withShareMeta(await shell.text(), meta), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const handler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/'))
      return withEdgeCache(request, ctx, () => Promise.resolve(app.fetch(request, env, ctx)));
    // A course or bundle link opened by a link-preview crawler (LinkedIn, WhatsApp, X…): the page
    // with that course's own title and description. Any trouble: the plain page, as for people.
    const item = sharedItem(url.pathname);
    if (item && isShareBot(request.headers.get('user-agent'))) {
      const shared = await sharePage(request, url, item, env, ctx).catch(() => null);
      if (shared) return shared;
    }
    // Everything else is the static website (single-page app). Course and bundle paths reach
    // here first (for the crawlers above), so a miss falls back to the app shell itself.
    let res = await env.ASSETS!.fetch(request);
    if (res.status === 404 && item) res = await env.ASSETS!.fetch(new Request(new URL('/', url), request));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },

  /**
   * Reminder batches handed over by the five-minute run. Each batch is a run of its own, so it has
   * its own request budget. deliver() never throws and every message is acked: a retried batch
   * would send the same reminders twice (failed ones are retried by the next five-minute run).
   */
  async queue(batch: MessageBatch<unknown>, env: WorkerEnv): Promise<void> {
    const container = workerContainer(env);
    for (const m of batch.messages) {
      const r = await container.reminders
        .deliver(Array.isArray(m.body) ? (m.body as PushJob[]) : [])
        .catch((error: Error) => {
          reportServerError(error, { where: 'queue reminders' });
          return null;
        });
      if (r && r.sent + r.failed + r.gone > 0)
        console.log(JSON.stringify({ level: 'info', event: 'reminders.batch', ...r }));
      m.ack();
    }
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
      // Drawer packs follow their drawers (a course going live or leaving, a new price list). Once
      // an hour, at :45, in this run rather than the :17 one: a run may make only so many database
      // calls, and the hourly jobs together used them up after a handful of packs.
      if (new Date(_event.scheduledTime).getUTCMinutes() === 45)
        job('drawer-packs', () =>
          container.packs.sync().then((r) => {
            if (r && r.totals.create + r.totals.update + r.totals.retire > 0)
              console.log(JSON.stringify({ level: 'info', event: 'packs.cron', ...r.totals }));
          }),
        );
      // Restaurant orders nobody answered: a second alert at 3 minutes, cancelled at 10.
      job('order-timers', () =>
        container.orders.sweepAll().then((n) => {
          if (n > 0) console.log(JSON.stringify({ level: 'info', event: 'orders.timers', changed: n }));
        }),
      );
      // Reminders (meals, classes) due in the next few minutes go out on every run.
      job('reminders', () =>
        container.reminders.run().then((r) => {
          if (r.sent + r.gone + r.failed + r.deferred > 0)
            console.log(JSON.stringify({ level: 'info', event: 'reminders.cron', ...r }));
        }),
      );
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
