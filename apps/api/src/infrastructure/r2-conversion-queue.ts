import type { ConversionJob, ConversionQueue } from '../domain/ports';

const PREFIX = '_system/conversion-queues/';

type Manifest = {
  version: 1;
  callbackUrl: string;
  jobs: ConversionJob[];
};

/**
 * Durable conversion handoff stored in R2. GitHub Actions renders the files; an optional
 * fine-grained dispatch token wakes it immediately, while scheduled polling recovers missed runs.
 */
export class R2ManifestConversionQueue implements ConversionQueue {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly callbackUrl: string,
    private readonly now: () => number = () => Date.now(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
    private readonly dispatchToken?: string,
    private readonly repository?: string,
  ) {}

  async enqueue(jobs: ConversionJob[]): Promise<void> {
    if (jobs.length === 0) return;
    const callbackUrl = this.validatedCallbackUrl();
    const key = `${PREFIX}${this.now().toString().padStart(13, '0')}-${this.uuid()}.json`;
    const manifest: Manifest = { version: 1, callbackUrl, jobs };
    await this.bucket.put(key, JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json' },
    });
    await this.dispatch();
  }

  /**
   * Pauses or cancels a job that is still sitting in a manifest: rewrites every manifest to
   * drop these file ids, deleting a manifest left with none. A job the runner already picked up
   * isn't in any manifest any more, so this quietly removes nothing for it — the admin service
   * also marks the file held, so a late result from that run is ignored when it arrives.
   */
  async remove(fileIds: string[]): Promise<number> {
    if (fileIds.length === 0) return 0;
    const wanted = new Set(fileIds);
    let removed = 0;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const item of page.objects) {
        if (!item.key.endsWith('.json')) continue;
        const object = await this.bucket.get(item.key);
        if (!object) continue;
        let value: unknown;
        try {
          value = JSON.parse(await object.text());
        } catch {
          continue;
        }
        const wrapped =
          value !== null &&
          typeof value === 'object' &&
          'jobs' in value &&
          Array.isArray((value as { jobs: unknown }).jobs);
        const jobs: ConversionJob[] = Array.isArray(value) ? value : wrapped ? (value as Manifest).jobs : [];
        if (!jobs.length) continue;
        const kept = jobs.filter((job) => !wanted.has(job.fileId));
        if (kept.length === jobs.length) continue;
        removed += jobs.length - kept.length;
        if (kept.length === 0) {
          await this.bucket.delete(item.key);
        } else if (Array.isArray(value)) {
          await this.bucket.put(item.key, JSON.stringify(kept), {
            httpMetadata: { contentType: 'application/json' },
          });
        } else {
          await this.bucket.put(item.key, JSON.stringify({ ...(value as Manifest), jobs: kept }), {
            httpMetadata: { contentType: 'application/json' },
          });
        }
      }
      if (page.truncated && (!page.cursor || page.cursor === cursor || seen.has(page.cursor))) break;
      if (page.truncated && page.cursor) seen.add(page.cursor);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return removed;
  }

  async health() {
    try {
      this.validatedCallbackUrl();
      let cursor: string | undefined;
      const seen = new Set<string>();
      let queuedJobs = 0;
      let oldest = Number.POSITIVE_INFINITY;
      do {
        const page = await this.bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
        for (const item of page.objects) {
          if (!item.key.endsWith('.json')) continue;
          oldest = Math.min(oldest, item.uploaded?.getTime?.() ?? Number.POSITIVE_INFINITY);
          const object = await this.bucket.get(item.key);
          if (!object) continue;
          const value: unknown = JSON.parse(await object.text());
          if (Array.isArray(value)) queuedJobs += value.length;
          else if (
            value !== null &&
            typeof value === 'object' &&
            'jobs' in value &&
            Array.isArray((value as { jobs: unknown }).jobs)
          ) {
            queuedJobs += (value as { jobs: unknown[] }).jobs.length;
          } else {
            throw new Error(`Invalid conversion manifest: ${item.key}`);
          }
        }
        if (page.truncated && (!page.cursor || page.cursor === cursor || seen.has(page.cursor))) {
          throw new Error('R2 returned an unusable cursor while checking conversion manifests.');
        }
        if (page.truncated && page.cursor) seen.add(page.cursor);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      // The GitHub workflow polls every five minutes; a list older than half an hour means
      // it isn't running (secrets missing, Actions turned off, or every run failing).
      const waitedMin = Number.isFinite(oldest) ? Math.round((Date.now() - oldest) / 60_000) : 0;
      if (queuedJobs > 0 && waitedMin > 10)
        return {
          status: 'error' as const,
          provider: 'GitHub Actions + R2 manifests',
          message: `${queuedJobs} file${queuedJobs === 1 ? '' : 's'} have waited ${waitedMin} minutes for pages. Automatic GitHub wake-ups are not completing; check the converter dispatch token has Actions: write for this repository and inspect the latest converter run.`,
          queuedJobs,
          deadLetterJobs: null,
        };
      return {
        status: 'ready' as const,
        provider: 'GitHub Actions + R2 manifests',
        message:
          this.dispatchToken && this.repository
            ? 'New files start a GitHub conversion run immediately; a five-minute poll is the recovery path.'
            : 'GitHub checks for files waiting for pages every five minutes. Configure CONVERTER_DISPATCH_TOKEN for immediate starts.',
        queuedJobs,
        deadLetterJobs: null,
      };
    } catch (error) {
      return {
        status: 'error' as const,
        provider: 'GitHub Actions + R2 manifests',
        message: (error as Error).message.slice(0, 300),
        queuedJobs: null,
        deadLetterJobs: null,
      };
    }
  }

  /** Retry GitHub dispatch from the Cloudflare Cron when a manifest is still waiting in R2. */
  async wakeIfQueued(): Promise<number> {
    let queuedJobs = 0;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const item of page.objects) {
        if (!item.key.endsWith('.json')) continue;
        const object = await this.bucket.get(item.key);
        if (!object) continue;
        const value: unknown = JSON.parse(await object.text());
        if (Array.isArray(value)) queuedJobs += value.length;
        else if (
          value !== null &&
          typeof value === 'object' &&
          'jobs' in value &&
          Array.isArray((value as { jobs: unknown }).jobs)
        ) {
          queuedJobs += (value as { jobs: unknown[] }).jobs.length;
        } else {
          throw new Error(`Invalid conversion manifest: ${item.key}`);
        }
      }
      if (page.truncated && (!page.cursor || page.cursor === cursor || seen.has(page.cursor))) {
        throw new Error('R2 returned an unusable cursor while waking the conversion runner.');
      }
      if (page.truncated && page.cursor) seen.add(page.cursor);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    if (queuedJobs > 0) await this.dispatch();
    return queuedJobs;
  }

  /** The durable manifest is the source of truth; GitHub dispatch is a best-effort wake-up. */
  private async dispatch(): Promise<void> {
    if (!this.dispatchToken || !this.repository) return;
    const [owner, name, ...extra] = this.repository.split('/');
    if (!owner || !name || extra.length) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'converter.dispatch',
          message: 'CONVERTER_GITHUB_REPOSITORY must be owner/repository.',
        }),
      );
      return;
    }
    try {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/convert-pages.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${this.dispatchToken}`,
            'content-type': 'application/json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'Scholars-Stack-Page-Converter',
          },
          body: JSON.stringify({ ref: 'main' }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        const message = typeof body?.message === 'string' ? body.message.slice(0, 240) : undefined;
        const requiredPermissions = response.headers.get('x-accepted-github-permissions') ?? undefined;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'converter.dispatch',
            status: response.status,
            ...(message ? { message } : {}),
            ...(requiredPermissions ? { requiredPermissions } : {}),
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'converter.dispatch',
          message: error instanceof Error ? error.message.slice(0, 200) : 'GitHub could not be reached.',
        }),
      );
    }
  }

  private validatedCallbackUrl(): string {
    let url: URL;
    try {
      url = new URL(this.callbackUrl);
    } catch {
      throw new Error(
        'Set APP_URL or CONVERTER_CALLBACK_URL to the deployed HTTPS site before syncing files.',
      );
    }
    if (
      url.protocol !== 'https:' &&
      !((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:')
    ) {
      throw new Error('The conversion callback must use HTTPS outside local development.');
    }
    if (!url.pathname.replace(/\/$/, '').endsWith('/api/internal/conversion')) {
      throw new Error('The conversion callback URL must end with /api/internal/conversion.');
    }
    return url.toString();
  }
}
