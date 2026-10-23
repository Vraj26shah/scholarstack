/**
 * R2 through its S3-compatible API, for Node (ops CLI, local live server, page converter).
 * The Worker uses the native R2 binding (cloudflare.ts) instead; both satisfy ObjectStore.
 */
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StoredObject } from '../domain/entities';
import type { ObjectStore } from '../domain/ports';

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;
  constructor(private readonly creds: R2Credentials) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    });
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const page = await this.listPage(prefix, token, 1000);
      out.push(...page.objects);
      if (page.nextCursor && (page.nextCursor === token || seenTokens.has(page.nextCursor))) {
        throw new Error(
          'R2 repeated a continuation token; refusing to report an incomplete listing as complete.',
        );
      }
      if (page.nextCursor) seenTokens.add(page.nextCursor);
      token = page.nextCursor ?? undefined;
    } while (token);
    return out;
  }

  async listPage(prefix: string, cursor?: string, limit = 500) {
    const page = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.creds.bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
        MaxKeys: Math.min(1000, Math.max(1, limit)),
      }),
    );
    if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === cursor)) {
      throw new Error('R2 marked this listing truncated without a usable continuation token.');
    }
    return {
      objects: (page.Contents ?? []).flatMap((o) =>
        o.Key ? [{ key: o.Key, size: o.Size ?? 0, etag: (o.ETag ?? '').replace(/"/g, '') }] : [],
      ),
      nextCursor: page.IsTruncated ? page.NextContinuationToken! : null,
    };
  }

  async get(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.creds.bucket, Key: key }));
      const body = res.Body?.transformToWebStream() ?? new Uint8Array();
      return {
        body,
        contentType: res.ContentType ?? 'application/octet-stream',
        etag: (res.ETag ?? '').replace(/"/g, '') || undefined,
        size: res.ContentLength,
      };
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  // ── converter Storage ──
  async download(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.creds.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.creds.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.creds.bucket, Key: key }));
      return true;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        return false;
      throw error;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    const seenTokens = new Set<string>();
    do {
      const page = await this.listPage(prefix, cursor, 1000);
      if (page.objects.length === 0 && page.nextCursor) {
        throw new Error('R2 returned an empty page with more generated objects to delete.');
      }
      if (page.objects.length) {
        const response = await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.creds.bucket,
            Delete: { Objects: page.objects.map((object) => ({ Key: object.key })) },
          }),
        );
        if (response.Errors?.length) {
          throw new Error(`R2 could not remove ${response.Errors.length} old page objects.`);
        }
      }
      if (page.nextCursor && (page.nextCursor === cursor || seenTokens.has(page.nextCursor))) {
        throw new Error('R2 repeated a continuation token while deleting generated pages.');
      }
      if (page.nextCursor) seenTokens.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.creds.bucket, Key: key }));
  }
}
