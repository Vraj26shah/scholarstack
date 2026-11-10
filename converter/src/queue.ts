import { z } from 'zod';

/** One file to convert, as the site queues it. `attempts` counts runs that could not finish it. */
export const Job = z.object({
  fileId: z.string().min(1),
  sourceKey: z.string().min(1),
  queueId: z.string().uuid().optional(),
  queuePosition: z.number().int().min(1).optional(),
  queueTotal: z.number().int().min(1).optional(),
  attempts: z.number().int().min(0).optional(),
});
export const Jobs = z.array(Job);
export type QueueJob = z.infer<typeof Job>;

export interface QueueManifest {
  callbackUrl?: string;
  jobs: QueueJob[];
  legacyArray: boolean;
}

export interface QueueStore {
  listQueueManifests(): Promise<string[]>;
  readQueueManifest(key: string): Promise<QueueManifest>;
  saveQueueManifest(key: string, manifest: QueueManifest): Promise<void>;
  deleteQueueManifest(key: string): Promise<void>;
}

/** A job is tried this many times (one try per run) before it is dropped from the queue. */
export const MAX_ATTEMPTS = 3;

export interface DrainResult {
  manifestsFound: number;
  processed: number;
  /** Converted, or reported to the site as failed (e.g. a broken or deleted file). */
  reported: number;
  conversionsFailed: number;
  /** Superseded, paused, or deleted jobs discarded before conversion. */
  obsolete: number;
  /** Jobs that hit an error this run and stay queued for the next one. */
  retryLater: number;
  /** Jobs dropped after MAX_ATTEMPTS runs; the admin can queue them again from the site. */
  givenUp: number;
  unreadableManifests: number;
}

/**
 * Works through the queue oldest first, at most `max` jobs. Nothing one job or one manifest
 * does can stop the rest: a failing job moves to the back of its manifest with its attempt
 * count raised, and is dropped after MAX_ATTEMPTS, so the queue can never stall on it.
 * Results always go to the trusted callback URL (from the repository secret), never to a URL
 * written in a manifest.
 */
