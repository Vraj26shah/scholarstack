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
