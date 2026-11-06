import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ConversionJob, ConversionQueue } from '../domain/ports';
import type { R2Credentials } from './s3';

const PREFIX = '_system/conversion-queues/';

type Manifest = { version: 1; callbackUrl: string; jobs: ConversionJob[] };

/** S3 compatible queue for the local operations CLI, backed by the same R2 manifests as Workers. */
export class S3ManifestConversionQueue implements ConversionQueue {
  private readonly s3: S3Client;

  constructor(
    private readonly credentials: R2Credentials,
    private readonly callbackUrl: string,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    });
  }

  async enqueue(jobs: ConversionJob[]): Promise<void> {
    if (!jobs.length) return;
    const callbackUrl = this.validatedCallbackUrl();
    const key = `${PREFIX}${Date.now().toString().padStart(13, '0')}-${crypto.randomUUID()}.json`;
    const body: Manifest = { version: 1, callbackUrl, jobs };
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.credentials.bucket,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: 'application/json',
      }),
    );
  }

  async remove(fileIds: string[]): Promise<number> {
    if (!fileIds.length) return 0;
    const wanted = new Set(fileIds);
    const seen = new Set<string>();
    let token: string | undefined;
    let removed = 0;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.credentials.bucket,
          Prefix: PREFIX,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        const key = object.Key;
        if (!key?.endsWith('.json')) continue;
        const response = await this.s3.send(
          new GetObjectCommand({ Bucket: this.credentials.bucket, Key: key }),
        );
        if (!response.Body) continue;
        let value: unknown;
        try {
          value = JSON.parse(await response.Body.transformToString());
        } catch {
          continue;
        }
        const wrapped = value !== null && typeof value === 'object' && 'jobs' in value;
        const jobs = Array.isArray(value)
          ? (value as ConversionJob[])
          : wrapped && Array.isArray((value as Manifest).jobs)
            ? (value as Manifest).jobs
            : [];
        const kept = jobs.filter((job) => !wanted.has(job.fileId));
        if (kept.length === jobs.length) continue;
        removed += jobs.length - kept.length;
        if (!kept.length) {
          await this.s3.send(new DeleteObjectCommand({ Bucket: this.credentials.bucket, Key: key }));
        } else {
          const next = Array.isArray(value) ? kept : { ...(value as Manifest), jobs: kept };
          await this.s3.send(
            new PutObjectCommand({
              Bucket: this.credentials.bucket,
              Key: key,
              Body: JSON.stringify(next),
              ContentType: 'application/json',
            }),
          );
        }
      }
      const next = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && (!next || next === token || seen.has(next))) {
        throw new Error('R2 returned an unusable cursor while removing queued conversion files.');
      }
      if (next) seen.add(next);
      token = next;
    } while (token);
    return removed;
  }

  private validatedCallbackUrl(): string {
    let url: URL;
    try {
      url = new URL(this.callbackUrl);
    } catch {
      throw new Error(
        'Set APP_URL or CONVERTER_CALLBACK_URL to the deployed HTTPS site before queuing files.',
      );
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('The conversion callback must use HTTPS outside local development.');
    }
    if (!url.pathname.replace(/\/$/, '').endsWith('/api/internal/conversion')) {
      throw new Error('The conversion callback URL must end with /api/internal/conversion.');
    }
    return url.toString();
  }
}
