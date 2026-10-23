import type { ConversionJob, ConversionQueue } from '../domain/ports';

const PREFIX = '_system/conversion-queues/';

type Manifest = {
  version: 1;
  callbackUrl: string;
  jobs: ConversionJob[];
};

/**
 * Durable conversion handoff stored in R2. A public-repository GitHub Actions
 * runner polls these manifests; the Worker does not need a GitHub token, paid
 * Cloudflare Queue, or Container binding.
 */
export class R2ManifestConversionQueue implements ConversionQueue {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly callbackUrl: string,
    private readonly now: () => number = () => Date.now(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  async enqueue(jobs: ConversionJob[]): Promise<void> {
    if (jobs.length === 0) return;
    const callbackUrl = this.validatedCallbackUrl();
    const key = `${PREFIX}${this.now().toString().padStart(13, '0')}-${this.uuid()}.json`;
    const manifest: Manifest = { version: 1, callbackUrl, jobs };
    await this.bucket.put(key, JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  async health() {
    try {
      this.validatedCallbackUrl();
      let cursor: string | undefined;
      const seen = new Set<string>();
      let queuedJobs = 0;
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
          throw new Error('R2 returned an unusable cursor while checking conversion manifests.');
        }
        if (page.truncated && page.cursor) seen.add(page.cursor);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      return {
        status: 'ready' as const,
        provider: 'GitHub Actions + R2 manifests',
        message:
          'R2 queue is reachable. Conversion runs after the repository workflow is enabled and its Actions secrets are configured; the workflow polls every 5 minutes.',
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
