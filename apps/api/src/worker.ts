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

  /** Hourly: keeps the free Supabase project awake and continues announcement emails. */
  async scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const container = workerContainer(env);
    await container.catalogue.index();
    ctx.waitUntil(
      container.announcements.processPending().then((sent) => {
        if (sent > 0) console.log(JSON.stringify({ level: 'info', event: 'announcements.cron', sent }));
      }),
    );
  },

} satisfies ExportedHandler<WorkerEnv>;
