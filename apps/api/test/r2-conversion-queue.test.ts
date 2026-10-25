import { describe, expect, it, vi } from 'vitest';
import { R2ManifestConversionQueue } from '../src/infrastructure/r2-conversion-queue';

const callbackUrl = 'https://scholarstack.workers.dev/api/internal/conversion';

describe('R2 conversion manifest queue', () => {
  it('stores one durable manifest for the scoped jobs without calling GitHub from the Worker', async () => {
    const put = vi.fn(async (_key: string, _body: string, _options: unknown) => undefined);
    const bucket = { put } as unknown as R2Bucket;
    const queue = new R2ManifestConversionQueue(
      bucket,
      callbackUrl,
      () => 1234,
      () => 'manifest-id',
    );
    const jobs = [
      {
        fileId: '4a9e6bee-741d-44f0-91bd-37c752a4db27',
        sourceKey: 'drive-imports/23 Batch/Example/Module 1/note.pdf',
        queueId: '6e14c8c1-b4a2-4c94-bce8-830f7c45ed11',
        queuePosition: 1,
        queueTotal: 1,
      },
    ];

    await queue.enqueue(jobs);

    expect(put).toHaveBeenCalledOnce();
    const [key, body, options] = put.mock.calls[0] as unknown as [string, string, unknown];
    expect(key).toBe('_system/conversion-queues/0000000001234-manifest-id.json');
    expect(JSON.parse(body)).toEqual({ version: 1, callbackUrl, jobs });
    expect(options).toEqual({ httpMetadata: { contentType: 'application/json' } });
  });

  it('reports the exact number of queued files after reading all manifests', async () => {
    const bucket = {
      list: vi.fn(async () => ({
        objects: [
          { key: '_system/conversion-queues/1-first.json' },
          { key: '_system/conversion-queues/2-second.json' },
        ],
        truncated: false,
      })),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          text: async () => JSON.stringify({ version: 1, callbackUrl, jobs: [{}, {}] }),
        })
        .mockResolvedValueOnce({ text: async () => JSON.stringify([{ fileId: 'a' }]) }),
    } as unknown as R2Bucket;
    const queue = new R2ManifestConversionQueue(bucket, callbackUrl);

    await expect(queue.health()).resolves.toMatchObject({
      status: 'ready',
      provider: 'GitHub Actions + R2 manifests',
      queuedJobs: 3,
      deadLetterJobs: null,
    });
  });

  it('surfaces a malformed or unreachable R2 queue as unhealthy', async () => {
    const bucket = {
      list: vi.fn(async () => ({ objects: [], truncated: false })),
    } as unknown as R2Bucket;
    const queue = new R2ManifestConversionQueue(bucket, 'http://not-secure.example/api/internal/conversion');

    await expect(queue.health()).resolves.toMatchObject({ status: 'error', queuedJobs: null });
    await expect(queue.enqueue([{ fileId: 'file', sourceKey: 'file.pdf' }])).rejects.toThrow('HTTPS');
  });
});
