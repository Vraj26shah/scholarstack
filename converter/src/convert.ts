/** Local/manual converter and the GitHub Actions R2-manifest worker. */
import { appendFile } from 'node:fs/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import { CliRasterizer, ConversionOwnershipLost, ConvertPages, HttpReporter, type Storage } from './pipeline';
import { Jobs, type QueueJob, type QueueManifest, type QueueStore, drainQueue } from './queue';

const Env = z
  .object({
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    TILE_SEED_SECRET: z.string().min(16),
    CONVERTER_CALLBACK_URL: z
      .string()
      .url()
      .refine(
        (v) =>
          process.env.CONVERTER_ALLOW_LOCAL === 'true' ||
          (/^https:\/\//.test(v) && !/localhost|127\.0\.0\.1/.test(v)),
        'CONVERTER_CALLBACK_URL must be your live site, e.g. https://<your-site>/api/internal/conversion (not localhost). Run pnpm github:secrets to set it.',
      ),
    CONVERTER_CALLBACK_SECRET: z.string().min(16),
    CONVERT_JOBS: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(2).optional()),
    CONVERT_QUEUE_MODE: z.preprocess((value) => value === 'true', z.boolean()),
    CONVERT_QUEUE_CHECK_ONLY: z.preprocess((value) => value === 'true', z.boolean()),
    CONVERTER_MAX_QUEUE_JOBS: z.coerce.number().int().min(1).max(100).default(5),
    CONVERTER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  })
  .superRefine((env, context) => {
    if (!env.CONVERT_QUEUE_MODE && !env.CONVERT_JOBS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide CONVERT_JOBS or set CONVERT_QUEUE_MODE=true.',
      });
    }
  });

const ManifestObject = z.object({
  version: z.literal(1),
  callbackUrl: z.string().url(),
  jobs: Jobs,
});
const Manifest = z.union([Jobs, ManifestObject]);

