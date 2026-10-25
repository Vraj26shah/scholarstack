import type { WorkerEnv } from './composition/config';
import { workerContainer } from './composition/worker';
import { createApp } from './http/app';
import { SECURITY_HEADERS } from './http/security-headers';

const app = createApp((env) => workerContainer(env as WorkerEnv));

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
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
          return container.problems.fromServer(error, 'CRON', `/${name}`).catch(() => {});
        }),
      );
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
  },
} satisfies ExportedHandler<WorkerEnv>;
