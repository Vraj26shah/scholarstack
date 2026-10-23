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
import { CliRasterizer, ConvertPages, HttpReporter, type Storage } from './pipeline';

const Env = z
  .object({
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    TILE_SEED_SECRET: z.string().min(16),
    CONVERTER_CALLBACK_URL: z.string().url(),
    CONVERTER_CALLBACK_SECRET: z.string().min(16),
    CONVERT_JOBS: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(2).optional()),
    CONVERT_QUEUE_MODE: z.preprocess((value) => value === 'true', z.boolean()),
    CONVERT_QUEUE_CHECK_ONLY: z.preprocess((value) => value === 'true', z.boolean()),
    CONVERTER_MAX_QUEUE_JOBS: z.coerce.number().int().min(1).max(100).default(5),
  })
  .superRefine((env, context) => {
    if (!env.CONVERT_QUEUE_MODE && !env.CONVERT_JOBS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide CONVERT_JOBS or set CONVERT_QUEUE_MODE=true.',
      });
    }
  });

const Jobs = z.array(
  z.object({
    fileId: z.string().min(1),
    sourceKey: z.string().min(1),
    queueId: z.string().uuid().optional(),
    queuePosition: z.number().int().min(1).optional(),
    queueTotal: z.number().int().min(1).optional(),
  }),
);

const ManifestObject = z.object({
  version: z.literal(1),
  callbackUrl: z.string().url(),
  jobs: Jobs,
});
const Manifest = z.union([Jobs, ManifestObject]);
type QueueManifest = { callbackUrl?: string; jobs: z.infer<typeof Jobs>; legacyArray: boolean };

class R2Storage implements Storage {
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

  async download(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
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
  const env = Env.parse(process.env);
  const storage = new R2Storage(
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
  );
  const converterFor = (callbackUrl: string) =>
    new ConvertPages(
      storage,
      new CliRasterizer(150),
      new HttpReporter(callbackUrl, env.CONVERTER_CALLBACK_SECRET),
      env.TILE_SEED_SECRET,
      '.work',
    );

  if (env.CONVERT_QUEUE_CHECK_ONLY) {
    const keys = await storage.listQueueManifests();
    let queuedJobs = 0;
    for (const key of keys) queuedJobs += (await storage.readQueueManifest(key)).jobs.length;
    const hasWork = queuedJobs > 0;
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `has_work=${hasWork}\n`);
    console.log(
      JSON.stringify({ level: 'info', event: 'conversion.queue.check', manifests: keys.length, queuedJobs }),
    );
    return;
  }

  let failed = 0;

  const processJobs = async (jobs: z.infer<typeof Jobs>, callbackUrl: string) => {
    const queueIds = new Set(jobs.flatMap((job) => (job.queueId ? [job.queueId] : [])));
    if (queueIds.size > 1) throw new Error('A conversion run contains mismatched queue IDs.');
    const queueId = queueIds.values().next().value ?? crypto.randomUUID();
    const queuedJobs = jobs.map((job, index) => ({
      ...job,
      queueId,
      queuePosition: job.queuePosition ?? index + 1,
      queueTotal: job.queueTotal ?? jobs.length,
    }));
    for (const job of queuedJobs) {
      const report = await converterFor(callbackUrl).run(job);
      console.log(
        `${report.status === 'ready' ? '✓' : '×'} ${job.sourceKey} → ${report.pages.length} pages${report.error ? ` (${report.error})` : ''}`,
      );
      if (report.status === 'failed') failed++;
    }
  };

  if (env.CONVERT_QUEUE_MODE) {
    const keys = await storage.listQueueManifests();
    let processed = 0;
    for (const key of keys) {
      if (processed >= env.CONVERTER_MAX_QUEUE_JOBS) break;
      let manifest = await storage.readQueueManifest(key);
      if (manifest.jobs.length === 0) {
        await storage.deleteQueueManifest(key);
        continue;
      }
      while (manifest.jobs.length > 0 && processed < env.CONVERTER_MAX_QUEUE_JOBS) {
        const callbackUrl = env.CONVERTER_CALLBACK_URL;
        if (manifest.callbackUrl && new URL(manifest.callbackUrl).href !== new URL(callbackUrl).href) {
          throw new Error(
            `Conversion manifest ${key} targets a callback URL that does not match the trusted GitHub Actions secret.`,
          );
        }
        const job = manifest.jobs[0]!;
        await processJobs([job], callbackUrl);
        manifest = { ...manifest, jobs: manifest.jobs.slice(1) };
        if (manifest.jobs.length === 0) await storage.deleteQueueManifest(key);
        else await storage.saveQueueManifest(key, manifest);
        processed++;
      }
    }
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'conversion.queue.poll.complete',
        processed,
        manifestsFound: keys.length,
      }),
    );
  } else {
    await processJobs(Jobs.parse(JSON.parse(env.CONVERT_JOBS!)), env.CONVERTER_CALLBACK_URL!);
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