class R2Storage implements Storage, QueueStore {
  private readonly s3: S3Client;
  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async download(key: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: signal,
    });
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async upload(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      { abortSignal: signal },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        return false;
      throw error;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(...(page.Contents ?? []).map((object) => object.Key!).filter(Boolean));
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const response = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(offset, offset + 1000).map((Key) => ({ Key })) },
        }),
      );
      if (response.Errors?.length) {
        throw new Error(`R2 could not remove ${response.Errors.length} old page objects.`);
      }
    }
  }

  async listQueueManifests(): Promise<string[]> {
    const prefix = '_system/conversion-queues/';
    const keys: string[] = [];
    const cursors = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(
        ...(page.Contents ?? [])
          .map((object) => object.Key)
          .filter((key): key is string => !!key && key.endsWith('.json')),
      );
      const next = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && (!next || next === continuationToken || cursors.has(next))) {
        throw new Error('R2 returned an unusable cursor while listing conversion manifests.');
      }
      if (next) cursors.add(next);
      continuationToken = next;
    } while (continuationToken);
    return keys.sort();
  }

  async readQueueManifest(key: string): Promise<QueueManifest> {
    if (!key.startsWith('_system/conversion-queues/') || !key.endsWith('.json')) {
      throw new Error('Refusing to read an object outside the conversion manifest prefix.');
    }
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`R2 returned an empty conversion manifest: ${key}`);
    let value: unknown;
    try {
      value = JSON.parse(await response.Body.transformToString());
    } catch {
      throw new Error(`Conversion manifest is not valid JSON: ${key}`);
    }
    const parsed = Manifest.safeParse(value);
    if (!parsed.success) throw new Error(`Conversion manifest has an invalid shape: ${key}`);
    if (Array.isArray(parsed.data)) return { jobs: parsed.data, legacyArray: true };
    return { callbackUrl: parsed.data.callbackUrl, jobs: parsed.data.jobs, legacyArray: false };
  }

  async saveQueueManifest(key: string, manifest: QueueManifest): Promise<void> {
    if (!key.startsWith('_system/conversion-queues/') || !key.endsWith('.json')) {
      throw new Error('Refusing to write an object outside the conversion manifest prefix.');
    }
    const body = manifest.legacyArray
      ? JSON.stringify(manifest.jobs)
      : JSON.stringify({ version: 1, callbackUrl: manifest.callbackUrl, jobs: manifest.jobs });
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/json' }),
    );
  }

  async deleteQueueManifest(key: string): Promise<void> {
    if (!key.startsWith('_system/conversion-queues/') || !key.endsWith('.json')) {
      throw new Error('Refusing to delete an object outside the conversion manifest prefix.');
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

async function main() {
  // Secrets pasted with a stray space or line break (a Windows .env adds \r) break the R2 login.
  const clean = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
  );
  const env = Env.parse(clean);
  const storage = new R2Storage(
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
  );
  if (env.CONVERT_QUEUE_CHECK_ONLY) {
    const keys = await storage.listQueueManifests();
    let queuedJobs = 0;
    let office = false;
    for (const key of keys) {
      const jobs = (await storage.readQueueManifest(key)).jobs;
      queuedJobs += jobs.length;
      if (jobs.some((j) => /\.(docx?|pptx?|pps[x]?|odt|odp|txt)$/i.test(j.sourceKey))) office = true;
    }
    const hasWork = queuedJobs > 0;
    // LibreOffice takes a minute to install, so it is only installed when Word or PowerPoint
    // files are waiting; PDFs and images need just poppler.
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `has_work=${hasWork}\nhas_office=${office}\n`);
    console.log(
      JSON.stringify({ level: 'info', event: 'conversion.queue.check', manifests: keys.length, queuedJobs }),
    );
    return;
  }

  const convertOne = async (job: QueueJob, callbackUrl: string) => {
    const reporter = new HttpReporter(callbackUrl, env.CONVERTER_CALLBACK_SECRET);
    if (!(await reporter.isCurrent(job))) return 'obsolete' as const;
    const { attempts: _attempts, ...plain } = job;
    let report: Awaited<ReturnType<ConvertPages['run']>>;
    try {
      report = await new ConvertPages(
        storage,
        new CliRasterizer(150),
        reporter,
        env.TILE_SEED_SECRET,
        '.work',
      ).run({
        ...plain,
        queueId: job.queueId ?? crypto.randomUUID(),
        queuePosition: job.queuePosition ?? 1,
        queueTotal: job.queueTotal ?? 1,
      });
    } catch (error) {
      if (error instanceof ConversionOwnershipLost) return 'obsolete' as const;
      throw error;
    }
    console.log(
      `${report.status === 'ready' ? '✓' : '×'} ${job.sourceKey} → ${report.pages.length} pages${report.error ? ` (${report.error})` : ''}`,
    );
    return report.status;
  };

  if (env.CONVERT_QUEUE_MODE) {
    const result = await drainQueue(storage, (job) => convertOne(job, env.CONVERTER_CALLBACK_URL), {
      max: env.CONVERTER_MAX_QUEUE_JOBS,
      concurrency: env.CONVERTER_CONCURRENCY,
      trustedCallbackUrl: env.CONVERTER_CALLBACK_URL,
    });
    console.log(JSON.stringify({ level: 'info', event: 'conversion.queue.poll.complete', ...result }));
    if (result.conversionsFailed > 0 && process.env.GITHUB_ACTIONS)
      console.log(
        `::warning title=Some files could not be converted::${result.conversionsFailed} file(s) were broken or missing. Admin → Courses shows which, with the reason.`,
      );
    // A broken upload is reported to the admin and is not a failed run. A job the site could
    // not be told about is: it stays queued for the next run (and is dropped after 3 tries).
    if (result.retryLater > 0 || result.givenUp > 0 || result.unreadableManifests > 0) process.exitCode = 1;
  } else {
    let failed = 0;
    for (const job of Jobs.parse(JSON.parse(env.CONVERT_JOBS!)))
      if ((await convertOne(job, env.CONVERTER_CALLBACK_URL)) === 'failed') failed++;
    if (failed > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
