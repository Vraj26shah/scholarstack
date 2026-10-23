import type { Container } from '../http/container';
import { CloudflareRateLimiter, MemoryRateLimiter, R2ObjectStore } from '../infrastructure/cloudflare';
import { R2ManifestConversionQueue } from '../infrastructure/r2-conversion-queue';
import { type WorkerEnv, assertWorkerEnv } from './config';
import { supabaseContainer } from './supabase-container';

let cached: { env: WorkerEnv; container: Container } | null = null;

/** Production composition root: Supabase + R2 manifests polled by GitHub Actions. */
export function workerContainer(env: WorkerEnv): Container {
  if (cached?.env === env) return cached.container;
  assertWorkerEnv(env);
  const container = supabaseContainer(env, {
    store: new R2ObjectStore(env.NOTES),
    queue: new R2ManifestConversionQueue(
      env.NOTES,
      env.CONVERTER_CALLBACK_URL ?? `${(env.APP_URL ?? '').replace(/\/+$/, '')}/api/internal/conversion`,
    ),
    limiter: env.PAGE_LIMITER
      ? new CloudflareRateLimiter(env.PAGE_LIMITER)
      : new MemoryRateLimiter(Number(env.PAGES_PER_MINUTE ?? 40)),
  });
  cached = { env, container };
  return container;
}