export async function drainQueue(
  store: QueueStore,
  runJob: (job: QueueJob) => Promise<'ready' | 'failed' | 'obsolete'>,
  {
    max,
    concurrency = 1,
    trustedCallbackUrl,
    log = console.log,
  }: {
    max: number;
    /** Run this many jobs concurrently while preserving their manifest order when claiming. */
    concurrency?: number;
    trustedCallbackUrl: string;
    log?: (line: string) => void;
  },
): Promise<DrainResult> {
  const result: DrainResult = {
    manifestsFound: 0,
    processed: 0,
    reported: 0,
    conversionsFailed: 0,
    obsolete: 0,
    retryLater: 0,
    givenUp: 0,
    unreadableManifests: 0,
  };
  const trusted = new URL(trustedCallbackUrl).href;
  const jobKey = (job: QueueJob) => `${job.fileId}:${job.queueId ?? ''}`;
  const attempted = new Set<string>();
  const unreadableManifestKeys = new Set<string>();
  const taskLimit = Math.max(1, Math.floor(concurrency));
  type Outcome = 'ready' | 'failed' | 'obsolete' | 'error';
  type Finished = { key: string; job: QueueJob; outcome: Outcome; task: Promise<Finished> };
  const tasks = new Set<Promise<Finished>>();
  let firstManifestList = true;

  const nextQueuedJob = async (): Promise<{ key: string; job: QueueJob } | undefined> => {
    const keys = await store.listQueueManifests();
    if (firstManifestList) {
      result.manifestsFound = keys.length;
      firstManifestList = false;
    }
    for (const key of keys) {
      let manifest: QueueManifest;
      try {
        manifest = await store.readQueueManifest(key);
      } catch (error) {
        const missing = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (
          missing.name === 'NoSuchKey' ||
          missing.name === 'NotFound' ||
          missing.$metadata?.httpStatusCode === 404
        ) {
          log(`- manifest removed before reading: ${key}`);
          continue;
        }
        if (!unreadableManifestKeys.has(key)) {
          unreadableManifestKeys.add(key);
          result.unreadableManifests++;
          log(`! skipped ${key}: ${(error as Error).message}`);
        }
        continue;
      }
      if (manifest.callbackUrl && new URL(manifest.callbackUrl).href !== trusted)
        log(`! ${key} names another site; its results go to the trusted callback URL instead.`);
      if (manifest.jobs.length === 0) {
        await store.deleteQueueManifest(key);
        continue;
      }
      const job = manifest.jobs.find((candidate) => !attempted.has(jobKey(candidate)));
      if (!job) continue;
      attempted.add(jobKey(job));
      return { key, job };
    }
  };

  const saveOutcome = async (finished: Finished) => {
    const retry: QueueJob[] = [];
    if (finished.outcome === 'error') {
      const attempts = (finished.job.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        result.givenUp++;
        log(`x gave up on ${finished.job.sourceKey} after ${attempts} runs; queue it again from Admin.`);
      } else {
        result.retryLater++;
        retry.push({ ...finished.job, attempts });
      }
    } else if (finished.outcome === 'obsolete') {
      result.obsolete++;
      log(`- skipped superseded job ${finished.job.sourceKey}`);
    } else {
      result.reported++;
      if (finished.outcome === 'failed') result.conversionsFailed++;
    }
    // Checkpoint one completion while preserving active, queued, paused and deleted edits.
    let latest: QueueManifest;
    try {
      latest = await store.readQueueManifest(finished.key);
    } catch (error) {
      const missing = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        missing.name === 'NoSuchKey' ||
        missing.name === 'NotFound' ||
        missing.$metadata?.httpStatusCode === 404
      ) {
        log(`- manifest removed during conversion: ${finished.key}`);
        return;
      }
      result.unreadableManifests++;
      log(`! could not refresh ${finished.key}: ${(error as Error).message}`);
      return;
    }
    const completedKey = jobKey(finished.job);
    const currentKeys = new Set(latest.jobs.map(jobKey));
    const retained = latest.jobs.filter((job) => jobKey(job) !== completedKey);
    const stillQueuedRetry = retry.filter((job) => currentKeys.has(jobKey(job)));
    const updated = { ...latest, jobs: [...retained, ...stillQueuedRetry] };
    if (updated.jobs.length === 0) await store.deleteQueueManifest(finished.key);
    else await store.saveQueueManifest(finished.key, { ...updated, callbackUrl: trusted });
  };

  // Re-scan R2 whenever a slot opens. This catches a stuck-file retry or any new job
  // enqueued during this poll, and fills freed slots without waiting for a new workflow run.
  while (result.processed < max) {
    while (tasks.size < taskLimit && result.processed < max) {
      const next = await nextQueuedJob();
      if (!next) break;
      result.processed++;
      const task: Promise<Finished> = Promise.resolve()
        .then(() => runJob(next.job))
        .catch((error: unknown): Outcome => {
          log(`x ${next.job.sourceKey}: ${(error as Error).message}`);
          return 'error';
        })
        .then((outcome): Finished => ({ ...next, outcome, task }));
      tasks.add(task);
    }
    if (tasks.size === 0) break;
    let finished: Finished | null;
    if (tasks.size < taskLimit && result.processed < max) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      finished = await Promise.race([
        ...tasks,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 1_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!finished) continue;
    } else {
      finished = await Promise.race(tasks);
    }
    tasks.delete(finished.task);
    await saveOutcome(finished);
  }
  // Finish work already claimed when the per-poll safety limit is reached.
  while (tasks.size > 0) {
    const finished = await Promise.race(tasks);
    tasks.delete(finished.task);
    await saveOutcome(finished);
  }
  return result;
}
