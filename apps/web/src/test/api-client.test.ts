import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../lib/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('device claim', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a page loading many things at once claims the device once, then retries each request', async () => {
    let claimed = false;
    const fetchMock = vi.fn(async () =>
      claimed
        ? json(200, { ok: true })
        : json(409, { error: { code: 'DEVICE_UNCLAIMED', message: 'Finish signing in', requestId: 'r' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('/api');
    const claimer = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      claimed = true;
    });
    client.useClaimer(claimer);
    const results = await Promise.all([client.me(), client.me(), client.me(), client.me()]);
    expect(claimer).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  });

  it('gives up after one retry instead of looping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { error: { code: 'DEVICE_UNCLAIMED', message: 'x', requestId: 'r' } })),
    );
    const client = new ApiClient('/api');
    const claimer = vi.fn(async () => {});
    client.useClaimer(claimer);
    await expect(client.me()).rejects.toMatchObject({ code: 'DEVICE_UNCLAIMED' });
    expect(claimer).toHaveBeenCalledTimes(1);
  });
});

describe('preview URLs', () => {
  it('versions cacheable preview URLs so quarantined images cannot reappear from browser cache', () => {
    const client = new ApiClient('/api');
    expect(client.previewUrl('file-123')).toBe('/api/previews/file-123?v=2');
  });
});

describe('admin R2 inventory', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the selected prefix attached when requesting later cursor pages', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://test.local');
        requests.push(url.toString());
        return json(200, {
          checkedAt: new Date(0).toISOString(),
          scopePrefix: url.searchParams.get('prefix') ?? '',
          importRoot: 'drive-imports/',
          objects: [],
          nextCursor: url.searchParams.has('cursor') ? null : 'next/page',
          complete: url.searchParams.has('cursor'),
        });
      }),
    );
    const client = new ApiClient('/api');
    const prefix = 'drive-imports/23 Batch/Course A/Module 2/';

    const first = await client.adminStorageInventoryPage(undefined, prefix);
    const second = await client.adminStorageInventoryPage(first.nextCursor ?? undefined, prefix);

    expect(new URL(requests[0]!).searchParams.get('prefix')).toBe(prefix);
    expect(new URL(requests[1]!).searchParams.get('prefix')).toBe(prefix);
    expect(new URL(requests[1]!).searchParams.get('cursor')).toBe('next/page');
    expect(second.complete).toBe(true);
  });
});
