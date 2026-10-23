import type { StoredObject } from '../domain/entities';
import type { ConversionJob, ConversionQueue, ObjectStore, RateLimiter } from '../domain/ports';

/** Private R2 bucket, read through the Worker binding only. */
export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const page = await this.listPage(prefix, cursor, 1000);
      out.push(...page.objects);
      if (page.nextCursor && (page.nextCursor === cursor || seenCursors.has(page.nextCursor))) {
        throw new Error(
          'R2 repeated a continuation cursor; refusing to report an incomplete listing as complete.',
        );
      }
      if (page.nextCursor) seenCursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  async listPage(prefix: string, cursor?: string, limit = 500) {
    const page = await this.bucket.list({ prefix, cursor, limit: Math.min(1000, Math.max(1, limit)) });
    if (page.truncated && (!page.cursor || page.cursor === cursor)) {
      throw new Error('R2 marked this listing truncated without a usable continuation cursor.');
    }
    return {
      objects: page.objects.map((o) => ({ key: o.key, size: o.size, etag: o.etag })),
      nextCursor: page.truncated ? page.cursor : null,
    };
  }

  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      etag: obj.etag,
      size: obj.size,
    };
  }

  async put(key: string, body: string): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const page = await this.bucket.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length) await this.bucket.delete(page.objects.map((object) => object.key));
      if (page.truncated && (!page.cursor || page.cursor === cursor || seenCursors.has(page.cursor)))
        throw new Error('R2 returned an unusable continuation cursor while deleting generated pages.');
      if (page.truncated && page.cursor) seenCursors.add(page.cursor);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

/** Cloudflare's Rate Limiting binding (configured in wrangler.jsonc). */
export class CloudflareRateLimiter implements RateLimiter {
  constructor(private readonly binding: { limit(o: { key: string }): Promise<{ success: boolean }> }) {}
  async allow(key: string): Promise<boolean> {
    return (await this.binding.limit({ key })).success;
  }
}

/** Fixed one-minute window in memory. Used in demo mode, tests, and as a fallback. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = () => Date.now(),
  ) {}
  async allow(key: string): Promise<boolean> {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.perMinute;
  }
}

/** Demo: conversion happens instantly (pages are generated on the fly). */
export class InstantConversionQueue implements ConversionQueue {
  constructor(private readonly onEnqueue: (jobs: ConversionJob[]) => Promise<void>) {}
  enqueue(jobs: ConversionJob[]): Promise<void> {
    return this.onEnqueue(jobs);
  }
}
