import { describe, expect, it } from 'vitest';
import { keepAlive } from '../src/cron-pace';

describe('keep-alive', () => {
  it('tries again after a random pause when the database is slow, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    await keepAlive(
      async () => {
        calls++;
        if (calls < 3) throw new Error('timeout');
      },
      async (ms) => {
        waits.push(ms);
      },
      () => 0.5,
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([5500, 11500]);
  });

  it('gives up after three tries and reports the error', async () => {
    let calls = 0;
    await expect(
      keepAlive(
        async () => {
          calls++;
          throw new Error('down');
        },
        async () => {},
      ),
    ).rejects.toThrow('down');
    expect(calls).toBe(3);
  });
});
