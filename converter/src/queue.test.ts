import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, type QueueJob, type QueueManifest, type QueueStore, drainQueue } from './queue';

const SITE = 'https://site.example/api/internal/conversion';

class MemoryQueue implements QueueStore {
  constructor(public manifests = new Map<string, QueueManifest>()) {}
  async listQueueManifests() {
    return [...this.manifests.keys()].sort();
  }
  async readQueueManifest(key: string) {
    const m = this.manifests.get(key);
    if (!m) throw new Error('bad manifest');
    return structuredClone(m);
  }
  async saveQueueManifest(key: string, m: QueueManifest) {
    this.manifests.set(key, structuredClone(m));
  }
  async deleteQueueManifest(key: string) {
    this.manifests.delete(key);
  }
}

const job = (fileId: string): QueueJob => ({ fileId, sourceKey: `notes/${fileId}.pdf` });
const queue = (...lists: QueueJob[][]) =>
  new MemoryQueue(
    new Map(
      lists.map((jobs, i) => [
        `_system/conversion-queues/${i}.json`,
        { callbackUrl: SITE, jobs, legacyArray: false },
      ]),
    ),
  );

describe('conversion queue', () => {
  it('a job that errors moves to the back and the rest of the queue still runs', async () => {
    const q = queue([job('bad'), job('a')], [job('b')]);
    const done: string[] = [];
    const r = await drainQueue(
      q,
      async (j) => {
        if (j.fileId === 'bad') throw new Error('Callback failed (HTTP 500).');
        done.push(j.fileId);
        return 'ready';
      },
      { max: 5, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(done).toEqual(['a', 'b']);
    expect(r).toMatchObject({ processed: 3, reported: 2, retryLater: 1, givenUp: 0 });
    expect([...q.manifests.values()].flatMap((m) => m.jobs)).toEqual([{ ...job('bad'), attempts: 1 }]);
  });

  it(`drops a job after ${MAX_ATTEMPTS} failed runs, so it can never block the queue`, async () => {
    const q = queue([job('bad')]);
    const fail = async () => {
      throw new Error('boom');
    };
    for (let run = 1; run < MAX_ATTEMPTS; run++)
      expect(
        (await drainQueue(q, fail, { max: 5, trustedCallbackUrl: SITE, log: () => {} })).retryLater,
      ).toBe(1);
    const last = await drainQueue(q, fail, { max: 5, trustedCallbackUrl: SITE, log: () => {} });
    expect(last.givenUp).toBe(1);
    expect(q.manifests.size).toBe(0);
  });

  it('a broken or missing file is reported once and leaves the queue', async () => {
    const q = queue([job('gone'), job('ok')]);
    const r = await drainQueue(q, async (j) => (j.fileId === 'gone' ? 'failed' : 'ready'), {
      max: 5,
      trustedCallbackUrl: SITE,
      log: () => {},
    });
    expect(r).toMatchObject({ reported: 2, conversionsFailed: 1, retryLater: 0 });
    expect(q.manifests.size).toBe(0);
  });

  it('drops superseded jobs without counting them as conversion failures', async () => {
    const q = queue([job('stale'), job('current')]);
    const seen: string[] = [];
    const r = await drainQueue(
      q,
      async (j) => {
        seen.push(j.fileId);
        return j.fileId === 'stale' ? 'obsolete' : 'ready';
      },
      { max: 5, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(seen).toEqual(['stale', 'current']);
    expect(r).toMatchObject({ processed: 2, reported: 1, conversionsFailed: 0, obsolete: 1 });
    expect(q.manifests.size).toBe(0);
  });

  it('a manifest naming another site does not stop the queue; results still go to the trusted site', async () => {
    const q = new MemoryQueue(
      new Map([
        [
          '_system/conversion-queues/0.json',
          { callbackUrl: 'https://evil.example/x', jobs: [job('a')], legacyArray: false },
        ],
        ['_system/conversion-queues/1.json', { callbackUrl: SITE, jobs: [job('b')], legacyArray: false }],
      ]),
    );
    const seen: string[] = [];
    const r = await drainQueue(
      q,
      async (j) => {
        seen.push(j.fileId);
        return 'ready';
      },
      { max: 5, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(seen).toEqual(['a', 'b']);
    expect(r.reported).toBe(2);
  });

  it('an unreadable manifest is skipped, not fatal; the run stops at the job limit', async () => {
    const q = queue([job('a'), job('b'), job('c')]);
    const read = q.readQueueManifest.bind(q);
    q.manifests.set('_system/conversion-queues/!bad.json', { jobs: [], legacyArray: false });
    q.readQueueManifest = async (key) => {
      if (key.endsWith('!bad.json')) throw new Error('not valid JSON');
      return read(key);
    };
    const r = await drainQueue(q, async () => 'ready', { max: 2, trustedCallbackUrl: SITE, log: () => {} });
    expect(r).toMatchObject({ unreadableManifests: 1, processed: 2 });
    expect(q.manifests.get('_system/conversion-queues/0.json')!.jobs.map((j) => j.fileId)).toEqual(['c']);
  });

  it('ignores a manifest deleted by a concurrent pause or delete action', async () => {
    const q = queue([job('a')]);
    q.readQueueManifest = async () => {
      throw Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
    };
    const result = await drainQueue(q, async () => 'ready', {
      max: 8,
      trustedCallbackUrl: SITE,
      log: () => {},
    });
    expect(result).toMatchObject({ processed: 0, unreadableManifests: 0 });
  });

  it('keeps serial conversion as the default for compatibility', async () => {
    const q = queue([job('a'), job('bad'), job('b'), job('c'), job('d')]);
    let running = 0;
    let most = 0;
    const seen: string[] = [];
    const r = await drainQueue(
      q,
      async (j) => {
        seen.push(j.fileId);
        running++;
        most = Math.max(most, running);
        await new Promise((ok) => setTimeout(ok, 5));
        running--;
        if (j.fileId === 'bad') throw new Error('network');
        return 'ready';
      },
      { max: 4, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(most).toBe(1);
    expect(seen).toEqual(['a', 'bad', 'b', 'c']);
    expect(r).toMatchObject({ processed: 4, reported: 3, retryLater: 1 });
    const left = [...q.manifests.values()][0]!.jobs;
    expect(left.map((j) => j.fileId)).toEqual(['d', 'bad']);
    expect(left[1]!.attempts).toBe(1);
  });

  it('runs a bounded number concurrently while claiming and saving in queue order', async () => {
    const q = queue([job('a'), job('b'), job('c'), job('d')]);
    let running = 0;
    let most = 0;
    const started: string[] = [];
    const result = await drainQueue(
      q,
      async (j) => {
        started.push(j.fileId);
        running++;
        most = Math.max(most, running);
        await new Promise((ok) => setTimeout(ok, 5));
        running--;
        return 'ready';
      },
      { max: 3, concurrency: 2, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(started).toEqual(['a', 'b', 'c']);
    expect(most).toBe(2);
    expect(result.processed).toBe(3);
    expect([...q.manifests.values()][0]!.jobs.map((j) => j.fileId)).toEqual(['d']);
  });

  it('immediately fills a slot when a paused job gives up ownership', async () => {
    const q = queue([job('paused'), job('slow'), job('replacement')]);
    let releaseSlow!: () => void;
    let signalReplacement!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const replacementStarted = new Promise<void>((resolve) => {
      signalReplacement = resolve;
    });
    const started: string[] = [];
    const running = drainQueue(
      q,
      async (current) => {
        started.push(current.fileId);
        if (current.fileId === 'paused') return 'obsolete';
        if (current.fileId === 'slow') await slowGate;
        if (current.fileId === 'replacement') signalReplacement();
        return 'ready';
      },
      { max: 3, concurrency: 2, trustedCallbackUrl: SITE, log: () => {} },
    );
    const backfilled = await Promise.race([
      replacementStarted.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    releaseSlow();
    const result = await running;
    expect(backfilled).toBe(true);
    expect(started).toEqual(['paused', 'slow', 'replacement']);
    expect(result).toMatchObject({ processed: 3, obsolete: 1, reported: 2 });
  });

  it('fills a freed slot from a new manifest while another file is still converting', async () => {
    const q = queue([job('slow'), job('quick')]);
    const started: string[] = [];
    let releaseSlow!: () => void;
    let signalSlowStarted!: () => void;
    let signalRetryStarted!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowStarted = new Promise<void>((resolve) => {
      signalSlowStarted = resolve;
    });
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve;
    });
    const running = drainQueue(
      q,
      async (current) => {
        started.push(current.fileId);
        if (current.fileId === 'slow') {
          signalSlowStarted();
          await slowGate;
        }
        if (current.fileId === 'quick') {
          await slowStarted;
          q.manifests.set('_system/conversion-queues/1.json', {
            callbackUrl: SITE,
            jobs: [job('retry')],
            legacyArray: false,
          });
        }
        if (current.fileId === 'retry') signalRetryStarted();
        return 'ready';
      },
      { max: 3, concurrency: 2, trustedCallbackUrl: SITE, log: () => {} },
    );

    const pickedUpBeforeSlowFinished = await Promise.race([
      retryStarted.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_500)),
    ]);
    releaseSlow();
    const result = await running;

    expect(pickedUpBeforeSlowFinished).toBe(true);
    expect(started).toEqual(['slow', 'quick', 'retry']);
    expect(result).toMatchObject({ processed: 3, reported: 3, manifestsFound: 1 });
    expect(q.manifests.size).toBe(0);
  });

  it('does not restore a queued job removed while another job is converting', async () => {
    const q = queue([job('a'), job('pause-me'), job('c')]);
    const r = await drainQueue(
      q,
      async (current) => {
        if (current.fileId === 'a') {
          q.manifests.set('_system/conversion-queues/0.json', {
            callbackUrl: SITE,
            jobs: [job('a'), job('c')],
            legacyArray: false,
          });
        }
        return 'ready';
      },
      { max: 1, trustedCallbackUrl: SITE, log: () => {} },
    );
    expect(r.processed).toBe(1);
    expect([...q.manifests.values()][0]!.jobs.map((j) => j.fileId)).toEqual(['c']);
  });
});
