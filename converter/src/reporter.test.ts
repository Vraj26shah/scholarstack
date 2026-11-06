import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpReporter } from './pipeline';

const report = { fileId: 'f', status: 'failed' as const, pages: [], error: 'x' };
const answer = (...codes: number[]) => {
  const calls: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const status = codes[calls.length] ?? codes.at(-1)!;
      calls.push(status);
      return new Response('{}', { status });
    }),
  );
  return calls;
};
afterEach(() => vi.unstubAllGlobals());

describe('reporting a result to the site', () => {
  it('retries a server hiccup, then succeeds', async () => {
    const calls = answer(502, 200);
    await new HttpReporter('https://s/api/internal/conversion', 'secret-secret-secret', 3, 1).report(report);
    expect(calls).toEqual([502, 200]);
  });
  it('a file the site no longer has needs nothing more', async () => {
    const calls = answer(404);
    await new HttpReporter('https://s/api/internal/conversion', 'secret-secret-secret', 3, 1).report(report);
    expect(calls).toEqual([404]);
  });
  it('a wrong secret is not retried and says so plainly', async () => {
    const calls = answer(403);
    await expect(
      new HttpReporter('https://s/api/internal/conversion', 'secret-secret-secret', 3, 1).report(report),
    ).rejects.toThrow(/CONVERTER_CALLBACK_SECRET/);
    expect(calls).toEqual([403]);
  });
  it('gives up after its tries when the site stays down', async () => {
    const calls = answer(503);
    await expect(
      new HttpReporter('https://s/api/internal/conversion', 'secret-secret-secret', 3, 1).report(report),
    ).rejects.toThrow(/HTTP 503/);
    expect(calls).toHaveLength(3);
  });
});
